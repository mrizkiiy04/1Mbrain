"""
Shared Utilities
================

Logging, checkpointing, graceful shutdown, dataset download helpers,
and progress tracking used across all benchmarks.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Generator

import requests
from tqdm import tqdm


def _unlink_with_retry(path: Path, attempts: int = 5, delay: float = 0.2) -> None:
    """Delete a file, tolerating short-lived Windows file locks."""
    for attempt in range(attempts):
        try:
            path.unlink()
            return
        except FileNotFoundError:
            return
        except PermissionError:
            if attempt >= attempts - 1:
                raise
            time.sleep(delay * (attempt + 1))


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------


def setup_logging(name: str, log_file: str | None = None, debug: bool = False) -> logging.Logger:
    """Configure a logger with both file and console output.

    Args:
        name: Logger name.
        log_file: Path to log file. Auto-created under logs/ if not specified.
        debug: If True, set DEBUG level; otherwise INFO.

    Returns:
        Configured logger.
    """
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG if debug else logging.INFO)

    # Avoid duplicate handlers if called multiple times
    if logger.handlers:
        return logger

    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")

    # Console handler
    console = logging.StreamHandler()
    console.setLevel(logging.DEBUG if debug else logging.INFO)
    console.setFormatter(logging.Formatter("%(levelname)s - %(message)s"))
    logger.addHandler(console)

    # File handler
    if log_file is None:
        os.makedirs("logs", exist_ok=True)
        log_file = f"logs/{name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    else:
        os.makedirs(os.path.dirname(log_file) or ".", exist_ok=True)

    file_handler = logging.FileHandler(log_file)
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    # Quiet noisy libraries
    for noisy in ("httpx", "httpcore", "urllib3", "filelock", "aiohttp"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    return logger


# ---------------------------------------------------------------------------
# Checkpointing
# ---------------------------------------------------------------------------


class Checkpoint:
    """Per-question JSON checkpoint for resumable runs.

    Saves completed question results so runs can be resumed after interruption.
    Each question gets its own checkpoint file; completed results are loaded
    on resume and skipped during processing.
    """

    def __init__(self, checkpoint_dir: str):
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, question_id: str) -> Path:
        safe_id = question_id.replace("/", "_").replace("\\", "_")
        return self.checkpoint_dir / f"_checkpoint_{safe_id}.json"

    def exists(self, question_id: str) -> bool:
        return self._path(question_id).exists()

    def load(self, question_id: str) -> dict | None:
        """Load a checkpoint. Returns None if not found."""
        path = self._path(question_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def save(self, question_id: str, data: dict) -> None:
        """Save checkpoint data for a question."""
        data["_checkpoint_time"] = datetime.now().isoformat()
        self._path(question_id).write_text(json.dumps(data, indent=2, default=str))

    def delete(self, question_id: str) -> None:
        """Delete checkpoint after question is fully processed."""
        path = self._path(question_id)
        if path.exists():
            _unlink_with_retry(path)

    def list_completed(self) -> set[str]:
        """Return set of question IDs that have checkpoints."""
        result = set()
        for p in self.checkpoint_dir.glob("_checkpoint_*.json"):
            # Extract question_id from filename
            name = p.stem.replace("_checkpoint_", "", 1)
            result.add(name)
        return result


class IngestionCheckpoint:
    """Checkpoint for tracking ingestion progress of conversations.

    Tracks which chunks have been ingested so that interrupted
    ingestion runs can be resumed without re-processing.
    """

    def __init__(self, checkpoint_dir: str):
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

    def ingestion_path(self, key: str) -> Path:
        return self.checkpoint_dir / f"_ingestion_{key}.json"

    def progress_path(self, key: str) -> Path:
        return self.checkpoint_dir / f"_progress_{key}.json"

    def is_complete(self, key: str, chunk_size: int) -> tuple[bool, dict | None]:
        """Check if ingestion is complete for a key.

        Returns (is_complete, checkpoint_data_or_None).
        """
        path = self.ingestion_path(key)
        if not path.exists():
            return False, None
        try:
            data = json.loads(path.read_text())
            if data.get("chunk_size", -1) == chunk_size:
                return True, data
            return False, None
        except (json.JSONDecodeError, OSError):
            return False, None

    def load_progress(self, key: str, chunk_size: int) -> tuple[set[str], str | None]:
        """Load partial progress: (completed_chunk_keys, user_id).

        Returns (empty_set, None) if no valid progress found.
        """
        path = self.progress_path(key)
        if not path.exists():
            return set(), None
        try:
            data = json.loads(path.read_text())
            if data.get("chunk_size") == chunk_size:
                return set(data.get("completed_chunks", [])), data.get("user_id")
            return set(), None
        except (json.JSONDecodeError, OSError):
            return set(), None

    def save_progress(self, key: str, data: dict) -> None:
        """Save partial ingestion progress."""
        data["updated_at"] = datetime.now().isoformat()
        self.progress_path(key).write_text(json.dumps(data))

    def save_complete(self, key: str, data: dict) -> None:
        """Mark ingestion as complete, remove progress file."""
        data["completed_at"] = datetime.now().isoformat()
        self.ingestion_path(key).write_text(json.dumps(data, indent=2))
        progress = self.progress_path(key)
        if progress.exists():
            _unlink_with_retry(progress)


# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------


class GracefulShutdown:
    """Context manager for handling SIGTERM/SIGINT gracefully.

    Usage:
        shutdown = GracefulShutdown()
        with shutdown:
            for item in items:
                if shutdown.requested:
                    break
                process(item)
    """

    def __init__(self) -> None:
        self.requested = False
        self._original_sigterm = None
        self._original_sigint = None

    def _handler(self, signum: int, frame: Any) -> None:
        self.requested = True
        sig_name = "SIGTERM" if signum == signal.SIGTERM else "SIGINT"
        print(f"\n[{sig_name}] Graceful shutdown requested...", file=sys.stderr)

    def __enter__(self) -> GracefulShutdown:
        self._original_sigterm = signal.getsignal(signal.SIGTERM)
        self._original_sigint = signal.getsignal(signal.SIGINT)
        signal.signal(signal.SIGTERM, self._handler)
        signal.signal(signal.SIGINT, self._handler)
        return self

    def __exit__(self, *exc: Any) -> None:
        if self._original_sigterm is not None:
            signal.signal(signal.SIGTERM, self._original_sigterm)
        if self._original_sigint is not None:
            signal.signal(signal.SIGINT, self._original_sigint)


# ---------------------------------------------------------------------------
# Dataset download
# ---------------------------------------------------------------------------


def download_file(url: str, dest_path: str, description: str = "Downloading") -> str:
    """Download a file with progress bar.

    Args:
        url: URL to download from.
        dest_path: Local path to save to.
        description: Progress bar description.

    Returns:
        The dest_path on success.

    Raises:
        RuntimeError: On download failure.
    """
    if os.path.exists(dest_path):
        return dest_path

    os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)

    try:
        response = requests.get(url, stream=True, timeout=120)
        response.raise_for_status()

        total_size = int(response.headers.get("content-length", 0))
        with open(dest_path, "wb") as f:
            with tqdm(total=total_size, unit="B", unit_scale=True, desc=description) as pbar:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
                    pbar.update(len(chunk))

        return dest_path

    except Exception as exc:
        # Clean up partial download
        if os.path.exists(dest_path):
            os.remove(dest_path)
        raise RuntimeError(f"Failed to download {url}: {exc}")


# ---------------------------------------------------------------------------
# Result helpers
# ---------------------------------------------------------------------------


def save_result_json(path: str, data: dict) -> None:
    """Save a result dict as JSON with directory creation."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)


def load_result_json(path: str) -> dict | None:
    """Load a JSON result file. Returns None if not found or invalid."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def cutoff_label(cutoff: int | None) -> str:
    """Convert a cutoff value to a label string."""
    return "all" if cutoff is None else f"top_{cutoff}"


def parse_cutoffs(cutoffs_str: str) -> list[int]:
    """Parse comma-separated cutoff string to list of ints.

    Example: "10,20,50,200" -> [10, 20, 50, 200]
    """
    return [int(c.strip()) for c in cutoffs_str.split(",") if c.strip()]
