"""
BEAM Benchmark Runner
=====================

Combined ingest + search + answer + judge pipeline for the BEAM benchmark
(ICLR 2026).  100 conversations x 4 size buckets (100K--10M tokens),
20 probing questions each spanning 10 memory ability types.

Flow:
    1. Download dataset from HuggingFace (auto-cached locally)
    2. For each conversation:
        a. Parse chat into batches, ingest via Mem0 (chunked)
        b. For each probing question:
            - Search Mem0 -> retrieved memories
            - Generate answer (answerer model)
            - Judge with rubric-based nugget scoring (0/0.5/1.0 per nugget)
            - Optional Kendall tau-b for event_ordering questions
            - Save per-question checkpoint
    3. Compute metrics (by question type, by cutoff)
    4. Write unified result JSON

Usage:
    python -m benchmarks.beam.run --project-name test
    python -m benchmarks.beam.run --project-name full --chat-sizes 100K,500K
    python -m benchmarks.beam.run --project-name test --predict-only
    python -m benchmarks.beam.run --project-name test --evaluate-only
"""

from __future__ import annotations

import argparse
import ast
import asyncio
import json
import os
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
from benchmarks.common.metrics import compute_kendall_tau_b, compute_overall_metrics
from benchmarks.common.schema import (
    CutoffResult,
    EvalItem,
    NuggetScore,
    Metadata,
    Metrics,
    UnifiedResult,
)
from benchmarks.common.utils import (
    Checkpoint,
    GracefulShutdown,
    IngestionCheckpoint,
    cutoff_label,
    parse_cutoffs,
    save_result_json,
    setup_logging,
)

from .prompts import (
    BEAM_JUDGE_SYSTEM_PROMPT,
    BEAM_QUESTION_TYPES,
    get_beam_answer_generation_prompt,
    get_beam_event_alignment_prompt,
    get_beam_fact_extraction_prompt,
    get_beam_nugget_judge_prompt,
)

load_dotenv(override=True)

# ===============================================================================
# CONSTANTS
# ===============================================================================

HF_DATASET_NAME = "Mohammadta/BEAM"
HF_DATASET_10M = "Mohammadta/BEAM-10M"
HF_SPLIT_MAP: dict[str, str] = {"100K": "100K", "500K": "500K", "1M": "1M", "10M": "10M"}
VALID_CHAT_SIZES = ["100K", "500K", "1M", "10M"]
DEFAULT_DATASET_DIR = "datasets/beam"
CHUNK_SIZE = 2  # turns per ingestion chunk


# ===============================================================================
# DATASET
# ===============================================================================


def download_dataset(
    chat_sizes: list[str],
    cache_dir: str,
    logger: Any,
) -> dict[str, list[dict]]:
    """Download BEAM dataset from HuggingFace, cache locally.

    Returns:
        Dict mapping chat_size -> list of conversation dicts.
    """
    os.makedirs(cache_dir, exist_ok=True)
    dataset: dict[str, list[dict]] = {}

    for size in chat_sizes:
        cache_path = os.path.join(cache_dir, f"beam_{size}.json")

        if os.path.exists(cache_path):
            logger.info("Loading cached %s dataset: %s", size, cache_path)
            with open(cache_path, "r", encoding="utf-8") as f:
                dataset[size] = json.load(f)
            continue

        logger.info("Downloading BEAM %s dataset from HuggingFace...", size)
        try:
            from datasets import load_dataset as hf_load

            if size == "10M":
                ds = hf_load(HF_DATASET_10M, split="10M")
            else:
                ds = hf_load(HF_DATASET_NAME, split=HF_SPLIT_MAP[size])

            conversations: list[dict] = []
            for idx, item in enumerate(ds):
                conv: dict[str, Any] = {
                    "conversation_id": item.get("conversation_id", f"{size}_{idx}"),
                    "conversation_seed": item.get("conversation_seed", {}),
                    "user_profile": item.get("user_profile", {}),
                    "chat": item.get("chat", []),
                }

                # probing_questions may be stored as a string repr in HF
                pq_raw = item.get("probing_questions", "{}")
                if isinstance(pq_raw, str):
                    try:
                        conv["probing_questions"] = ast.literal_eval(pq_raw)
                    except (ValueError, SyntaxError):
                        try:
                            conv["probing_questions"] = json.loads(pq_raw)
                        except json.JSONDecodeError:
                            logger.warning(
                                "Could not parse probing_questions for %s[%d]",
                                size,
                                idx,
                            )
                            conv["probing_questions"] = {}
                else:
                    conv["probing_questions"] = pq_raw if isinstance(pq_raw, dict) else {}

                conversations.append(conv)

            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(conversations, f, ensure_ascii=False)
            logger.info("Downloaded and cached %s: %d conversations", size, len(conversations))
            dataset[size] = conversations

        except Exception as exc:
            raise RuntimeError(
                f"Failed to download BEAM {size} dataset: {exc}\n"
                f"Install datasets: pip install datasets\n"
                f"Or manually download and place in {cache_dir}"
            ) from exc

    return dataset


