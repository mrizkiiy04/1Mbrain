"""
LOCOMO Benchmark Runner
=======================

Combined ingest + search + answer + judge pipeline for the LOCOMO-10
benchmark (Snap Research, ACL 2024).

Flow:
    1. Download dataset (auto-download from GitHub if missing)
    2. For each conversation:
        a. Parse into sessions, ingest via Mem0
        b. For each question:
            - Search Mem0 -> retrieved memories
            - Generate answer (answerer model)
            - Judge answer vs ground truth (judge model)
            - Save checkpoint
    3. Compute metrics (by category, by cutoff)
    4. Write unified result JSON

Usage:
    python -m benchmarks.locomo.run --project-name test
    python -m benchmarks.locomo.run --project-name full --answerer-model gpt-4o --judge-model gpt-4o
    python -m benchmarks.locomo.run --project-name full --predict-only
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from tqdm import tqdm

from benchmarks.common.llm_client import LLMClient
from benchmarks.common.mem0_client import Mem0Client, format_search_results
from benchmarks.common.metrics import compute_overall_metrics
from benchmarks.common.schema import (
    CutoffResult,
    EvalItem,
    GenerationData,
    JudgmentData,
    Metadata,
    Metrics,
    RetrievalData,
    UnifiedResult,
)
from benchmarks.common.utils import (
    Checkpoint,
    GracefulShutdown,
    IngestionCheckpoint,
    cutoff_label,
    download_file,
    parse_cutoffs,
    save_result_json,
    setup_logging,
)

from .prompts import (
    CATEGORIES_TO_EVALUATE,
    CATEGORY_NAMES,
    JUDGE_SYSTEM_PROMPT,
    get_answer_generation_prompt,
    get_judge_prompt,
    get_judge_prompt_with_evidence,
    preprocess_answer,
)

load_dotenv(override=True)

# ===============================================================================
# CONSTANTS
# ===============================================================================

DATASET_URL = "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json"
DEFAULT_DATASET_DIR = "datasets/locomo"
DEFAULT_DATASET_FILE = "locomo10.json"
CHUNK_SIZE = 1  # turns per ingestion chunk


# ===============================================================================
# DATASET
# ===============================================================================


def download_dataset(dataset_dir: str, logger: Any) -> str:
    """Download locomo10.json from GitHub if not present."""
    path = os.path.join(dataset_dir, DEFAULT_DATASET_FILE)
    if os.path.exists(path):
        logger.info("Dataset already exists: %s", path)
        return path

    os.makedirs(dataset_dir, exist_ok=True)
    logger.info("Downloading LOCOMO-10 dataset...")
    download_file(DATASET_URL, path, description="Downloading LOCOMO-10")

    with open(path) as f:
        data = json.load(f)
    if not isinstance(data, list) or len(data) != 10:
        os.remove(path)
        raise RuntimeError(f"Invalid dataset: expected 10 conversations, got {len(data)}")

    logger.info("Downloaded: %s (%d conversations)", path, len(data))
    return path


def load_dataset(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ===============================================================================
# CONVERSATION PARSING
# ===============================================================================


def parse_locomo_date(date_str: str) -> datetime | None:
    """Parse LOCOMO date: '1:56 pm on 8 May, 2023'."""
    for fmt in ("%I:%M %p on %d %B, %Y", "%I:%M %p on %d %b, %Y"):
        try:
            return datetime.strptime(date_str, fmt)
        except (ValueError, TypeError):
            continue
    return None


def locomo_date_to_epoch(date_str: str) -> int | None:
    parsed = parse_locomo_date(date_str)
    if parsed:
        return int(parsed.replace(tzinfo=timezone.utc).timestamp())
    return None


def get_sorted_sessions(conversation: dict) -> list[tuple[str, str, list[dict]]]:
    """Extract and sort sessions chronologically."""
    session_keys = [k for k in conversation if re.match(r"^session_\d+$", k)]
    paired = []
    for key in session_keys:
        date_key = f"{key}_date_time"
        date_str = conversation.get(date_key, "")
        turns = conversation[key]
        paired.append((key, date_str, turns))

    def sort_key(item: tuple) -> tuple:
        parsed = parse_locomo_date(item[1])
        if parsed:
            return (0, parsed)
        num = int(re.search(r"\d+", item[0]).group())
        return (1, datetime(2000, 1, num))

    paired.sort(key=sort_key)
    return paired


def session_to_chunks(turns: list[dict], speaker_a: str, speaker_b: str) -> list[list[dict]]:
    """Convert turns to message chunks for ingestion."""
    messages = []
    for turn in turns:
        speaker = turn.get("speaker", "")
        text = turn.get("text", "")
        blip = turn.get("blip_caption", "")
        query = turn.get("query", "")
        if query and blip:
            photo_tag = f"[Sharing image - query: {query}. The image shows: {blip}]"
        elif query:
            photo_tag = f"[Sharing image - query for: {query}]"
        elif blip:
            photo_tag = f"[Sharing image that shows: {blip}]"
        else:
            photo_tag = ""
        if photo_tag:
            text = f"{text} {photo_tag}" if text else photo_tag
        if not text:
            continue
        role = "user" if speaker == speaker_a else "assistant"
        messages.append({"role": role, "content": f"{speaker}: {text}"})

    chunks = []
    for i in range(0, len(messages), CHUNK_SIZE):
        chunk = messages[i : i + CHUNK_SIZE]
        if chunk:
            chunks.append(chunk)
    return chunks


# ===============================================================================
# EVIDENCE HELPERS
# ===============================================================================


def load_evidence_lookup(dataset_path: str) -> dict[tuple, str]:
    """Build lookup: (conv_idx, dia_id) -> formatted turn text."""
    with open(dataset_path) as f:
        data = json.load(f)
    lookup = {}
    for conv_idx, conv in enumerate(data):
        conversation = conv["conversation"]
        session_dates = {}
        for key in conversation:
            if key.endswith("_date_time") and key.startswith("session_"):
                session_num = key.replace("session_", "").replace("_date_time", "")
                session_dates[session_num] = conversation[key]
        for key in conversation:
            if key.startswith("session_") and not key.endswith("date_time"):
                if not isinstance(conversation[key], list):
                    continue
                for turn in conversation[key]:
                    dia_id = turn.get("dia_id", "")
                    if dia_id:
                        speaker = turn.get("speaker", "")
                        text = turn.get("text", "")
                        dia_match = re.match(r"D(\d+):", dia_id)
                        date_suffix = ""
                        if dia_match:
                            snum = dia_match.group(1)
                            sdate = session_dates.get(snum, "")
                            if sdate:
                                date_suffix = f", said on {sdate}"
                        lookup[(conv_idx, dia_id)] = f'[{dia_id}{date_suffix}] {speaker}: "{text}"'
    return lookup


# ===============================================================================
# INGESTION
# ===============================================================================


async def ingest_conversation(
    conv_idx: int,
    entry: dict,
    mem0: Mem0Client,
    logger: Any,
    run_id: str,
    project_name: str,
    output_dir: str,
    shutdown: GracefulShutdown,
    debug: bool = True,
) -> tuple[bool, str, int]:
    """Ingest all sessions of a LOCOMO conversation into Mem0.

    Returns: (success, user_id, total_chunks_processed)
    """
    conversation = entry["conversation"]
    speaker_a = conversation["speaker_a"]
    speaker_b = conversation["speaker_b"]
    user_id = f"locomo_{conv_idx}_{run_id}"

    checkpoint = IngestionCheckpoint(output_dir)
    key = str(conv_idx)

    # Check if already complete
    is_done, cp_data = checkpoint.is_complete(key, CHUNK_SIZE)
    if is_done and cp_data:
        chunks_done = cp_data.get("total_chunks_processed", 0)
        user_id = cp_data.get("user_id", user_id)
        logger.info("Conversation %d already ingested (user_id=%s, %d chunks)", conv_idx, user_id, chunks_done)
        return True, user_id, chunks_done

    # Check for partial progress
    chunks_already_done, resumed_uid = checkpoint.load_progress(key, CHUNK_SIZE)
    if resumed_uid and chunks_already_done:
        user_id = resumed_uid
        logger.info("Resuming conversation %d from %d completed chunks", conv_idx, len(chunks_already_done))

    sorted_sessions = get_sorted_sessions(conversation)
    total_chunks = sum(len(session_to_chunks(s, speaker_a, speaker_b)) for _, _, s in sorted_sessions)

    logger.info(
        "Ingesting conversation %d: %s & %s, %d sessions, %d chunks",
        conv_idx, speaker_a, speaker_b, len(sorted_sessions), total_chunks,
    )

    # Debug log
    debug_file = None
    if debug:
        debug_dir = os.path.join(output_dir, "debug")
        os.makedirs(debug_dir, exist_ok=True)
        debug_path = os.path.join(debug_dir, f"conv_{conv_idx}_ingestion.txt")
        debug_mode = "a" if chunks_already_done else "w"
        debug_file = open(debug_path, debug_mode, encoding="utf-8")
        if not chunks_already_done:
            debug_file.write(f"{'=' * 80}\n")
            debug_file.write(f"CONVERSATION {conv_idx}: {speaker_a} & {speaker_b}\n")
            debug_file.write(f"Sessions: {len(sorted_sessions)}, Chunks: {total_chunks}\n")
            debug_file.write(f"User ID: {user_id}\n")
            debug_file.write(f"{'=' * 80}\n\n")

    pbar = tqdm(total=total_chunks, desc=f"Ingest conv {conv_idx}", initial=len(chunks_already_done), leave=True)
    total_processed = len(chunks_already_done)
    total_failed = 0

    for session_key, date_str, turns in sorted_sessions:
        chunks = session_to_chunks(turns, speaker_a, speaker_b)
        if not chunks:
            continue

        session_epoch = locomo_date_to_epoch(date_str)

        if debug_file and f"{session_key}_header" not in chunks_already_done:
            debug_file.write(f"\n{'---' * 27}\n")
            debug_file.write(f"SESSION: {session_key}  |  Date: {date_str}  |  Chunks: {len(chunks)}\n")
            debug_file.write(f"{'---' * 27}\n\n")

        for chunk_idx, messages in enumerate(chunks):
            chunk_key = f"{session_key}_c{chunk_idx}"

            if chunk_key in chunks_already_done:
                continue

            if shutdown.requested:
                logger.info("Shutdown requested at conv %d, chunk %s", conv_idx, chunk_key)
                pbar.close()
                if debug_file:
                    debug_file.close()
                return True, user_id, total_processed

            # Skip empty messages
            if any(not msg.get("content", "").strip() for msg in messages):
                chunks_already_done.add(chunk_key)
                total_processed += 1
                pbar.update(1)
                continue

            if debug_file:
                debug_file.write(f"--- Chunk {chunk_idx} ({len(messages)} messages) ---\n")
                for msg in messages:
                    debug_file.write(f"  {msg['role']}: {msg['content']}\n")
                debug_file.write("\n")

            response = await mem0.add(messages, user_id, timestamp=session_epoch)

            if response is not None:
                total_processed += 1
                if debug_file:
                    results = response.get("results", [])
                    if results:
                        debug_file.write(f"--- Chunk {chunk_idx} (extracted) ---\n")
                        for mem_item in results:
                            mem_text = mem_item.get("memory", "")
                            event_type = mem_item.get("event", "")
                            debug_file.write(f"  [{event_type}] {mem_text}\n")
                        debug_file.write("\n")
            else:
                total_failed += 1
                logger.warning("Ingestion failed: conv %d %s chunk %d", conv_idx, session_key, chunk_idx)

            chunks_already_done.add(chunk_key)
            checkpoint.save_progress(key, {
                "conversation_idx": conv_idx,
                "user_id": user_id,
                "run_id": run_id,
                "chunk_size": CHUNK_SIZE,
                "completed_chunks": list(chunks_already_done),
            })
            pbar.update(1)

    pbar.close()
    if debug_file:
        debug_file.write(f"\nSUMMARY: {total_processed}/{total_chunks} OK, {total_failed} failed\n")
        debug_file.close()

    checkpoint.save_complete(key, {
        "conversation_idx": conv_idx,
        "user_id": user_id,
        "run_id": run_id,
        "chunk_size": CHUNK_SIZE,
        "total_chunks_processed": total_processed,
        "total_chunks_failed": total_failed,
    })

    return total_failed == 0, user_id, total_processed


# ===============================================================================
# SEARCH + ANSWER + JUDGE
# ===============================================================================


async def process_question(
    qa: dict,
    qa_idx: int,
    conv_idx: int,
    user_id: str,
    mem0: Mem0Client,
    answerer: LLMClient,
    judge_llm: LLMClient,
    cutoffs: list[int],
    top_k: int,
    reference_date_human: str | None,
    user_profile: dict | None,
    evidence_lookup: dict | None,
    predict_only: bool,
    logger: Any,
    score_debug: bool = False,
) -> dict[str, Any]:
    """Process a single question: search + answer + judge at multiple cutoffs.

    Returns a result dict suitable for serialization.
    """
    question_id = f"conv{conv_idx}_q{qa_idx}"
    question = qa["question"]
    category = qa["category"]
    answer = str(qa["answer"])

    # --- Search ---
    start = time.monotonic()
    search_results = await mem0.search(question, user_id, top_k=top_k, score_debug=score_debug)
    search_latency = (time.monotonic() - start) * 1000

    formatted, query_debug = format_search_results(search_results)

    result: dict[str, Any] = {
        "question_id": question_id,
        "conversation_idx": conv_idx,
        "category": category,
        "category_name": CATEGORY_NAMES.get(category, "unknown"),
        "question": question,
        "ground_truth_answer": answer,
        "evidence": qa.get("evidence", []),
        "user_id": user_id,
        "reference_date": reference_date_human,
        "retrieval": {
            "search_query": question,
            "search_results": formatted,
            "search_latency_ms": round(search_latency, 1),
            "total_results": len(formatted),
        },
    }
    if query_debug:
        result["retrieval"]["query_debug"] = query_debug
    if user_profile:
        result["user_profile"] = user_profile

    if predict_only:
        return result

    # --- Answer + Judge at each cutoff ---
    cutoff_results: dict[str, dict] = {}
    processed_answer = preprocess_answer(category, answer)

    # Build evidence context if available
    ev_ctx = ""
    if evidence_lookup:
        for ref in qa.get("evidence", []):
            key = (conv_idx, ref)
            if key in evidence_lookup:
                ev_ctx += evidence_lookup[key] + "\n"
        ev_ctx = ev_ctx.strip()

    for c in cutoffs:
        sliced = formatted[:c]
        label = cutoff_label(c)

        # Generate answer
        gen_prompt = get_answer_generation_prompt(question, sliced, reference_date=reference_date_human, user_profile=user_profile)
        generated_answer = await answerer.generate(system="", user=gen_prompt)
        if "ANSWER:" in generated_answer:
            generated_answer = generated_answer.rsplit("ANSWER:", 1)[-1].strip()

        # Judge
        if ev_ctx:
            judge_prompt = get_judge_prompt_with_evidence(category, question, processed_answer, generated_answer, ev_ctx)
        else:
            judge_prompt = get_judge_prompt(category, question, processed_answer, generated_answer)

        raw = await judge_llm.generate_structured(
            system=JUDGE_SYSTEM_PROMPT,
            user=judge_prompt,
        )
        if isinstance(raw, dict):
            label_val = raw.get("label", "").upper()
            correct = label_val == "CORRECT"
        else:
            correct = False

        score = 1.0 if correct else 0.0
        judgment = "CORRECT" if correct else "WRONG"

        cutoff_results[label] = {
            "judgment": judgment,
            "score": score,
            "generated_answer": generated_answer,
            "memories_evaluated": len(sliced),
            "reason": raw.get("reasoning", "") if isinstance(raw, dict) else "",
        }

    result["cutoff_results"] = cutoff_results
    return result


async def apply_locomo_judge_to_saved_result(
    result: dict,
    qa: dict,
    conv_idx: int,
    answerer: LLMClient,
    judge_llm: LLMClient,
    cutoffs: list[int],
    evidence_lookup: dict | None,
) -> None:
    """Fill ``cutoff_results`` using ``retrieval.search_results`` only (no Mem0)."""
    formatted = list(result["retrieval"]["search_results"])
    question = result["question"]
    category = qa["category"]
    answer = str(qa["answer"])
    reference_date_human = result.get("reference_date")
    user_profile = result.get("user_profile")

    cutoff_results: dict[str, dict] = {}
    processed_answer = preprocess_answer(category, answer)

    ev_ctx = ""
    if evidence_lookup:
        for ref in qa.get("evidence", []):
            key = (conv_idx, ref)
            if key in evidence_lookup:
                ev_ctx += evidence_lookup[key] + "\n"
        ev_ctx = ev_ctx.strip()

    for c in cutoffs:
        sliced = formatted[:c]
        label = cutoff_label(c)

        gen_prompt = get_answer_generation_prompt(
            question, sliced, reference_date=reference_date_human, user_profile=user_profile,
        )
        generated_answer = await answerer.generate(system="", user=gen_prompt)
        if "ANSWER:" in generated_answer:
            generated_answer = generated_answer.rsplit("ANSWER:", 1)[-1].strip()

        if ev_ctx:
            judge_prompt = get_judge_prompt_with_evidence(
                category, question, processed_answer, generated_answer, ev_ctx,
            )
        else:
            judge_prompt = get_judge_prompt(category, question, processed_answer, generated_answer)

        raw = await judge_llm.generate_structured(
            system=JUDGE_SYSTEM_PROMPT,
            user=judge_prompt,
        )
        if isinstance(raw, dict):
            label_val = raw.get("label", "").upper()
            correct = label_val == "CORRECT"
        else:
            correct = False

        score = 1.0 if correct else 0.0
        judgment = "CORRECT" if correct else "WRONG"

        cutoff_results[label] = {
            "judgment": judgment,
            "score": score,
            "generated_answer": generated_answer,
            "memories_evaluated": len(sliced),
            "reason": raw.get("reasoning", "") if isinstance(raw, dict) else "",
        }

    result["cutoff_results"] = cutoff_results


def expected_locomo_question_items(
    dataset: list[dict],
    conv_indices: list[int],
    categories: list[int],
    max_questions: int | None,
) -> list[tuple[str, int, int, dict]]:
    """(question_id, conv_idx, qa_idx, qa_dict) for every question in scope."""
    items: list[tuple[str, int, int, dict]] = []
    for conv_idx in conv_indices:
        if conv_idx >= len(dataset):
            continue
        entry = dataset[conv_idx]
        questions = entry.get("qa", entry.get("qa_pairs", []))
        conv_questions = [
            (qi, qa) for qi, qa in enumerate(questions)
            if qa.get("category") in categories
        ]
        if max_questions is not None:
            conv_questions = conv_questions[:max_questions]
        for qi, qa in conv_questions:
            items.append((f"conv{conv_idx}_q{qi}", conv_idx, qi, qa))
    return items


def locomo_predict_outputs_complete(
    output_dir: str,
    expected_items: list[tuple[str, int, int, dict]],
) -> tuple[bool, list[str]]:
    """True if every expected question has JSON with retrieval.search_results."""
    missing: list[str] = []
    for qid, _, _, _ in expected_items:
        path = os.path.join(output_dir, f"{qid}.json")
        if not os.path.isfile(path):
            missing.append(qid)
            continue
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            missing.append(f"{qid} (unreadable)")
            continue
        retr = data.get("retrieval") or {}
        if "search_results" not in retr:
            missing.append(f"{qid} (no search_results)")
    return len(missing) == 0, missing


# ===============================================================================
# METRICS + DISPLAY
# ===============================================================================


def compute_locomo_metrics(evaluations: list[dict], cutoffs: list[int]) -> dict:
    """Compute per-category and overall metrics at each cutoff."""
    metrics_by_cutoff = {}
    for c in cutoffs:
        label = cutoff_label(c)
        total = len(evaluations)
        scores = [e.get("cutoff_results", {}).get(label, {}).get("score", 0.0) for e in evaluations]
        correct = sum(1 for s in scores if s >= 0.5)

        by_category: dict[str, list] = defaultdict(list)
        for e in evaluations:
            cat_name = e.get("category_name", "unknown")
            by_category[cat_name].append(e.get("cutoff_results", {}).get(label, {}).get("score", 0.0))

        cat_metrics = {}
        for cat_name in sorted(by_category):
            cat_scores = by_category[cat_name]
            cat_correct = sum(1 for s in cat_scores if s >= 0.5)
            cat_metrics[cat_name] = {
                "total": len(cat_scores),
                "correct": cat_correct,
                "accuracy": cat_correct / len(cat_scores) * 100 if cat_scores else 0.0,
                "avg_score": statistics.mean(cat_scores) * 100 if cat_scores else 0.0,
            }

        metrics_by_cutoff[label] = {
            "overall": {
                "total": total,
                "correct": correct,
                "accuracy": correct / total * 100 if total else 0.0,
                "avg_score": statistics.mean(scores) * 100 if scores else 0.0,
            },
            "by_category": cat_metrics,
        }
    return metrics_by_cutoff


def display_results(metrics_by_cutoff: dict, cutoffs: list[int]) -> None:
    """Print metrics to console."""
    for c in cutoffs:
        label = cutoff_label(c)
        m = metrics_by_cutoff.get(label, {})
        overall = m.get("overall", {})
        print(f"\n--- {label} ---")
        print(f"  Overall: {overall.get('correct', 0)}/{overall.get('total', 0)} "
              f"({overall.get('accuracy', 0):.1f}%) avg={overall.get('avg_score', 0):.1f}%")
        for cat_name, cm in sorted(m.get("by_category", {}).items()):
            print(f"  {cat_name}: {cm['correct']}/{cm['total']} ({cm['accuracy']:.1f}%)")


# ===============================================================================
# CLI
# ===============================================================================


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run LOCOMO-10 benchmark: ingest + search + answer + judge",
    )
    parser.add_argument("--project-name", required=True, help="Name for this eval run")
    parser.add_argument("--answerer-model", default="gpt-5", help="Model for answer generation")
    parser.add_argument("--judge-model", default="gpt-5", help="Model for judging")
    parser.add_argument("--provider", default="openai", help="LLM provider (openai, anthropic, azure)")
    parser.add_argument("--judge-provider", default=None, help="Judge provider (defaults to --provider)")
    parser.add_argument("--conversations", default="0,1,2,3,4,5,6,7,8,9", help="Comma-separated conversation indices")
    parser.add_argument("--top-k", type=int, default=200, help="Number of search results to retrieve")
    parser.add_argument("--top-k-cutoffs", default="10,20,50,200", help="Comma-separated cutoffs for evaluation")
    parser.add_argument("--max-workers", type=int, default=10, help="Max parallel workers")
    parser.add_argument("--output-dir", default="results/locomo", help="Output directory")
    parser.add_argument("--predict-only", action="store_true", help="Skip answer+judge, only ingest+search")
    parser.add_argument(
        "--evaluate-only",
        action="store_true",
        help="Judge only: requires all predict outputs on disk (use after --predict-only or full search). No Mem0.",
    )
    parser.add_argument(
        "--rejudge",
        action="store_true",
        help="With --evaluate-only: re-run answer+judge even if cutoff_results already exist",
    )
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    parser.add_argument("--debug", action="store_true", help="Verbose logging")
    parser.add_argument("--score-debug", action="store_true", help="Include score breakdowns in output")
    parser.add_argument("--dataset-path", default=None, help="Path to local locomo10.json")
    parser.add_argument("--run-id", default=None, help="Reuse a specific run_id for resume")
    parser.add_argument("--categories", default="1,2,3,4", help="Comma-separated categories")
    parser.add_argument("--with-evidence", action="store_true", help="Pass evidence to judge")
    parser.add_argument("--user-profile", action="store_true", help="Fetch user profiles")
    parser.add_argument("--max-questions", type=int, default=None, help="Max questions to process (for quick testing)")
    parser.add_argument("--rpm", type=int, default=200, help="Requests per minute for LLM")
    parser.add_argument("--backend", default="oss", choices=["oss", "cloud"],
                        help="Mem0 backend: 'oss' for self-hosted server (default), 'cloud' for api.mem0.ai")
    parser.add_argument("--mem0-host", default=None,
                        help="Mem0 server URL (default: http://localhost:8888 for oss, https://api.mem0.ai for cloud)")
    parser.add_argument("--mem0-api-key", default=None,
                        help="Mem0 API key (cloud mode only)")
    return parser.parse_args()


# ===============================================================================
# MAIN
# ===============================================================================


async def async_main() -> None:
    args = parse_args()
    logger = setup_logging("locomo", debug=args.debug)

    cutoffs = parse_cutoffs(args.top_k_cutoffs)
    categories = [int(c) for c in args.categories.split(",")]
    conv_indices = [int(c) for c in args.conversations.split(",")]

    run_id = args.run_id or uuid.uuid4().hex[:8]
    output_dir = os.path.join(args.output_dir, f"predicted_{args.project_name}")
    os.makedirs(output_dir, exist_ok=True)

    print(f"LOCOMO Benchmark | project={args.project_name} run_id={run_id}")
    print(f"  Answerer: {args.answerer_model} ({args.provider})")
    print(f"  Judge: {args.judge_model} ({args.judge_provider or args.provider})")
    print(f"  Conversations: {args.conversations}")
    print(f"  Cutoffs: {args.top_k_cutoffs}")

    # Load dataset
    if args.dataset_path:
        dataset_path = args.dataset_path
    else:
        dataset_path = download_dataset(DEFAULT_DATASET_DIR, logger)
    dataset = load_dataset(dataset_path)

    # Evidence
    evidence_lookup = None
    if args.with_evidence:
        evidence_lookup = load_evidence_lookup(dataset_path)
        print(f"  Evidence lookup: {len(evidence_lookup)} entries")

    answerer = LLMClient(model=args.answerer_model, provider=args.provider, rpm=args.rpm)
    judge_provider = args.judge_provider or args.provider
    judge_llm = LLMClient(model=args.judge_model, provider=judge_provider, rpm=args.rpm)

    if args.evaluate_only:
        expected_items = expected_locomo_question_items(
            dataset, conv_indices, categories, args.max_questions,
        )
        if not expected_items:
            print("No questions in scope (check --conversations / --categories).")
            return
        complete, missing = locomo_predict_outputs_complete(output_dir, expected_items)
        if not complete:
            print(
                "Evaluate-only aborted: not all predict outputs are on disk. "
                "Finish ingest+search for every in-scope question first "
                "(full run without --predict-only, or --predict-only until complete)."
            )
            print(f"  Missing or invalid: {len(missing)} (showing up to 25): {missing[:25]}")
            return
        print(f"  Predict complete ({len(expected_items)} questions). Running judge phase (no Mem0)...")

        sem = asyncio.Semaphore(args.max_workers)

        async def judge_one(qid: str, conv_idx: int, qi: int, qa: dict) -> None:
            path = os.path.join(output_dir, f"{qid}.json")
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            if data.get("cutoff_results") and not args.rejudge:
                return
            async with sem:
                await apply_locomo_judge_to_saved_result(
                    data, qa, conv_idx, answerer, judge_llm, cutoffs, evidence_lookup,
                )
                save_result_json(path, data)

        await asyncio.gather(*[
            judge_one(qid, conv_idx, qi, qa)
            for qid, conv_idx, qi, qa in expected_items
        ])

        all_evaluations = [
            json.loads(Path(os.path.join(output_dir, f"{qid}.json")).read_text(encoding="utf-8"))
            for qid, _, _, _ in expected_items
        ]
        metrics = compute_locomo_metrics(all_evaluations, cutoffs)
        display_results(metrics, cutoffs)

        run_id_meta = args.run_id or run_id

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unified_path = os.path.join(args.output_dir, f"locomo_results_{timestamp}.json")
        save_result_json(unified_path, {
            "metadata": {
                "benchmark": "locomo",
                "project_name": args.project_name,
                "run_id": run_id_meta,
                "timestamp": timestamp,
                "answerer_model": args.answerer_model,
                "judge_model": args.judge_model,
                "provider": args.provider,
                "top_k": args.top_k,
                "top_k_cutoffs": [cutoff_label(c) for c in cutoffs],
                "total_questions": len(all_evaluations),
                "categories": categories,
                "evaluate_only": True,
            },
            "metrics_by_cutoff": metrics,
            "evaluations": all_evaluations,
        })
        print(f"\nResults saved to: {unified_path}")
        print(f"\nTotal questions evaluated: {len(all_evaluations)}")
        return

    # Init Mem0 (not used for --evaluate-only)
    backend = os.getenv("MEM0_BACKEND", args.backend)
    mem0 = Mem0Client(
        mode=backend,
        host=args.mem0_host,
        api_key=args.mem0_api_key if backend == "cloud" else None,
        rpm=args.rpm,
    )
    shutdown = GracefulShutdown()
    checkpoint = Checkpoint(output_dir)

    all_evaluations: list[dict] = []

    if args.resume:
        for p in sorted(Path(output_dir).glob("*.json")):
            if p.name.startswith("_"):
                continue
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                if data.get("category") in categories:
                    all_evaluations.append(data)
            except (json.JSONDecodeError, KeyError):
                continue
        print(f"  Loaded {len(all_evaluations)} existing results")

    existing_ids = {e["question_id"] for e in all_evaluations}
    results_lock = asyncio.Lock()
    conv_semaphore = asyncio.Semaphore(args.max_workers)

    async def process_conversation(conv_idx: int):
        """Process a single conversation: ingest → answer questions."""
        async with conv_semaphore:
            if shutdown.requested:
                return
            if conv_idx >= len(dataset):
                logger.warning("Conversation %d out of range (dataset has %d)", conv_idx, len(dataset))
                return

            entry = dataset[conv_idx]
            conversation = entry["conversation"]

            # --- Ingest ---
            success, user_id, chunks = await ingest_conversation(
                conv_idx, entry, mem0, logger, run_id, args.project_name,
                output_dir, shutdown, debug=args.debug,
            )
            if not success:
                logger.error("Ingestion failed for conversation %d", conv_idx)

            if shutdown.requested:
                return

            # Fetch user profile if requested
            user_profile = None
            if args.user_profile:
                user_profile = await mem0.get_user_profile(user_id)

            # Get reference date from first session
            sorted_sessions = get_sorted_sessions(conversation)
            ref_date_human = None
            if sorted_sessions:
                ref_date_human = sorted_sessions[-1][1]

            # --- Process questions ---
            questions = entry.get("qa", entry.get("qa_pairs", []))
            conv_questions = [
                (qi, qa) for qi, qa in enumerate(questions)
                if qa.get("category") in categories
            ]
            if args.max_questions is not None:
                conv_questions = conv_questions[:args.max_questions]

            search_pbar = tqdm(conv_questions, desc=f"Questions conv {conv_idx}", leave=True)
            for qi, qa in search_pbar:
                qid = f"conv{conv_idx}_q{qi}"

                if shutdown.requested:
                    break

                # Skip if already done
                async with results_lock:
                    if qid in existing_ids:
                        continue

                result = await process_question(
                    qa=qa,
                    qa_idx=qi,
                    conv_idx=conv_idx,
                    user_id=user_id,
                    mem0=mem0,
                    answerer=answerer,
                    judge_llm=judge_llm,
                    cutoffs=cutoffs,
                    top_k=args.top_k,
                    reference_date_human=ref_date_human,
                    user_profile=user_profile,
                    evidence_lookup=evidence_lookup,
                    predict_only=args.predict_only,
                    logger=logger,
                    score_debug=args.score_debug,
                )

                # Save per-question result
                result_path = os.path.join(output_dir, f"{qid}.json")
                save_result_json(result_path, result)
                async with results_lock:
                    all_evaluations.append(result)
                    existing_ids.add(qid)

    async with mem0:
        with shutdown:
            tasks = [process_conversation(idx) for idx in conv_indices]
            await asyncio.gather(*tasks)

    # --- Metrics ---
    if not args.predict_only and all_evaluations:
        has_cutoffs = any("cutoff_results" in e for e in all_evaluations)
        if has_cutoffs:
            metrics = compute_locomo_metrics(all_evaluations, cutoffs)
            display_results(metrics, cutoffs)

            # Save unified result
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            unified_path = os.path.join(args.output_dir, f"locomo_results_{timestamp}.json")
            save_result_json(unified_path, {
                "metadata": {
                    "benchmark": "locomo",
                    "project_name": args.project_name,
                    "run_id": run_id,
                    "timestamp": timestamp,
                    "answerer_model": args.answerer_model,
                    "judge_model": args.judge_model,
                    "provider": args.provider,
                    "top_k": args.top_k,
                    "top_k_cutoffs": [cutoff_label(c) for c in cutoffs],
                    "total_questions": len(all_evaluations),
                    "categories": categories,
                },
                "metrics_by_cutoff": metrics,
                "evaluations": all_evaluations,
            })
            print(f"\nResults saved to: {unified_path}")

    print(f"\nTotal questions processed: {len(all_evaluations)}")


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
