"""
LongMemEval Benchmark Runner
=============================

Combined ingest + search + answer + judge pipeline for the LongMemEval
benchmark (ICLR 2025).

Each of the 500 questions has its own conversation context (haystack_sessions)
that must be ingested into Mem0 before the question can be answered.

Supports two evaluation modes:
    - answerer (default): Generate answer from memories, then judge correctness
    - retrieval: Judge whether retrieved memories alone are sufficient

Flow:
    1. Download dataset (auto-download from HuggingFace if missing)
    2. Sample / filter questions by type
    3. For each question:
        a. Ingest haystack sessions into Mem0 (pair-level checkpoint)
        b. Search Mem0 -> retrieved memories
        c. (answerer) Generate answer, then judge correctness
           (retrieval) Judge if memories suffice
        d. Save per-question checkpoint
    4. Compute metrics (by question type, by cutoff)
    5. Write unified result JSON

Usage:
    python -m benchmarks.longmemeval.run --project-name test
    python -m benchmarks.longmemeval.run --project-name full --all-questions
    python -m benchmarks.longmemeval.run --project-name full --mode retrieval
    python -m benchmarks.longmemeval.run --project-name test --per-type 2
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
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
    QUESTION_TYPES,
    get_answer_generation_prompt,
    get_judge_prompt,
)

load_dotenv(override=True)

# ===============================================================================
# CONSTANTS
# ===============================================================================

DATASET_URL = (
    "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/"
    "resolve/main/longmemeval_s_cleaned.json"
)
DEFAULT_DATASET_DIR = "datasets/longmemeval"
DEFAULT_DATASET_FILE = "longmemeval_s_cleaned.json"
CHUNK_SIZE = 2  # messages per ingestion chunk (user+assistant pair)


# ===============================================================================
# RETRIEVAL JUDGE PROMPT
# ===============================================================================

RETRIEVAL_JUDGE_SYSTEM = (
    "You are a strict but fair evaluator for a memory retrieval system. "
    "Return JSON only with the format requested."
)

RETRIEVAL_JUDGE_PROMPT = """Determine whether the retrieved memories contain enough information to correctly answer the question.

## Evaluation Steps

1. **Core Intent**: What fact, preference, or piece of information must the memories provide?

2. **Abstention Case**: If the ground truth says the question is unanswerable ("I don't know", "not mentioned"):
   - PASS if memories are empty or would not lead to a confidently wrong answer.
   - FAIL only if memories would cause a hallucinated/incorrect answer.

3. **Evidence Check**: Do retrieved memories contain the key facts needed?
   - Action completion: "received X", "switched to X" implies current state
   - Semantic equivalence counts
   - Most recent memory is authoritative for conflicts
   - Reasonable inference counts
   - Date format variations and off-by-one on day counts are acceptable
   - Extra context beyond what is needed does not cause FAIL

4. **Double-Check**: Re-read memories. Does quoted text actually appear? Does it actually support the core intent?

5. **Verdict**: PASS if core intent is supported; FAIL if not.

## Input

Question: {question}
Question Date: {question_date}
Expected Answer: {answer}
{profile_section}
Retrieved Memories ({num_memories} total):
{memories_text}

## Output