# ===============================================================================
# CHAT PARSING
# ===============================================================================


def _unwrap_batch_dicts(batch_dicts: list[dict]) -> list[list[dict]]:
    """Unwrap a list of batch dicts (with ``turns`` key) into flat turn lists."""
    batches: list[list[dict]] = []
    for batch in batch_dicts:
        turns = batch.get("turns", [])
        flat_turns: list[dict] = []
        for item in turns:
            if isinstance(item, list):
                flat_turns.extend(item)
            elif isinstance(item, dict):
                flat_turns.append(item)
        batches.append(flat_turns)
    return batches


def parse_beam_chat(chat_data: Any) -> list[list[dict]]:
    """Parse BEAM chat data into list of batches, each a list of turn dicts.

    Handles three HuggingFace storage formats:
    - 1M and smaller: chat is a 2D list ``[[turn, ...], ...]``
    - 10M: chat is a list of session dicts mapping plan keys to batch lists
    - Batch-dict format: chat is a list of dicts with ``"turns"`` key
    """
    if not chat_data:
        return []

    # List of dicts with "turns" key -> unwrap
    if (
        isinstance(chat_data, list)
        and chat_data
        and isinstance(chat_data[0], dict)
        and "turns" in chat_data[0]
    ):
        return _unwrap_batch_dicts(chat_data)

    # 10M plan-based format: list of session dicts
    if (
        isinstance(chat_data, list)
        and chat_data
        and isinstance(chat_data[0], dict)
        and "turns" not in chat_data[0]
    ):
        first_session = chat_data[0]
        sample_val = next(iter(first_session.values()), None)
        is_plan_format = (
            isinstance(sample_val, list)
            and sample_val
            and isinstance(sample_val[0], dict)
            and "turns" in sample_val[0]
        )
        if is_plan_format:
            batches: list[list[dict]] = []
            for session in chat_data:
                if not isinstance(session, dict):
                    continue
                plan_keys = sorted(
                    session.keys(),
                    key=lambda k: int(k.split("-")[-1]) if k.split("-")[-1].isdigit() else 0,
                )
                for plan_key in plan_keys:
                    plan_batches = session[plan_key]
                    if plan_batches is None:
                        continue
                    batches.extend(_unwrap_batch_dicts(plan_batches))
            return batches

        # Single flat list of turn dicts
        if "role" in first_session or "content" in first_session:
            return [chat_data]
        return []

    # Already a 2D list
    if isinstance(chat_data, list) and chat_data and isinstance(chat_data[0], list):
        return chat_data

    return []


def batch_to_chunks(turns: list[dict], chunk_size: int = CHUNK_SIZE) -> list[list[dict]]:
    """Convert turns in a batch to message chunks for ingestion."""
    messages: list[dict] = []
    for turn in turns:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        if not content:
            continue
        if role not in ("user", "assistant"):
            role = "user" if role.lower() in ("human", "user") else "assistant"
        messages.append({"role": role, "content": content})

    chunks: list[list[dict]] = []
    for i in range(0, len(messages), chunk_size):
        chunk = messages[i : i + chunk_size]
        if chunk:
            chunks.append(chunk)
    return chunks


def get_time_anchor_epoch(turns: list[dict]) -> int | None:
    """Extract the earliest time_anchor from a batch and convert to epoch."""
    for turn in turns:
        anchor = turn.get("time_anchor")
        if anchor:
            try:
                from dateutil.parser import parse as dateparse

                dt = dateparse(anchor.replace("-", " "))
                return int(dt.timestamp())
            except Exception:
                pass
    return None


# ===============================================================================
# PROBING QUESTIONS
# ===============================================================================


def extract_probing_questions(conversation: dict) -> list[dict]:
    """Extract all probing questions from a BEAM conversation.

    BEAM has 10 question types, 2 questions per type = 20 per conversation.
    The ``probing_questions`` field is a dict keyed by question_type.
    """
    pq = conversation.get("probing_questions", {})
    if not pq:
        return []

    questions: list[dict] = []
    for q_type in BEAM_QUESTION_TYPES:
        type_questions = pq.get(q_type, [])
        if isinstance(type_questions, list):
            for q in type_questions:
                if isinstance(q, dict):
                    q["question_type"] = q_type
                    questions.append(q)
                elif isinstance(q, str):
                    questions.append({"question_type": q_type, "question_text": q, "rubric": []})
        elif isinstance(type_questions, dict):
            type_questions["question_type"] = q_type
            questions.append(type_questions)

    return questions


