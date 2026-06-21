"""Tests for the 1MBrain Python SDK."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
import io

import pytest

from onemillionbrain import OneMBrainClient, OneMBrainError
from onemillionbrain.models import Memory, MemoryType, RecallResult


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

NOW = datetime.now(tz=timezone.utc).isoformat()

MEMORY_PAYLOAD = {
    "id": "mem-001",
    "agentId": "test-agent",
    "type": "semantic",
    "content": "User prefers dark mode",
    "importance": 0.8,
    "decayScore": 1.0,
    "createdAt": NOW,
    "lastAccessedAt": NOW,
    "tags": ["preference", "ui"],
    "embeddingModel": "text-embedding-3-small",
    "metadata": {},
}

SEARCH_PAYLOAD = [
    {
        "memory": MEMORY_PAYLOAD,
        "score": 0.92,
    }
]

CONSOLIDATION_PAYLOAD = {
    "agentId": "test-agent",
    "triggerReason": "threshold",
    "dryRun": True,
    "storedCount": 0,
    "archivedCount": 0,
    "clustersProcessed": 1,
    "skipped": {
        "noCandidates": 0,
        "tooSmallClusters": 0,
        "summarizationFailed": 0,
        "dryRun": 3,
    },
    "errors": [],
    "summaryIds": [],
}


def make_client() -> OneMBrainClient:
    return OneMBrainClient(
        api_url="http://localhost:3001",
        api_key="test-key",
        agent_id="test-agent",
    )


def mock_response(payload: dict, status: int = 200):
    """Create a mock urllib response."""
    body = json.dumps(payload).encode()
    resp = MagicMock()
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    resp.read = MagicMock(return_value=body)
    resp.status = status
    return resp


# ---------------------------------------------------------------------------
# Constructor validation
# ---------------------------------------------------------------------------


def test_client_requires_api_url() -> None:
    with pytest.raises(ValueError, match="api_url"):
        OneMBrainClient(api_url="", api_key="key")


def test_client_requires_api_key() -> None:
    with pytest.raises(ValueError, match="api_key"):
        OneMBrainClient(api_url="http://localhost:3001", api_key="")


def test_client_requires_agent_id_at_call_time() -> None:
    client = OneMBrainClient(api_url="http://localhost:3001", api_key="key")
    with pytest.raises(ValueError, match="agent_id"):
        client.remember("hello")


# ---------------------------------------------------------------------------
# remember()
# ---------------------------------------------------------------------------


def test_remember_returns_memory() -> None:
    client = make_client()
    response_envelope = {"success": True, "data": MEMORY_PAYLOAD}

    with patch("urllib.request.urlopen") as mock_open:
        mock_open.return_value = mock_response(response_envelope)
        memory = client.remember("User prefers dark mode")

    assert isinstance(memory, Memory)
    assert memory.id == "mem-001"
    assert memory.type == MemoryType.SEMANTIC
    assert memory.content == "User prefers dark mode"
    assert memory.importance == 0.8


def test_remember_accepts_string_shorthand() -> None:
    client = make_client()
    response_envelope = {"success": True, "data": MEMORY_PAYLOAD}

    with patch("urllib.request.urlopen") as mock_open:
        mock_open.return_value = mock_response(response_envelope)
        memory = client.remember("hello", type="episodic", tags=["test"])

    assert memory.id == "mem-001"


# ---------------------------------------------------------------------------
# recall()
# ---------------------------------------------------------------------------


def test_recall_returns_results() -> None:
    client = make_client()
    response_envelope = {"success": True, "data": SEARCH_PAYLOAD}

    with patch("urllib.request.urlopen") as mock_open:
        mock_open.return_value = mock_response(response_envelope)
        results = client.recall("dark mode preference")

    assert len(results) == 1
    result = results[0]
    assert isinstance(result, RecallResult)
    assert result.score == 0.92
    assert result.memory.content == "User prefers dark mode"


def test_recall_passes_limit_param() -> None:
    client = make_client()
    response_envelope = {"success": True, "data": []}

    with patch("urllib.request.urlopen") as mock_open:
        mock_open.return_value = mock_response(response_envelope)
        client.recall("query", limit=3)

    call_args = mock_open.call_args[0][0]
    assert "limit=3" in call_args.full_url


def test_recall_passes_type_filter() -> None:
    client = make_client()
    response_envelope = {"success": True, "data": []}

    with patch("urllib.request.urlopen") as mock_open:
        mock_open.return_value = mock_response(response_envelope)
        client.recall("query", type="semantic")

    call_args = mock_open.call_args[0][0]
    assert "type=semantic" in call_args.full_url


# ---------------------------------------------------------------------------
# forget()
# ---------------------------------------------------------------------------


def test_forget_returns_true_on_success() -> None:
    client = make_client()
    response_envelope = {"success": True}

    with patch("urllib.request.urlopen") as mock_open:
        mock_open.return_value = mock_response(response_envelope)
        result = client.forget("mem-001")

    assert result is True


# ---------------------------------------------------------------------------
# associate()
# ---------------------------------------------------------------------------


def test_associate_returns_result() -> None:
    client = make_client()
    response_envelope = {"success": True}

    with patch("urllib.request.urlopen") as mock_open:
        mock_open.return_value = mock_response(response_envelope)
        result = client.associate(
            "mem-001",
            "mem-002",
            strength=0.7,
            relation_type="supersedes",
        )

    call_args = mock_open.call_args[0][0]
    body = json.loads(call_args.data.decode())
    assert result.success is True
    assert body["relationType"] == "supersedes"


def test_consolidate_returns_result() -> None:
    client = make_client()
    response_envelope = {"success": True, "data": CONSOLIDATION_PAYLOAD}

    with patch("urllib.request.urlopen") as mock_open:
        mock_open.return_value = mock_response(response_envelope)
        result = client.consolidate(dry_run=True, cluster_strategy="tags")

    call_args = mock_open.call_args[0][0]
    body = json.loads(call_args.data.decode())
    assert call_args.full_url == "http://localhost:3001/v1/consolidate"
    assert body["dryRun"] is True
    assert body["clusterStrategy"] == "tags"
    assert result.clusters_processed == 1


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


def test_raises_on_http_error() -> None:
    client = make_client()
    error_body = json.dumps({"error": "Unauthorized"}).encode()
    http_err = HTTPError(
        url="http://localhost:3001/v1/memories",
        code=401,
        msg="Unauthorized",
        hdrs=None,  # type: ignore[arg-type]
        fp=io.BytesIO(error_body),
    )

    with patch("urllib.request.urlopen", side_effect=http_err):
        with pytest.raises(OneMBrainError) as exc_info:
            client.remember("hello")

    assert exc_info.value.status == 401
    assert "Unauthorized" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Memory model
# ---------------------------------------------------------------------------


def test_memory_from_dict() -> None:
    mem = Memory.from_dict(MEMORY_PAYLOAD)
    assert mem.id == "mem-001"
    assert mem.type == MemoryType.SEMANTIC
    assert mem.tags == ["preference", "ui"]
    assert isinstance(mem.created_at, datetime)


def test_memory_repr() -> None:
    mem = Memory.from_dict(MEMORY_PAYLOAD)
    assert "mem-001" in repr(mem)