Return exactly this JSON:
{{
    "core_intent": "<What the user needs to know>",
    "core_intent_supported": true/false,
    "supporting_evidence": "<Quote exact text from memories or explain what is missing>",
    "judgment": "PASS or FAIL",
    "reason": "<One sentence explanation>"
}}"""


def _format_retrieval_memories(
    search_results: list[dict],
    question_date: str = "",
) -> str:
    """Format search results into a numbered list for the retrieval judge."""
    if not search_results:
        return "(None)"
    lines = []
    for i, r in enumerate(search_results, 1):
        mem = r.get("memory", "")
        score = r.get("score", 0)
        created = r.get("created_at", "")
        parts = [f"{i}. {mem}"]
        if score:
            parts.append(f"(score={score:.4f})")
        if created:
            parts.append(f"[created: {created}]")
        lines.append(" ".join(parts))
    return "\n".join(lines)


def get_retrieval_judge_prompt(
    question: str,
    answer: str,
    search_results: list[dict],
    question_date: str = "",
    user_profile: dict | None = None,
) -> str:
    """Build the retrieval mode judge prompt."""
    memories_text = _format_retrieval_memories(search_results, question_date)
    profile_section = ""
    if user_profile:
        profile_lines = ["User Profile:"]
        for k, v in user_profile.items():
            if v is not None:
                profile_lines.append(f"  {k}: {v}")
        profile_section = "\n".join(profile_lines)

    return RETRIEVAL_JUDGE_PROMPT.format(
        question=question,
        question_date=question_date or "(not specified)",
        answer=str(answer),
        profile_section=profile_section,
        num_memories=len(search_results),
        memories_text=memories_text,
    )


# ===============================================================================
# DATASET
# ===============================================================================


def download_dataset(dataset_dir: str, logger: Any) -> str:
    """Download LongMemEval dataset from HuggingFace if not present."""
    path = os.path.join(dataset_dir, DEFAULT_DATASET_FILE)
    if os.path.exists(path):
        logger.info("Dataset already exists: %s", path)
        return path

    os.makedirs(dataset_dir, exist_ok=True)
    logger.info("Downloading LongMemEval dataset...")
    download_file(DATASET_URL, path, description="Downloading LongMemEval")

    with open(path) as f:
        data = json.load(f)
    if not isinstance(data, list) or len(data) < 500:
        os.remove(path)
        raise RuntimeError(
            f"Invalid dataset: expected 500 questions, got {len(data)}"
        )

    logger.info("Downloaded: %s (%d questions)", path, len(data))
    return path


def load_dataset(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ===============================================================================
# QUESTION SAMPLING
# ===============================================================================


def sample_questions_stratified(
    questions: list[dict],
    per_type: int = 5,
    seed: int = 42,
    selected_types: list[str] | None = None,
) -> list[dict]:
    """Sample questions stratified by question_type."""
    type_filter = set(selected_types) if selected_types else set(QUESTION_TYPES)

    groups: dict[str, list[dict]] = defaultdict(list)
    for q in questions:
        if q["question_type"] in type_filter:
            groups[q["question_type"]].append(q)

    for qtype in groups:
        groups[qtype].sort(key=lambda q: q["question_id"])

    rng = random.Random(seed)
    sampled = []
    for qtype in sorted(groups.keys()):
        group = groups[qtype]
        n = min(per_type, len(group))
        selected = rng.sample(group, n)
        sampled.extend(selected)

    sampled.sort(key=lambda q: q["question_id"])
    return sampled


# ===============================================================================
# SESSION AND TURN PROCESSING
# ===============================================================================


def parse_longmemeval_date(date_str: str) -> int | None:
    """Parse '2023/05/01 (Mon) 21:05' -> Unix epoch int (treated as UTC)."""
    try:
        cleaned = re.sub(r"\s*\([A-Za-z]+\)\s*", " ", date_str).strip()
        dt = datetime.strptime(cleaned, "%Y/%m/%d %H:%M").replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except (ValueError, TypeError):
        return None


def parse_longmemeval_date_human(date_str: str) -> str:
    """Parse '2023/05/01 (Mon) 21:05' -> 'Monday, May 01, 2023'."""
    try:
        cleaned = re.sub(r"\s*\([A-Za-z]+\)\s*", " ", date_str).strip()
        dt = datetime.strptime(cleaned, "%Y/%m/%d %H:%M")
        return dt.strftime("%A, %B %d, %Y")
    except (ValueError, TypeError):
        return date_str


def sort_sessions_chronologically(
    question: dict,
) -> list[tuple[str, str, list[dict]]]:
    """Sort haystack_sessions by their corresponding haystack_dates.

    Returns list of (session_id, date_str, session) tuples sorted by date.
    """
    sessions = question["haystack_sessions"]
    dates = question["haystack_dates"]
    session_ids = question["haystack_session_ids"]

    paired = list(zip(session_ids, dates, sessions))

    def sort_key(item: tuple) -> tuple:
        parsed = parse_longmemeval_date(item[1])
        if parsed is not None:
            return (0, parsed, item[1])
        return (1, 0, item[1])

    paired.sort(key=sort_key)
    return paired


def pair_turns(session: list[dict]) -> list[list[dict]]:
    """Pair consecutive user/assistant turns, stripping 'has_answer' field.

    Returns list of message pairs for Mem0 add() calls.
    """
    cleaned = [{"role": t["role"], "content": t["content"]} for t in session]
    pairs = []
    for i in range(0, len(cleaned), 2):
        pair = cleaned[i : i + 2]
        pairs.append(pair)
    return pairs


# ===============================================================================
# INGESTION
# ===============================================================================


async def ingest_question(
    question: dict,
    mem0: Mem0Client,
    logger: Any,
    run_id: str,
    output_dir: str,
    shutdown: GracefulShutdown,
    debug: bool = True,
) -> tuple[bool, str, int]:
    """Ingest all haystack sessions of a LongMemEval question into Mem0.

    Each question gets its own user_id so memories don't leak between questions.

    Returns: (success, user_id, total_pairs_processed)
    """
    question_id = question["question_id"]
    user_id = f"longmemeval_{question_id}_{run_id}"

    checkpoint = IngestionCheckpoint(output_dir)
    key = question_id

    # Check if already complete
    is_done, cp_data = checkpoint.is_complete(key, CHUNK_SIZE)
    if is_done and cp_data:
        pairs_done = cp_data.get("total_pairs_processed", 0)
        user_id = cp_data.get("user_id", user_id)
        logger.info(
            "Question %s already ingested (user_id=%s, %d pairs)",
            question_id, user_id, pairs_done,
        )
        return True, user_id, pairs_done

    # Check for partial progress
    chunks_already_done, resumed_uid = checkpoint.load_progress(key, CHUNK_SIZE)
    if resumed_uid and chunks_already_done:
        user_id = resumed_uid
        logger.info(
            "Resuming question %s from %d completed pairs",
            question_id, len(chunks_already_done),
        )

    sorted_sessions = sort_sessions_chronologically(question)

    # Count total pairs for progress
    total_pairs = sum(len(pair_turns(s)) for _, _, s in sorted_sessions)

    logger.info(
        "Ingesting question %s: %d sessions, %d pairs",
        question_id, len(sorted_sessions), total_pairs,
    )

    # Debug log
    debug_file = None
    if debug:
        debug_dir = os.path.join(output_dir, "debug")
        os.makedirs(debug_dir, exist_ok=True)
        debug_path = os.path.join(debug_dir, f"{question_id}_ingestion.txt")
        debug_mode = "a" if chunks_already_done else "w"
        debug_file = open(debug_path, debug_mode, encoding="utf-8")
        if not chunks_already_done:
            debug_file.write(f"{'=' * 80}\n")
            debug_file.write(f"QUESTION {question_id} (type={question['question_type']})\n")
            debug_file.write(f"Sessions: {len(sorted_sessions)}, Pairs: {total_pairs}\n")
            debug_file.write(f"User ID: {user_id}\n")
            debug_file.write(f"{'=' * 80}\n\n")

    pbar = tqdm(
        total=total_pairs,
        desc=f"Ingest {question_id}",
        initial=len(chunks_already_done),
        leave=True,
    )
    total_processed = len(chunks_already_done)
    total_failed = 0

    for session_idx, (session_id, date_str, session) in enumerate(sorted_sessions):
        if not session:
            continue

        session_timestamp = parse_longmemeval_date(date_str) if date_str else None
        pairs = pair_turns(session)

        if debug_file and f"s{session_idx}_header" not in chunks_already_done:
            debug_file.write(f"\n{'---' * 27}\n")
            debug_file.write(
                f"SESSION {session_idx} ({session_id})  |  "
                f"Date: {date_str}  |  Pairs: {len(pairs)}\n"
            )
            debug_file.write(f"{'---' * 27}\n\n")

        for pair_idx, messages in enumerate(pairs):
            chunk_key = f"s{session_idx}_p{pair_idx}"

            if chunk_key in chunks_already_done:
                continue

            if shutdown.requested:
                logger.info(
                    "Shutdown requested at question %s, chunk %s",
                    question_id, chunk_key,
                )
                pbar.close()
                if debug_file:
                    debug_file.close()
                return True, user_id, total_processed

            # Skip pairs with empty content
            if any(not msg.get("content", "").strip() for msg in messages):
                chunks_already_done.add(chunk_key)
                total_processed += 1
                pbar.update(1)
                continue

            if debug_file:
                debug_file.write(f"--- Pair {pair_idx} ({len(messages)} messages) ---\n")
                for msg in messages:
                    debug_file.write(f"  {msg['role']}: {msg['content'][:200]}\n")
                debug_file.write("\n")

            response = await mem0.add(messages, user_id, timestamp=session_timestamp)

            if response is not None:
                total_processed += 1
                if debug_file:
                    results = response.get("results", [])
                    if results:
                        debug_file.write(f"--- Pair {pair_idx} (extracted) ---\n")
                        for mem_item in results:
                            mem_text = mem_item.get("memory", "")
                            event_type = mem_item.get("event", "")
                            debug_file.write(f"  [{event_type}] {mem_text}\n")
                        debug_file.write("\n")
            else:
                total_failed += 1
                logger.warning(
                    "Ingestion failed: %s session %d pair %d",
                    question_id, session_idx, pair_idx,
                )

            chunks_already_done.add(chunk_key)
            checkpoint.save_progress(key, {
                "question_id": question_id,
                "user_id": user_id,
                "run_id": run_id,
                "chunk_size": CHUNK_SIZE,
                "completed_chunks": list(chunks_already_done),
            })
            pbar.set_description(
                f"Ingest {question_id}"
                + (f" [!fail={total_failed}]" if total_failed else "")
            )
            pbar.update(1)

    pbar.close()
    if debug_file:
        debug_file.write(
            f"\nSUMMARY: {total_processed}/{total_pairs} OK, {total_failed} failed\n"
        )
        debug_file.close()

    checkpoint.save_complete(key, {
        "question_id": question_id,
        "user_id": user_id,
        "run_id": run_id,
        "chunk_size": CHUNK_SIZE,
        "total_pairs_processed": total_processed,
        "total_pairs_failed": total_failed,
    })

    return total_failed == 0, user_id, total_processed


# ===============================================================================
# SEARCH + ANSWER + JUDGE
# ===============================================================================


async def process_question_answerer(
    question: dict,
    user_id: str,
    mem0: Mem0Client,
    answerer: LLMClient,
    judge_llm: LLMClient,
    cutoffs: list[int],
    top_k: int,
    user_profile: dict | None,
    predict_only: bool,
    logger: Any,
    score_debug: bool = False,
    existing_search_results: list | None = None,
) -> dict[str, Any]:
    """Process a question in answerer mode: search + generate answer + judge.

    Returns a result dict suitable for serialization.
    """
    question_id = question["question_id"]
    question_text = question["question"]
    question_type = question["question_type"]
    answer = str(question["answer"])
    question_date = question.get("question_date", "")

    # Human-readable question date for the answerer prompt
    question_date_human = (
        parse_longmemeval_date_human(question_date) if question_date else ""
    )

    # --- Search ---
    if existing_search_results is not None:
        formatted = existing_search_results
        query_debug = None
        search_latency = 0.0
    else:
        start = time.monotonic()
        search_results = await mem0.search(
            question_text, user_id, top_k=top_k, score_debug=score_debug,
        )
        search_latency = (time.monotonic() - start) * 1000
        formatted, query_debug = format_search_results(search_results)

    result: dict[str, Any] = {
        "question_id": question_id,
        "question_type": question_type,
        "question": question_text,
        "ground_truth_answer": answer,
        "question_date": question_date,
        "is_abstention": question_id.endswith("_abs"),
        "user_id": user_id,
        "answer_session_ids": question.get("answer_session_ids", []),
        "retrieval": {
            "search_query": question_text,
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

    for c in cutoffs:
        sliced = formatted[:c]

        # Sort chronologically for the answerer (natural timeline)
        sliced_chrono = sorted(sliced, key=lambda x: x.get("created_at") or "")

        label = cutoff_label(c)

        # Generate answer
        gen_prompt = get_answer_generation_prompt(
            question=question_text,
            search_results=sliced_chrono,
            question_date=question_date_human,
            user_profile=user_profile,
        )
        generated_answer = await answerer.generate(system="", user=gen_prompt)

        # Strip chain-of-thought tags
        generated_answer = re.sub(
            r"[<\[]mem_thinking[>\]].*?[<\[]/mem_thinking[>\]]",
            "",
            generated_answer,
            flags=re.DOTALL,
        ).strip()
        if "ANSWER:" in generated_answer:
            generated_answer = generated_answer.rsplit("ANSWER:", 1)[-1].strip()

        # Judge: yes/no correctness
        judge_prompt = get_judge_prompt(
            question_type=question_type,
            question_id=question_id,
            question=question_text,
            answer=answer,
            response=generated_answer,
            question_date=question_date_human,
        )
        correct, judge_raw = await judge_llm.judge_yes_no(judge_prompt)
        score = 1.0 if correct else 0.0
        judgment = "PASS" if correct else "FAIL"

        cutoff_results[label] = {
            "judgment": judgment,
            "score": score,
            "generated_answer": generated_answer,
            "judge_raw": judge_raw,
            "memories_evaluated": len(sliced),
            "reason": f"Generated answer: {generated_answer[:500]}",
        }

    result["cutoff_results"] = cutoff_results
    return result


async def process_question_retrieval(
    question: dict,
    user_id: str,
    mem0: Mem0Client,
    judge_llm: LLMClient,
    cutoffs: list[int],
    top_k: int,
    user_profile: dict | None,
    predict_only: bool,
    logger: Any,
    score_debug: bool = False,
) -> dict[str, Any]:
    """Process a question in retrieval mode: search + judge memories directly.

    Returns a result dict suitable for serialization.
    """
    question_id = question["question_id"]
    question_text = question["question"]
    question_type = question["question_type"]
    answer = str(question["answer"])
    question_date = question.get("question_date", "")

    # --- Search ---
    start = time.monotonic()
    search_results = await mem0.search(
        question_text, user_id, top_k=top_k, score_debug=score_debug,
    )
    search_latency = (time.monotonic() - start) * 1000

    formatted, query_debug = format_search_results(search_results)

    result: dict[str, Any] = {
        "question_id": question_id,
        "question_type": question_type,
        "question": question_text,
        "ground_truth_answer": answer,
        "question_date": question_date,
        "is_abstention": question_id.endswith("_abs"),
        "user_id": user_id,
        "answer_session_ids": question.get("answer_session_ids", []),
        "retrieval": {
            "search_query": question_text,
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

    # --- Judge at each cutoff ---
    cutoff_results: dict[str, dict] = {}

    for c in cutoffs:
        sliced = formatted[:c]
        label = cutoff_label(c)

        prompt = get_retrieval_judge_prompt(
            question=question_text,
            answer=answer,
            search_results=sliced,
            question_date=question_date,
            user_profile=user_profile,
        )
        raw = await judge_llm.generate_structured(
            system=RETRIEVAL_JUDGE_SYSTEM,
            user=prompt,
        )

        if isinstance(raw, dict):
            judgment_str = raw.get("judgment", "").upper()
            passed = judgment_str == "PASS"
        else:
            passed = False

        score = 1.0 if passed else 0.0
        judgment = "PASS" if passed else "FAIL"

        cutoff_results[label] = {
            "judgment": judgment,
            "score": score,
            "generated_answer": raw.get("supporting_evidence", "") if isinstance(raw, dict) else "",
            "memories_evaluated": len(sliced),
            "reason": raw.get("reason", "") if isinstance(raw, dict) else "",
            "core_intent": raw.get("core_intent", "") if isinstance(raw, dict) else "",
            "core_intent_supported": raw.get("core_intent_supported", False) if isinstance(raw, dict) else False,
        }

    result["cutoff_results"] = cutoff_results
    return result


async def apply_longmemeval_answerer_judge_to_saved_result(
    result: dict,
    answerer: LLMClient,
    judge_llm: LLMClient,
    cutoffs: list[int],
) -> None:
    """Fill ``cutoff_results`` from ``retrieval.search_results`` (no Mem0)."""
    formatted = list(result["retrieval"]["search_results"])
    question_text = result["question"]
    question_id = result["question_id"]
    question_type = result["question_type"]
    answer = str(result["ground_truth_answer"])
    question_date = result.get("question_date", "")
    user_profile = result.get("user_profile")

    question_date_human = (
        parse_longmemeval_date_human(question_date) if question_date else ""
    )

    cutoff_results: dict[str, dict] = {}
    for c in cutoffs:
        sliced = formatted[:c]
        sliced_chrono = sorted(sliced, key=lambda x: x.get("created_at") or "")
        label = cutoff_label(c)

        gen_prompt = get_answer_generation_prompt(
            question=question_text,
            search_results=sliced_chrono,
            question_date=question_date_human,
            user_profile=user_profile,
        )
        generated_answer = await answerer.generate(system="", user=gen_prompt)
        generated_answer = re.sub(
            r"[<\[]mem_thinking[>\]].*?[<\[]/mem_thinking[>\]]",
            "",
            generated_answer,
            flags=re.DOTALL,
        ).strip()
        if "ANSWER:" in generated_answer:
            generated_answer = generated_answer.rsplit("ANSWER:", 1)[-1].strip()

        judge_prompt = get_judge_prompt(
            question_type=question_type,
            question_id=question_id,
            question=question_text,
            answer=answer,
            response=generated_answer,
            question_date=question_date_human,
        )
        correct, judge_raw = await judge_llm.judge_yes_no(judge_prompt)
        score = 1.0 if correct else 0.0
        judgment = "PASS" if correct else "FAIL"

        cutoff_results[label] = {
            "judgment": judgment,
            "score": score,
            "generated_answer": generated_answer,
            "judge_raw": judge_raw,
            "memories_evaluated": len(sliced),
            "reason": f"Generated answer: {generated_answer[:500]}",
        }

    result["cutoff_results"] = cutoff_results


async def apply_longmemeval_retrieval_judge_to_saved_result(
    result: dict,
    judge_llm: LLMClient,
    cutoffs: list[int],
) -> None:
    """Fill ``cutoff_results`` using retrieval-judge prompts (no Mem0)."""
    formatted = list(result["retrieval"]["search_results"])
    question_text = result["question"]
    answer = str(result["ground_truth_answer"])
    question_date = result.get("question_date", "")
    user_profile = result.get("user_profile")

    cutoff_results: dict[str, dict] = {}
    for c in cutoffs:
        sliced = formatted[:c]
        label = cutoff_label(c)
        prompt = get_retrieval_judge_prompt(
            question=question_text,
            answer=answer,
            search_results=sliced,
            question_date=question_date,
            user_profile=user_profile,
        )
        raw = await judge_llm.generate_structured(
            system=RETRIEVAL_JUDGE_SYSTEM,
            user=prompt,
        )
        if isinstance(raw, dict):
            judgment_str = raw.get("judgment", "").upper()
            passed = judgment_str == "PASS"
        else:
            passed = False
        score = 1.0 if passed else 0.0
        judgment = "PASS" if passed else "FAIL"
        cutoff_results[label] = {
            "judgment": judgment,
            "score": score,
            "generated_answer": raw.get("supporting_evidence", "") if isinstance(raw, dict) else "",
            "memories_evaluated": len(sliced),
            "reason": raw.get("reason", "") if isinstance(raw, dict) else "",
            "core_intent": raw.get("core_intent", "") if isinstance(raw, dict) else "",
            "core_intent_supported": raw.get("core_intent_supported", False) if isinstance(raw, dict) else False,
        }

    result["cutoff_results"] = cutoff_results


def longmemeval_predict_outputs_complete(
    output_dir: str,
    question_ids: list[str],
) -> tuple[bool, list[str]]:
    missing: list[str] = []
    for qid in question_ids:
        path = os.path.join(output_dir, f"{qid}.json")
        if not os.path.isfile(path):
            missing.append(qid)
            continue
        try:
            data = json.loads(Path(path).read_text())
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


def compute_longmemeval_metrics(
    evaluations: list[dict],
    cutoffs: list[int],
) -> dict:
    """Compute per-question-type and overall metrics at each cutoff."""
    metrics_by_cutoff = {}
    for c in cutoffs:
        label = cutoff_label(c)
        total = len(evaluations)
        scores = [
            e.get("cutoff_results", {}).get(label, {}).get("score", 0.0)
            for e in evaluations
        ]
        correct = sum(1 for s in scores if s >= 0.5)

        by_type: dict[str, list] = defaultdict(list)
        for e in evaluations:
            qtype = e.get("question_type", "unknown")
            by_type[qtype].append(
                e.get("cutoff_results", {}).get(label, {}).get("score", 0.0)
            )

        type_metrics = {}
        for qtype in sorted(by_type):
            type_scores = by_type[qtype]
            type_correct = sum(1 for s in type_scores if s >= 0.5)
            type_metrics[qtype] = {
                "total": len(type_scores),
                "correct": type_correct,
                "accuracy": type_correct / len(type_scores) * 100 if type_scores else 0.0,
                "avg_score": statistics.mean(type_scores) * 100 if type_scores else 0.0,
            }

        metrics_by_cutoff[label] = {
            "overall": {
                "total": total,
                "correct": correct,
                "accuracy": correct / total * 100 if total else 0.0,
                "avg_score": statistics.mean(scores) * 100 if scores else 0.0,
            },
            "by_question_type": type_metrics,
        }
    return metrics_by_cutoff


def display_results(metrics_by_cutoff: dict, cutoffs: list[int]) -> None:
    """Print metrics to console."""
    for c in cutoffs:
        label = cutoff_label(c)
        m = metrics_by_cutoff.get(label, {})
        overall = m.get("overall", {})
        print(f"\n--- {label} ---")
        print(
            f"  Overall: {overall.get('correct', 0)}/{overall.get('total', 0)} "
            f"({overall.get('accuracy', 0):.1f}%) "
            f"avg={overall.get('avg_score', 0):.1f}%"
        )
        for qtype, tm in sorted(m.get("by_question_type", {}).items()):
            print(
                f"  {qtype}: {tm['correct']}/{tm['total']} ({tm['accuracy']:.1f}%)"
            )


# ===============================================================================
# CLI
# ===============================================================================


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run LongMemEval benchmark: ingest + search + answer + judge",
    )
    parser.add_argument(
        "--project-name", required=True,
        help="Name for this eval run",
    )
    parser.add_argument(
        "--answerer-model", default="gpt-5",
        help="Model for answer generation",
    )
    parser.add_argument(
        "--judge-model", default="gpt-5",
        help="Model for judging",
    )
    parser.add_argument(
        "--provider", default="openai",
        help="LLM provider (openai, anthropic, azure)",
    )
    parser.add_argument(
        "--judge-provider", default=None,
        help="Judge provider (defaults to --provider)",
    )
    parser.add_argument(
        "--mode", default="answerer", choices=["retrieval", "answerer"],
        help="Evaluation mode: retrieval (judge memories) or answerer (generate+judge)",
    )
    parser.add_argument(
        "--top-k", type=int, default=200,
        help="Number of search results to retrieve",
    )
    parser.add_argument(
        "--top-k-cutoffs", default="10,20,50,200",
        help="Comma-separated cutoffs for evaluation",
    )
    parser.add_argument(
        "--max-workers", type=int, default=10,
        help="Max parallel workers",
    )
    parser.add_argument(
        "--output-dir", default="results/longmemeval",
        help="Output directory",
    )
    parser.add_argument(
        "--predict-only", action="store_true",
        help="Skip answer+judge, only ingest+search",
    )
    parser.add_argument(
        "--evaluate-only", action="store_true",
        help="Judge only: requires all predict JSONs on disk. No Mem0.",
    )
    parser.add_argument(
        "--rejudge",
        action="store_true",
        help="With --evaluate-only: re-run judge even if cutoff_results exist",
    )
    parser.add_argument(
        "--resume", action="store_true", default=True,
        help="Resume from checkpoint (default: True)",
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="Verbose logging",
    )
    parser.add_argument(
        "--score-debug", action="store_true",
        help="Include score breakdowns in output",
    )
    parser.add_argument(
        "--dataset-path", default=None,
        help="Path to local longmemeval dataset JSON",
    )
    parser.add_argument(
        "--run-id", default=None,
        help="Reuse a specific run_id for resume",
    )
    parser.add_argument(
        "--all-questions", action="store_true",
        help="Process all 500 questions (ignores --per-type)",
    )
    parser.add_argument(
        "--per-type", type=int, default=5,
        help="Questions to sample per question_type (default: 5, yielding 30)",
    )
    parser.add_argument(
        "--question-types", default=None,
        help="Comma-separated question types to include (default: all 6)",
    )
    parser.add_argument(
        "--user-profile", action="store_true",
        help="Fetch user profiles for use in prompts",
    )
    parser.add_argument(
        "--seed", type=int, default=42,
        help="Random seed for stratified sampling",
    )
    parser.add_argument(
        "--rpm", type=int, default=200,
        help="Requests per minute for LLM",
    )
    parser.add_argument(
        "--backend", default="oss", choices=["oss", "cloud"],
        help="Mem0 backend: 'oss' for self-hosted server (default), 'cloud' for api.mem0.ai",
    )
    parser.add_argument(
        "--mem0-host", default=None,
        help="Mem0 server URL",
    )
    parser.add_argument(
        "--mem0-api-key", default=None,
        help="Mem0 API key (cloud mode only)",
    )
    return parser.parse_args()


# ===============================================================================
# MAIN
# ===============================================================================


async def async_main() -> None:
    args = parse_args()
    logger = setup_logging("longmemeval", debug=args.debug)

    cutoffs = parse_cutoffs(args.top_k_cutoffs)
    selected_types = (
        [t.strip() for t in args.question_types.split(",") if t.strip()]
        if args.question_types
        else None
    )

    run_id = args.run_id or uuid.uuid4().hex[:8]
    output_dir = os.path.join(args.output_dir, f"predicted_{args.project_name}")
    os.makedirs(output_dir, exist_ok=True)

    print(f"LongMemEval Benchmark | project={args.project_name} run_id={run_id}")
    print(f"  Mode: {args.mode}")
    print(f"  Answerer: {args.answerer_model} ({args.provider})")
    print(f"  Judge: {args.judge_model} ({args.judge_provider or args.provider})")
    print(f"  Cutoffs: {args.top_k_cutoffs}")
    print(f"  Top-K: {args.top_k}")

    # Load dataset
    if args.dataset_path:
        dataset_path = args.dataset_path
    else:
        dataset_path = download_dataset(DEFAULT_DATASET_DIR, logger)
    all_questions = load_dataset(dataset_path)

    print(f"  Dataset: {len(all_questions)} questions loaded")

    # Sample / filter questions
    if args.all_questions:
        if selected_types:
            questions_to_process = [
                q for q in all_questions
                if q["question_type"] in set(selected_types)
            ]
        else:
            questions_to_process = all_questions
        print(f"  Processing all {len(questions_to_process)} questions")
    else:
        questions_to_process = sample_questions_stratified(
            all_questions,
            per_type=args.per_type,
            seed=args.seed,
            selected_types=selected_types,
        )
        print(
            f"  Sampled {len(questions_to_process)} questions "
            f"({args.per_type} per type)"
        )

    # Print type distribution
    type_counts: dict[str, int] = defaultdict(int)
    for q in questions_to_process:
        type_counts[q["question_type"]] += 1
    for qtype in sorted(type_counts.keys()):
        print(f"    {qtype}: {type_counts[qtype]}")

    answerer = LLMClient(
        model=args.answerer_model, provider=args.provider, rpm=args.rpm,
    )
    judge_provider = args.judge_provider or args.provider
    judge_llm = LLMClient(
        model=args.judge_model, provider=judge_provider, rpm=args.rpm,
    )

    if args.evaluate_only:
        if not questions_to_process:
            print("No questions in scope.")
            return
        expected_ids = [q["question_id"] for q in questions_to_process]
        complete, missing = longmemeval_predict_outputs_complete(output_dir, expected_ids)
        if not complete:
            print(
                "Evaluate-only aborted: not all predict outputs are on disk. "
                "Finish ingest+search for every in-scope question first."
            )
            print(f"  Missing or invalid: {len(missing)} (showing up to 25): {missing[:25]}")
            return
        print(f"  Predict complete ({len(expected_ids)} questions). Running judge phase (no Mem0)...")

        sem = asyncio.Semaphore(args.max_workers)
        progress = {"done": 0, "total": len(questions_to_process)}
        live_scores = {
            cutoff_label(c): {"seen": 0, "passed": 0}
            for c in cutoffs
        }
        progress_lock = asyncio.Lock()
        pbar = tqdm(total=progress["total"], desc="Rejudge", leave=True)

        def update_progress_postfix(data: dict) -> None:
            cutoff_results = data.get("cutoff_results", {})
            for label in live_scores:
                result = cutoff_results.get(label)
                if not result:
                    continue
                live_scores[label]["seen"] += 1
                if result.get("score", 0.0) >= 0.5:
                    live_scores[label]["passed"] += 1

            summary = {}
            for label, stats in live_scores.items():
                seen = stats["seen"]
                if not seen:
                    continue
                summary[label.replace("top_", "t")] = f"{(stats['passed'] / seen) * 100:.1f}%"
            if summary:
                pbar.set_postfix(summary)

        async def judge_one(question: dict) -> None:
            qid = question["question_id"]
            path = os.path.join(output_dir, f"{qid}.json")
            data = json.loads(Path(path).read_text())
            if data.get("cutoff_results") and not args.rejudge:
                async with progress_lock:
                    update_progress_postfix(data)
                    progress["done"] += 1
                    pbar.update(1)
                return
            async with sem:
                if args.mode == "retrieval":
                    await apply_longmemeval_retrieval_judge_to_saved_result(
                        data, judge_llm, cutoffs,
                    )
                else:
                    await apply_longmemeval_answerer_judge_to_saved_result(
                        data, answerer, judge_llm, cutoffs,
                    )
                save_result_json(path, data)
            async with progress_lock:
                update_progress_postfix(data)
                progress["done"] += 1
                pbar.update(1)

        await asyncio.gather(*[judge_one(q) for q in questions_to_process])
        pbar.close()

        all_evaluations = [
            json.loads(Path(os.path.join(output_dir, f"{qid}.json")).read_text())
            for qid in expected_ids
        ]
        metrics = compute_longmemeval_metrics(all_evaluations, cutoffs)
        display_results(metrics, cutoffs)

        run_id_meta = args.run_id or run_id

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unified_path = os.path.join(
            args.output_dir, f"longmemeval_results_{timestamp}.json",
        )
        save_result_json(unified_path, {
            "metadata": {
                "benchmark": "longmemeval",
                "project_name": args.project_name,
                "run_id": run_id_meta,
                "timestamp": timestamp,
                "mode": args.mode,
                "answerer_model": args.answerer_model,
                "judge_model": args.judge_model,
                "provider": args.provider,
                "top_k": args.top_k,
                "top_k_cutoffs": [cutoff_label(c) for c in cutoffs],
                "total_questions": len(all_evaluations),
                "question_types": sorted(type_counts.keys()),
                "all_questions": args.all_questions,
                "per_type": args.per_type,
                "seed": args.seed,
                "evaluate_only": True,
            },
            "metrics_by_cutoff": metrics,
            "evaluations": all_evaluations,
        })
        print(f"\nResults saved to: {unified_path}")
        print(f"\nTotal questions evaluated: {len(all_evaluations)}")
        return

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
                data = json.loads(p.read_text())
                if data.get("question_type"):
                    all_evaluations.append(data)
            except (json.JSONDecodeError, KeyError):
                continue
        print(f"  Loaded {len(all_evaluations)} existing results")

    existing_ids = {e["question_id"] for e in all_evaluations}

    async with mem0:
        with shutdown:
            results_lock = asyncio.Lock()
            question_semaphore = asyncio.Semaphore(args.max_workers)
            progress = {"done": 0, "total": len(questions_to_process)}
            pbar = tqdm(total=progress["total"], desc="Questions", leave=True)

            # Build lookup of predict-only results (have search data but no cutoff_results)
            predict_only_results = {
                e["question_id"]: e for e in all_evaluations
                if "retrieval" in e and "cutoff_results" not in e
            }

            async def process_single_question(question: dict):
                async with question_semaphore:
                    if shutdown.requested:
                        return

                    question_id = question["question_id"]

                    async with results_lock:
                        if question_id in existing_ids:
                            progress["done"] += 1
                            pbar.update(1)
                            return

                    # Check if we have predict-only results (search data already exists)
                    existing_predict = predict_only_results.get(question_id)
                    if existing_predict and existing_predict.get("retrieval"):
                        # Skip ingest+search, use existing search results
                        user_id = existing_predict.get("user_id", f"longmemeval_{question_id}_{run_id}")
                        user_profile = None
                    else:
                        # --- Ingest ---
                        success, user_id, pairs = await ingest_question(
                            question=question,
                            mem0=mem0,
                            logger=logger,
                            run_id=run_id,
                            output_dir=output_dir,
                            shutdown=shutdown,
                            debug=args.debug,
                        )
                        if not success:
                            logger.error(
                                "Ingestion failed for question %s", question_id,
                            )

                        if shutdown.requested:
                            return

                        existing_predict = None  # will search fresh below

                    # Fetch user profile if requested
                    user_profile = None
                    if args.user_profile:
                        user_profile = await mem0.get_user_profile(user_id)

                    # --- Search + Answer/Judge ---
                    if args.mode == "retrieval":
                        result = await process_question_retrieval(
                            question=question,
                            user_id=user_id,
                            mem0=mem0,
                            judge_llm=judge_llm,
                            cutoffs=cutoffs,
                            top_k=args.top_k,
                            user_profile=user_profile,
                            predict_only=args.predict_only,
                            logger=logger,
                            score_debug=args.score_debug,
                        )
                    else:
                        # Use existing search results from predict-only run if available
                        existing_search = None
                        if existing_predict and existing_predict.get("retrieval"):
                            existing_search = existing_predict["retrieval"].get("search_results", [])

                        result = await process_question_answerer(
                            question=question,
                            user_id=user_id,
                            mem0=mem0,
                            answerer=answerer,
                            judge_llm=judge_llm,
                            cutoffs=cutoffs,
                            top_k=args.top_k,
                            user_profile=user_profile,
                            predict_only=args.predict_only,
                            logger=logger,
                            score_debug=args.score_debug,
                            existing_search_results=existing_search,
                        )

                    # Save per-question result
                    result_path = os.path.join(output_dir, f"{question_id}.json")
                    save_result_json(result_path, result)
                    async with results_lock:
                        all_evaluations.append(result)
                        existing_ids.add(question_id)
                    pbar.update(1)

            tasks = [process_single_question(q) for q in questions_to_process]
            await asyncio.gather(*tasks)
            pbar.close()

    # --- Metrics ---
    if not args.predict_only and all_evaluations:
        # Deduplicate by question_id, keeping the latest (last) entry
        seen = {}
        for e in all_evaluations:
            seen[e.get("question_id")] = e
        deduped = list(seen.values())

        has_cutoffs = any("cutoff_results" in e for e in deduped)
        if has_cutoffs:
            metrics = compute_longmemeval_metrics(deduped, cutoffs)
            display_results(metrics, cutoffs)

            # Save unified result
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            unified_path = os.path.join(
                args.output_dir, f"longmemeval_results_{timestamp}.json",
            )
            save_result_json(unified_path, {
                "metadata": {
                    "benchmark": "longmemeval",
                    "project_name": args.project_name,
                    "run_id": run_id,
                    "timestamp": timestamp,
                    "mode": args.mode,
                    "answerer_model": args.answerer_model,
                    "judge_model": args.judge_model,
                    "provider": args.provider,
                    "top_k": args.top_k,
                    "top_k_cutoffs": [cutoff_label(c) for c in cutoffs],
                    "total_questions": len(all_evaluations),
                    "question_types": sorted(type_counts.keys()),
                    "all_questions": args.all_questions,
                    "per_type": args.per_type,
                    "seed": args.seed,
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