def extract_rubric_nuggets(question_data: dict) -> list[str]:
    """Extract rubric nugget descriptions from a question dict."""
    rubric_raw = question_data.get("rubric", {})
    if isinstance(rubric_raw, dict):
        nuggets = rubric_raw.get("nuggets", [])
        return [
            n.get("description", str(n)) if isinstance(n, dict) else str(n)
            for n in nuggets
        ]
    if isinstance(rubric_raw, list):
        return [str(n) for n in rubric_raw]
    if rubric_raw:
        return [str(rubric_raw)]
    return []


# ===============================================================================
# INGESTION
# ===============================================================================


async def ingest_conversation(
    chat_size: str,
    conv_idx: int,
    conversation: dict,
    mem0: Mem0Client,
    logger: Any,
    run_id: str,
    output_dir: str,
    shutdown: GracefulShutdown,
    debug: bool = True,
) -> tuple[bool, str, int]:
    """Ingest all batches of a BEAM conversation into Mem0.

    Returns:
        (success, user_id, total_chunks_processed)
    """
    user_id = f"beam_{chat_size}_{conv_idx}_{run_id}"
    chat_data = conversation.get("chat", [])
    batches = parse_beam_chat(chat_data)

    checkpoint = IngestionCheckpoint(output_dir)
    key = f"{chat_size}_{conv_idx}"

    # Check if already complete
    is_done, cp_data = checkpoint.is_complete(key, CHUNK_SIZE)
    if is_done and cp_data:
        chunks_done = cp_data.get("total_chunks_processed", 0)
        user_id = cp_data.get("user_id", user_id)
        logger.info(
            "[%s][%d] Already ingested (user_id=%s, %d chunks)",
            chat_size,
            conv_idx,
            user_id,
            chunks_done,
        )
        return True, user_id, chunks_done

    # Check for partial progress
    chunks_already_done, resumed_uid = checkpoint.load_progress(key, CHUNK_SIZE)
    if resumed_uid and chunks_already_done:
        user_id = resumed_uid
        logger.info(
            "[%s][%d] Resuming from %d completed chunks",
            chat_size,
            conv_idx,
            len(chunks_already_done),
        )

    total_chunks = sum(len(batch_to_chunks(b)) for b in batches)
    conv_seed = conversation.get("conversation_seed", {})
    category = conv_seed.get("category", "unknown") if isinstance(conv_seed, dict) else "unknown"

    logger.info(
        "[%s][%d] Ingesting: %d batches, %d chunks (category=%s)",
        chat_size,
        conv_idx,
        len(batches),
        total_chunks,
        category,
    )

    # Debug log file
    debug_file = None
    if debug:
        debug_dir = os.path.join(output_dir, "debug")
        os.makedirs(debug_dir, exist_ok=True)
        debug_path = os.path.join(debug_dir, f"beam_{chat_size}_{conv_idx}_ingestion.txt")
        debug_mode = "a" if chunks_already_done else "w"
        debug_file = open(debug_path, debug_mode, encoding="utf-8", buffering=1)
        if not chunks_already_done:
            debug_file.write(f"{'=' * 80}\n")
            debug_file.write(f"CONVERSATION {chat_size}/{conv_idx}: {category}\n")
            debug_file.write(f"Batches: {len(batches)}, Chunks: {total_chunks} (size={CHUNK_SIZE})\n")
            debug_file.write(f"User ID: {user_id}\n")
            debug_file.write(f"{'=' * 80}\n\n")

    pbar = tqdm(
        total=total_chunks,
        desc=f"Ingest {chat_size}/{conv_idx}",
        initial=len(chunks_already_done),
        leave=True,
    )
    total_processed = len(chunks_already_done)
    total_failed = 0

    for batch_idx, batch_turns in enumerate(batches):
        chunks = batch_to_chunks(batch_turns)
        if not chunks:
            continue

        time_epoch = get_time_anchor_epoch(batch_turns)

        if debug_file and f"batch_{batch_idx}_header" not in chunks_already_done:
            time_anchor_str = None
            for t in batch_turns:
                if t.get("time_anchor"):
                    time_anchor_str = t["time_anchor"]
                    break
            debug_file.write(f"\n{'---' * 27}\n")
            debug_file.write(
                f"SESSION: batch_{batch_idx}  |  Date: {time_anchor_str or 'N/A'}  "
                f"|  Epoch: {time_epoch}  |  Chunks: {len(chunks)}\n"
            )
            debug_file.write(f"{'---' * 27}\n\n")

        for chunk_idx, messages in enumerate(chunks):
            chunk_key = f"batch_{batch_idx}_c{chunk_idx}"

            if chunk_key in chunks_already_done:
                continue

            if shutdown.requested:
                logger.info(
                    "Shutdown at %s/%d, chunk %s", chat_size, conv_idx, chunk_key
                )
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

            response = await mem0.add(messages, user_id, timestamp=time_epoch)

            if response is not None:
                total_processed += 1
                if debug_file:
                    results = response.get("results", [])
                    if results:
                        debug_file.write(f"--- Chunk {chunk_idx} (extracted) ---\n")
                        for mem_item in results:
                            mem_text = mem_item.get("memory", "")
                            if not mem_text:
                                data = mem_item.get("data", {})
                                if isinstance(data, dict):
                                    mem_text = data.get("memory", "")
                            event_type = mem_item.get("event", "")
                            debug_file.write(f"  [{event_type}] {mem_text}\n")
                        debug_file.write("\n")
            else:
                total_failed += 1
                logger.warning(
                    "Ingestion failed: %s/%d batch_%d chunk %d",
                    chat_size,
                    conv_idx,
                    batch_idx,
                    chunk_idx,
                )

            chunks_already_done.add(chunk_key)
            checkpoint.save_progress(
                key,
                {
                    "chat_size": chat_size,
                    "conversation_idx": conv_idx,
                    "user_id": user_id,
                    "run_id": run_id,
                    "chunk_size": CHUNK_SIZE,
                    "completed_chunks": list(chunks_already_done),
                },
            )
            pbar.update(1)

    pbar.close()
    if debug_file:
        debug_file.write(
            f"\nSUMMARY: {total_processed}/{total_chunks} OK, {total_failed} failed\n"
        )
        debug_file.close()

    checkpoint.save_complete(
        key,
        {
            "chat_size": chat_size,
            "conversation_idx": conv_idx,
            "conversation_id": conversation.get("conversation_id", ""),
            "user_id": user_id,
            "run_id": run_id,
            "chunk_size": CHUNK_SIZE,
            "total_chunks_processed": total_processed,
            "total_chunks_failed": total_failed,
        },
    )

    return total_failed == 0, user_id, total_processed


