"""
Metrics Computation
===================

Shared metrics helpers for all benchmarks:
- Overall accuracy and average score
- Per-group breakdown (category, question_type, etc.)
- Multi-cutoff evaluation
- Kendall tau-b for event ordering (BEAM)
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from typing import Any

from .schema import CutoffMetrics, GroupMetrics, Metrics


def compute_group_metrics(
    evaluations: list[dict[str, Any]],
    group_key: str,
    cutoff_label: str | None = None,
    pass_threshold: float = 0.5,
) -> dict[str, GroupMetrics]:
    """Compute metrics broken down by a group key.

    Args:
        evaluations: List of evaluation result dicts.
        group_key: Key to group by (e.g., "category_name", "question_type").
        cutoff_label: If set, read score from cutoff_results[label].
        pass_threshold: Score threshold for "correct" classification.

    Returns:
        Dict mapping group name to GroupMetrics.
    """
    groups: dict[str, list[float]] = defaultdict(list)

    for e in evaluations:
        group = e.get(group_key, "unknown")
        if cutoff_label:
            cr = e.get("cutoff_results", {}).get(cutoff_label, {})
            score = cr.get("score", 0.0)
        else:
            score = e.get("score", 0.0)
        groups[group].append(score)

    result = {}
    for name in sorted(groups):
        scores = groups[name]
        correct = sum(1 for s in scores if s >= pass_threshold)
        result[name] = GroupMetrics(
            group_name=name,
            total=len(scores),
            correct=correct,
            accuracy=correct / len(scores) * 100 if scores else 0.0,
            avg_score=statistics.mean(scores) * 100 if scores else 0.0,
        )
    return result


def compute_overall_metrics(
    evaluations: list[dict[str, Any]],
    group_key: str,
    cutoffs: list[str] | None = None,
    pass_threshold: float = 0.5,
) -> Metrics:
    """Compute full metrics suite including per-group and multi-cutoff breakdowns.

    Args:
        evaluations: List of evaluation result dicts.
        group_key: Key to group by.
        cutoffs: List of cutoff label strings (e.g., ["top_10", "top_50"]).
        pass_threshold: Score threshold for "correct".

    Returns:
        Metrics object.
    """
    if not evaluations:
        return Metrics()

    # Primary cutoff (the largest one, or first if no cutoffs)
    primary_cutoff = cutoffs[-1] if cutoffs else None

    # Overall scores from primary cutoff
    all_scores: list[float] = []
    error_count = 0
    for e in evaluations:
        if primary_cutoff:
            cr = e.get("cutoff_results", {}).get(primary_cutoff, {})
            all_scores.append(cr.get("score", 0.0))
            if cr.get("judgment") == "ERROR" or cr.get("error"):
                error_count += 1
        else:
            all_scores.append(e.get("score", 0.0))
            if e.get("judgment") == "ERROR":
                error_count += 1

    correct = sum(1 for s in all_scores if s >= pass_threshold)
    total = len(all_scores)

    metrics = Metrics(
        overall_accuracy=correct / total * 100 if total else 0.0,
        overall_avg_score=statistics.mean(all_scores) * 100 if all_scores else 0.0,
        total=total,
        correct=correct,
        errors=error_count,
    )

    # By-group at primary cutoff
    if primary_cutoff:
        metrics.by_group = compute_group_metrics(evaluations, group_key, primary_cutoff, pass_threshold)
    else:
        metrics.by_group = compute_group_metrics(evaluations, group_key, None, pass_threshold)

    # By-cutoff
    if cutoffs:
        for label in cutoffs:
            group_metrics = compute_group_metrics(evaluations, group_key, label, pass_threshold)

            cutoff_scores = []
            cutoff_errors = 0
            for e in evaluations:
                cr = e.get("cutoff_results", {}).get(label, {})
                cutoff_scores.append(cr.get("score", 0.0))
                if cr.get("judgment") == "ERROR" or cr.get("error"):
                    cutoff_errors += 1

            cutoff_correct = sum(1 for s in cutoff_scores if s >= pass_threshold)
            metrics.by_cutoff[label] = CutoffMetrics(
                cutoff=label,
                overall={
                    "total": len(cutoff_scores),
                    "correct": cutoff_correct,
                    "errors": cutoff_errors,
                    "accuracy": cutoff_correct / len(cutoff_scores) * 100 if cutoff_scores else 0.0,
                    "avg_score": statistics.mean(cutoff_scores) * 100 if cutoff_scores else 0.0,
                },
                by_group=group_metrics,
            )

    return metrics


def compute_kendall_tau_b(predicted_order: list[int], reference_order: list[int]) -> float:
    """Compute Kendall tau-b rank correlation coefficient.

    Used by BEAM for event_ordering questions to measure how well
    the predicted ordering matches the reference ordering.

    Args:
        predicted_order: List of indices in predicted order.
        reference_order: List of indices in reference order.

    Returns:
        Tau-b coefficient in [-1, 1]. 1 = perfect agreement.
    """
    if len(predicted_order) < 2 or len(reference_order) < 2:
        return 0.0

    # Build rank maps
    n = max(len(predicted_order), len(reference_order))
    pred_rank = {v: i for i, v in enumerate(predicted_order)}
    ref_rank = {v: i for i, v in enumerate(reference_order)}

    # Only consider items in both lists
    common = set(predicted_order) & set(reference_order)
    items = sorted(common)

    if len(items) < 2:
        return 0.0

    concordant = 0
    discordant = 0
    tied_pred = 0
    tied_ref = 0

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a, b = items[i], items[j]
            pred_diff = pred_rank[a] - pred_rank[b]
            ref_diff = ref_rank[a] - ref_rank[b]

            if pred_diff == 0 and ref_diff == 0:
                tied_pred += 1
                tied_ref += 1
            elif pred_diff == 0:
                tied_pred += 1
            elif ref_diff == 0:
                tied_ref += 1
            elif (pred_diff > 0 and ref_diff > 0) or (pred_diff < 0 and ref_diff < 0):
                concordant += 1
            else:
                discordant += 1

    n_pairs = len(items) * (len(items) - 1) / 2
    n1 = concordant + discordant + tied_pred
    n2 = concordant + discordant + tied_ref

    if n1 == 0 or n2 == 0:
        return 0.0

    tau_b = (concordant - discordant) / ((n1 * n2) ** 0.5)
    return tau_b