# ===============================================================================
# NUGGET JUDGING
# ===============================================================================


def _clamp_nugget_score(raw_score: float) -> float:
    """Clamp a raw score to 0.0 / 0.5 / 1.0."""
    if raw_score >= 0.75:
        return 1.0
    if raw_score >= 0.25:
        return 0.5
    return 0.0


async def judge_single_nugget(
    question: str,
    nugget: str,
    generated_answer: str,
    judge_llm: LLMClient,
) -> dict[str, Any]:
    """Judge a single rubric nugget.

    Returns:
        ``{"score": 0.0|0.5|1.0, "reason": "..."}``
    """
    prompt = get_beam_nugget_judge_prompt(question, nugget, generated_answer)
    raw = await judge_llm.generate_structured(
        system=BEAM_JUDGE_SYSTEM_PROMPT,
        user=prompt,
    )
    if isinstance(raw, dict):
        try:
            score = _clamp_nugget_score(float(raw.get("score", 0.0)))
        except (ValueError, TypeError):
            score = 0.0
        return {"score": score, "reason": raw.get("reason", "")}

    # Fallback: look for score in text
    raw_str = str(raw)
    if "1.0" in raw_str:
        return {"score": 1.0, "reason": raw_str[:200]}
    if "0.5" in raw_str:
        return {"score": 0.5, "reason": raw_str[:200]}
    return {"score": 0.0, "reason": f"Parse error: {raw_str[:200]}"}


# ===============================================================================
# EVENT ORDERING (Kendall tau-b)
# ===============================================================================


async def compute_event_ordering_score(
    question: str,
    rubric_nuggets: list[str],
    generated_answer: str,
    judge_llm: LLMClient,
    logger: Any,
) -> dict[str, Any]:
    """Compute Kendall tau-b score for event_ordering questions.

    Steps:
        1. Extract ordered facts from the LLM response.
        2. Align each extracted fact to a rubric event.
        3. Compute Kendall tau-b between predicted and reference orderings.

    Returns:
        Dict with ``tau_b``, ``predicted_order``, ``reference_order`` keys.
    """
    # Step 1: extract ordered events
    extract_prompt = get_beam_fact_extraction_prompt(generated_answer)
    extract_raw = await judge_llm.generate_structured(
        system="Extract events as a JSON array of strings.",
        user=extract_prompt,
    )

    extracted_events: list[str] = []
    if isinstance(extract_raw, dict):
        # Some models wrap in a key
        for key in ("events", "facts", "result"):
            if key in extract_raw and isinstance(extract_raw[key], list):
                extracted_events = extract_raw[key]
                break
    elif isinstance(extract_raw, list):
        extracted_events = extract_raw

    if not extracted_events or not rubric_nuggets:
        return {"tau_b": 0.0, "predicted_order": [], "reference_order": []}

    # Step 2: align each extracted event to a rubric event
    predicted_indices: list[int] = []
    for event in extracted_events:
        align_prompt = get_beam_event_alignment_prompt(event, rubric_nuggets)
        align_raw = await judge_llm.generate_structured(
            system="Align the event to a reference event index. Return JSON.",
            user=align_prompt,
        )
        idx = -1
        if isinstance(align_raw, dict):
            try:
                idx = int(align_raw.get("index", -1))
            except (ValueError, TypeError):
                idx = -1
        if 0 <= idx < len(rubric_nuggets):
            predicted_indices.append(idx)

    # Step 3: Kendall tau-b
    reference_order = list(range(len(rubric_nuggets)))
    tau_b = compute_kendall_tau_b(predicted_indices, reference_order)

    return {
        "tau_b": round(tau_b, 4),
        "predicted_order": predicted_indices,
        "reference_order": reference_order,
    }


# ===============================================================================
# SEARCH + ANSWER + JUDGE
# ===============================================================================


async def process_question(
    question_data: dict,
    qi: int,
    chat_size: str,
    conv_idx: int,
    user_id: str,
    mem0: Mem0Client,
    answerer: LLMClient,
    judge_llm: LLMClient,
    cutoffs: list[int],
    top_k: int,
    predict_only: bool,
    logger: Any,
    score_debug: bool = False,
    conversation_meta: dict | None = None,
) -> dict[str, Any]:
    """Process a single question: search + answer + rubric judge at multiple cutoffs.

    Returns:
        Result dict suitable for JSON serialization and checkpointing.
    """
    question_type = question_data.get("question_type", "unknown")
    question_id = f"{chat_size}_{conv_idx}_q{qi}_{question_type}"
    question_text = question_data.get("question_text", question_data.get("question", ""))
    rubric = extract_rubric_nuggets(question_data)

    # --- Search ---
    start = time.monotonic()
    search_results = await mem0.search(
        question_text, user_id, top_k=top_k, score_debug=score_debug
    )
    search_latency = (time.monotonic() - start) * 1000

    formatted, query_debug = format_search_results(search_results)

    result: dict[str, Any] = {
        "question_id": question_id,
        "chat_size": chat_size,
        "conversation_idx": conv_idx,
        "conversation_id": (conversation_meta or {}).get("conversation_id", ""),
        "question_type": question_type,
        "question_type_idx": qi,
        "difficulty": question_data.get("difficulty", "unknown"),
        "question": question_text,
        "rubric": rubric,
        "ground_truth_answer": " | ".join(rubric),
        "source_chat_ids": question_data.get("source_chat_ids", []),
        "user_id": user_id,
        "retrieval": {
            "search_query": question_text,
            "search_results": formatted,
            "search_latency_ms": round(search_latency, 1),
            "total_results": len(formatted),
        },
    }
    if query_debug:
        result["retrieval"]["query_debug"] = query_debug

    if predict_only:
        return result

    # --- Answer + Judge at each cutoff ---
    cutoff_results: dict[str, dict[str, Any]] = {}

    for c in cutoffs:
        sliced = formatted[:c]
        label = cutoff_label(c)

        # Sort memories chronologically (oldest first) before answer generation
        def _sort_key(m):
            if isinstance(m, dict):
                return m.get("created_at", "") or ""
            return ""
        sliced = sorted(sliced, key=_sort_key)

        # Generate answer
        gen_prompt = get_beam_answer_generation_prompt(question_text, sliced, top_k=c)
        generated_answer = await answerer.generate(system="", user=gen_prompt)
        if "ANSWER:" in generated_answer:
            generated_answer = generated_answer.rsplit("ANSWER:", 1)[-1].strip()

        if not rubric:
            cutoff_results[label] = {
                "judgment": "ERROR",
                "score": 0.0,
                "generated_answer": generated_answer,
                "memories_evaluated": len(sliced),
                "nugget_scores": [],
                "error": "No rubric nuggets found",
            }
            continue

        # Judge each nugget independently
        nugget_scores: list[dict[str, Any]] = []
        for nugget in rubric:
            ns = await judge_single_nugget(question_text, nugget, generated_answer, judge_llm)
            nugget_scores.append({
                "nugget": nugget,
                "score": ns["score"],
                "reason": ns["reason"],
            })

        # Question score = mean of nugget scores
        avg_score = (
            statistics.mean(ns["score"] for ns in nugget_scores)
            if nugget_scores
            else 0.0
        )

        cr: dict[str, Any] = {
            "judgment": "PASS" if avg_score >= 0.5 else "FAIL",
            "score": round(avg_score, 4),
            "generated_answer": generated_answer,
            "memories_evaluated": len(sliced),
            "nugget_scores": nugget_scores,
        }

        # Event ordering: additionally compute Kendall tau-b
        if question_type == "event_ordering":
            try:
                tau_result = await compute_event_ordering_score(
                    question_text,
                    rubric,
                    generated_answer,
                    judge_llm,
                    logger,
                )
                cr["event_ordering"] = tau_result
                # Combine: average of nugget score and normalized tau-b (mapped to 0-1)
                tau_normalized = (tau_result["tau_b"] + 1.0) / 2.0  # map [-1,1] to [0,1]
                combined = (avg_score + tau_normalized) / 2.0
                cr["score_with_tau"] = round(combined, 4)
            except Exception as exc:
                logger.warning(
                    "Event ordering tau-b failed for %s: %s", question_id, exc
                )

        cutoff_results[label] = cr

    result["cutoff_results"] = cutoff_results
    return result


# ===============================================================================
# METRICS + DISPLAY
# ===============================================================================


def compute_beam_metrics(
    evaluations: list[dict],
    cutoffs: list[int],
) -> dict[str, Any]:
    """Compute per-question-type and overall metrics at each cutoff."""
    metrics_by_cutoff: dict[str, Any] = {}
    pass_threshold = 0.5

    for c in cutoffs:
        label = cutoff_label(c)
        scores: list[float] = []
        for e in evaluations:
            cr = e.get("cutoff_results", {}).get(label, {})
            scores.append(cr.get("score", 0.0))

        total = len(scores)
        correct = sum(1 for s in scores if s >= pass_threshold)
        errors = sum(
            1
            for e in evaluations
            if e.get("cutoff_results", {}).get(label, {}).get("error")
        )

        by_type: dict[str, list[dict]] = defaultdict(list)
        for e in evaluations:
            by_type[e.get("question_type", "unknown")].append(e)

        type_metrics: dict[str, dict[str, Any]] = {}
        for qt in sorted(by_type):
            items = by_type[qt]
            qt_scores = [
                i.get("cutoff_results", {}).get(label, {}).get("score", 0.0)
                for i in items
            ]
            qt_correct = sum(1 for s in qt_scores if s >= pass_threshold)
            type_metrics[qt] = {
                "total": len(items),
                "correct": qt_correct,
                "accuracy": qt_correct / len(items) * 100 if items else 0.0,
                "avg_score": statistics.mean(qt_scores) if qt_scores else 0.0,
            }

        metrics_by_cutoff[label] = {
            "overall": {
                "total": total,
                "correct": correct,
                "errors": errors,
                "accuracy": correct / total * 100 if total > 0 else 0.0,
                "avg_score": statistics.mean(scores) if scores else 0.0,
            },
            "by_question_type": type_metrics,
        }

    return metrics_by_cutoff


def display_results(
    metrics_by_cutoff: dict[str, Any],
    cutoffs: list[int],
) -> None:
    """Print metrics to console."""
    labels = [cutoff_label(c) for c in cutoffs]

    for label in labels:
        m = metrics_by_cutoff.get(label, {})
        overall = m.get("overall", {})
        print(f"\n--- {label} ---")
        print(
            f"  Overall: {overall.get('correct', 0)}/{overall.get('total', 0)} "
            f"pass (>= 0.5)  |  avg_score={overall.get('avg_score', 0):.3f}  "
            f"|  errors={overall.get('errors', 0)}"
        )
        for qt, tm in sorted(m.get("by_question_type", {}).items()):
            print(
                f"  {qt}: {tm['correct']}/{tm['total']} "
                f"({tm['accuracy']:.1f}%)  avg={tm['avg_score']:.3f}"
            )


# ===============================================================================
# CLI
# ===============================================================================


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run BEAM benchmark: ingest + search + answer + rubric judge",
    )
    parser.add_argument("--project-name", required=True, help="Name for this eval run")
    parser.add_argument(
        "--answerer-model", default="gpt-5", help="Model for answer generation"
    )
    parser.add_argument("--judge-model", default="gpt-5", help="Model for rubric judging")
    parser.add_argument(
        "--provider", default="openai", help="LLM provider (openai, anthropic, azure)"
    )
    parser.add_argument(
        "--judge-provider", default=None, help="Judge provider (defaults to --provider)"
    )
    parser.add_argument(
        "--chat-sizes",
        default="100K",
        help="Comma-separated chat sizes: 100K,500K,1M,10M (default: 100K)",
    )
    parser.add_argument(
        "--conversations",
        default="0-99",
        help="Conversation indices: 0-99 or 0,1,5 (default: 0-99)",
    )
    parser.add_argument(
        "--top-k", type=int, default=200, help="Number of search results to retrieve"
    )
    parser.add_argument(
        "--top-k-cutoffs",
        default="100",
        help="Comma-separated cutoffs for evaluation (default: 100)",
    )
    parser.add_argument(
        "--max-workers", type=int, default=10, help="Max parallel workers"
    )
    parser.add_argument("--output-dir", default="results/beam", help="Output directory")
    parser.add_argument(
        "--predict-only",
        action="store_true",
        help="Skip answer+judge, only ingest+search",
    )
    parser.add_argument(
        "--evaluate-only",
        action="store_true",
        help="Skip ingest+search, evaluate existing predict results",
    )
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    parser.add_argument("--debug", action="store_true", help="Verbose logging + debug files")
    parser.add_argument(
        "--score-debug",
        action="store_true",
        help="Include score breakdowns in search output",
    )
    parser.add_argument("--run-id", default=None, help="Reuse a specific run_id for resume")
    parser.add_argument(
        "--dataset-cache-dir", default=None, help="Local cache for HF dataset"
    )
    parser.add_argument(
        "--question-types",
        default=None,
        help="Comma-separated question types to evaluate (default: all)",
    )
    parser.add_argument("--rpm", type=int, default=200, help="Requests per minute for LLM")
    parser.add_argument("--backend", default="oss", choices=["oss", "cloud"],
                        help="Mem0 backend: 'oss' for self-hosted server (default), 'cloud' for api.mem0.ai")
    parser.add_argument("--mem0-host", default=None,
                        help="Mem0 server URL")
    parser.add_argument("--mem0-api-key", default=None,
                        help="Mem0 API key (cloud mode only)")
    return parser.parse_args()


def _parse_conversation_indices(spec: str) -> list[int]:
    """Parse conversation index specification.

    Supports:
        - Range:  ``"0-99"``
        - List:   ``"0,1,5,10"``
        - Mixed:  ``"0-9,50,90-99"``
    """
    indices: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            lo, hi = part.split("-", 1)
            indices.extend(range(int(lo), int(hi) + 1))
        else:
            indices.append(int(part))
    return sorted(set(indices))


# ===============================================================================
# MAIN
# ===============================================================================


async def async_main() -> None:
    args = parse_args()
    logger = setup_logging("beam", debug=args.debug)

    cutoffs = parse_cutoffs(args.top_k_cutoffs)
    chat_sizes = [s.strip() for s in args.chat_sizes.split(",")]
    for s in chat_sizes:
        if s not in VALID_CHAT_SIZES:
            print(f"ERROR: Invalid chat size '{s}'. Valid: {VALID_CHAT_SIZES}")
            sys.exit(1)

    conv_indices = _parse_conversation_indices(args.conversations)
    q_type_filter = (
        set(args.question_types.split(",")) if args.question_types else None
    )

    run_id = args.run_id or uuid.uuid4().hex[:8]
    output_dir = os.path.join(args.output_dir, f"predicted_{args.project_name}")
    os.makedirs(output_dir, exist_ok=True)
    cache_dir = args.dataset_cache_dir or DEFAULT_DATASET_DIR

    print(f"BEAM Benchmark | project={args.project_name} run_id={run_id}")
    print(f"  Answerer: {args.answerer_model} ({args.provider})")
    print(f"  Judge: {args.judge_model} ({args.judge_provider or args.provider})")
    print(f"  Chat sizes: {args.chat_sizes}")
    print(f"  Conversations: {args.conversations}")
    print(f"  Cutoffs: {args.top_k_cutoffs}")

    # Download dataset
    dataset = download_dataset(chat_sizes, cache_dir, logger)

    # Init clients
    backend = os.getenv("MEM0_BACKEND", args.backend)
    mem0 = Mem0Client(
        mode=backend,
        host=args.mem0_host,
        api_key=args.mem0_api_key if backend == "cloud" else None,
        rpm=args.rpm,
    )
    answerer = LLMClient(
        model=args.answerer_model, provider=args.provider, rpm=args.rpm
    )
    judge_provider = args.judge_provider or args.provider
    judge_llm = LLMClient(
        model=args.judge_model, provider=judge_provider, rpm=args.rpm
    )
    shutdown = GracefulShutdown()

    all_evaluations: list[dict] = []

    # Load existing results for resume / evaluate-only
    if args.resume or args.evaluate_only:
        for p in sorted(Path(output_dir).glob("*.json")):
            if p.name.startswith("_"):
                continue
            try:
                data = json.loads(p.read_text())
                if data.get("question_id"):
                    all_evaluations.append(data)
            except (json.JSONDecodeError, KeyError):
                continue
        print(f"  Loaded {len(all_evaluations)} existing results")

    if args.evaluate_only:
        if not all_evaluations:
            print("No results found for evaluate-only mode.")
            return
        has_cutoffs = any("cutoff_results" in e for e in all_evaluations)
        if has_cutoffs:
            metrics = compute_beam_metrics(all_evaluations, cutoffs)
            display_results(metrics, cutoffs)
        else:
            print("Results don't have cutoff_results. Run without --evaluate-only first.")
        return

    existing_ids = {e["question_id"] for e in all_evaluations}

    # Track user_ids: (chat_size, conv_idx) -> user_id
    conv_user_ids: dict[tuple[str, int], str] = {}

    async with mem0:
        with shutdown:
            # === Phase 1: Ingestion ===
            for size in chat_sizes:
                convs = dataset[size]
                indices = [i for i in conv_indices if i < len(convs)]

                if not indices:
                    logger.warning(
                        "No valid conversation indices for %s (dataset has %d)",
                        size,
                        len(convs),
                    )
                    continue

                print(f"\n=== Ingesting {len(indices)} {size} conversations ===")

                for ci in indices:
                    if shutdown.requested:
                        break

                    success, user_id, chunks = await ingest_conversation(
                        chat_size=size,
                        conv_idx=ci,
                        conversation=convs[ci],
                        mem0=mem0,
                        logger=logger,
                        run_id=run_id,
                        output_dir=output_dir,
                        shutdown=shutdown,
                        debug=args.debug,
                    )
                    conv_user_ids[(size, ci)] = user_id
                    if not success:
                        logger.warning("[%s][%d] Had failures during ingestion", size, ci)

            if shutdown.requested:
                print("Shutdown requested -- progress saved. Re-run to resume.")
                return

            # === Phase 2: Search + Answer + Judge ===
            all_questions: list[tuple] = []
            for size in chat_sizes:
                convs = dataset[size]
                indices = [i for i in conv_indices if i < len(convs)]
                for ci in indices:
                    key = (size, ci)
                    if key not in conv_user_ids:
                        # Try to recover user_id from ingestion checkpoint
                        cp = IngestionCheckpoint(output_dir)
                        is_done, cp_data = cp.is_complete(f"{size}_{ci}", CHUNK_SIZE)
                        if is_done and cp_data:
                            conv_user_ids[key] = cp_data["user_id"]
                        else:
                            conv_user_ids[key] = f"beam_{size}_{ci}_{run_id}"

                    user_id = conv_user_ids[key]
                    conv = convs[ci]
                    questions = extract_probing_questions(conv)

                    if q_type_filter:
                        questions = [
                            q for q in questions if q.get("question_type") in q_type_filter
                        ]

                    conv_meta = {
                        "conversation_id": conv.get("conversation_id", ""),
                        "conversation_seed": conv.get("conversation_seed", {}),
                    }

                    for qi, q in enumerate(questions):
                        all_questions.append((q, qi, size, ci, user_id, conv_meta))

            # Count already done
            already_done = sum(
                1
                for q, qi, size, ci, _, _ in all_questions
                if f"{size}_{ci}_q{qi}_{q.get('question_type', 'unknown')}" in existing_ids
            )
            remaining = len(all_questions) - already_done

            print(
                f"\n=== Processing {len(all_questions)} questions "
                f"({already_done} done, {remaining} remaining) ==="
            )

            if remaining > 0:
                pbar = tqdm(
                    total=len(all_questions),
                    initial=already_done,
                    desc="Questions",
                )

                for q_data, qi, size, ci, uid, meta in all_questions:
                    qid = f"{size}_{ci}_q{qi}_{q_data.get('question_type', 'unknown')}"

                    if shutdown.requested:
                        break

                    if qid in existing_ids:
                        continue

                    result = await process_question(
                        question_data=q_data,
                        qi=qi,
                        chat_size=size,
                        conv_idx=ci,
                        user_id=uid,
                        mem0=mem0,
                        answerer=answerer,
                        judge_llm=judge_llm,
                        cutoffs=cutoffs,
                        top_k=args.top_k,
                        predict_only=args.predict_only,
                        logger=logger,
                        score_debug=args.score_debug,
                        conversation_meta=meta,
                    )

                    # Save per-question checkpoint
                    result_path = os.path.join(output_dir, f"{qid}.json")
                    save_result_json(result_path, result)
                    all_evaluations.append(result)
                    existing_ids.add(qid)
                    pbar.update(1)

                pbar.close()

    # === Metrics ===
    if not args.predict_only and all_evaluations:
        has_cutoffs = any("cutoff_results" in e for e in all_evaluations)
        if has_cutoffs:
            metrics_by_cutoff = compute_beam_metrics(all_evaluations, cutoffs)
            display_results(metrics_by_cutoff, cutoffs)

            # Save unified result JSON
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            unified_path = os.path.join(
                args.output_dir, f"beam_results_{timestamp}.json"
            )
            save_result_json(
                unified_path,
                {
                    "metadata": {
                        "benchmark": "beam",
                        "project_name": args.project_name,
                        "run_id": run_id,
                        "timestamp": timestamp,
                        "answerer_model": args.answerer_model,
                        "judge_model": args.judge_model,
                        "provider": args.provider,
                        "judge_provider": judge_provider,
                        "top_k": args.top_k,
                        "top_k_cutoffs": [cutoff_label(c) for c in cutoffs],
                        "chat_sizes": chat_sizes,
                        "conversations": args.conversations,
                        "total_questions": len(all_evaluations),
                        "question_types": q_type_filter or BEAM_QUESTION_TYPES,
                    },
                    "metrics_by_cutoff": metrics_by_cutoff,
                    "evaluations": all_evaluations,
                },
            )
            print(f"\nResults saved to: {unified_path}")

    print(f"\nTotal questions processed: {len(all_evaluations)}")


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
