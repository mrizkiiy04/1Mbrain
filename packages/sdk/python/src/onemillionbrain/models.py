"""Data models for the 1MBrain Python SDK."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

try:
    from pydantic import BaseModel, Field
    _PYDANTIC = True
except ImportError:
    _PYDANTIC = False


class MemoryType(str, Enum):
    """Enumeration of supported memory types."""

    EPISODIC = "episodic"
    SEMANTIC = "semantic"
    PROCEDURAL = "procedural"


class AssociationOrigin(str, Enum):
    """How an association edge was created."""

    CO_OCCURRENCE = "co-occurrence"
    SIMILARITY = "similarity"
    EXPLICIT = "explicit"


class AssociationRelationType(str, Enum):
    """Semantic meaning of an association edge."""

    RELATES_TO = "relates_to"
    SUPERSEDES = "supersedes"
    DERIVED_FROM = "derived_from"


class Memory:
    """Represents a single memory stored in 1MBrain."""

    def __init__(
        self,
        id: str,
        agent_id: str,
        type: str,
        content: str,
        importance: float,
        decay_score: float,
        created_at: datetime,
        last_accessed_at: datetime,
        tags: list[str],
        embedding_model: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        self.id = id
        self.agent_id = agent_id
        self.type = MemoryType(type)
        self.content = content
        self.importance = importance
        self.decay_score = decay_score
        self.created_at = created_at
        self.last_accessed_at = last_accessed_at
        self.tags = tags
        self.embedding_model = embedding_model
        self.metadata = metadata or {}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Memory":
        return cls(
            id=data["id"],
            agent_id=data["agentId"],
            type=data["type"],
            content=data["content"],
            importance=float(data.get("importance", 0.5)),
            decay_score=float(data.get("decayScore", 1.0)),
            created_at=_parse_dt(data["createdAt"]),
            last_accessed_at=_parse_dt(data["lastAccessedAt"]),
            tags=data.get("tags", []),
            embedding_model=data.get("embeddingModel"),
            metadata=data.get("metadata"),
        )

    def __repr__(self) -> str:
        return (
            f"Memory(id={self.id!r}, type={self.type.value!r}, "
            f"content={self.content[:60]!r}...)"
        )


class RecallResult:
    """A single result from a recall (search) operation."""

    def __init__(self, memory: Memory, score: float) -> None:
        self.memory = memory
        self.score = score

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RecallResult":
        return cls(
            memory=Memory.from_dict(data["memory"]),
            score=float(data.get("score", 0.0)),
        )

    def __repr__(self) -> str:
        return f"RecallResult(score={self.score:.4f}, memory={self.memory!r})"


class RememberInput:
    """Input for storing a new memory."""

    def __init__(
        self,
        content: str,
        type: MemoryType | str = MemoryType.EPISODIC,
        importance: float = 0.5,
        tags: Optional[list[str]] = None,
        metadata: Optional[dict[str, Any]] = None,
        agent_id: Optional[str] = None,
    ) -> None:
        self.content = content
        self.type = MemoryType(type) if isinstance(type, str) else type
        self.importance = importance
        self.tags = tags or []
        self.metadata = metadata or {}
        self.agent_id = agent_id

    def to_dict(self, agent_id: str) -> dict[str, Any]:
        return {
            "agentId": agent_id,
            "content": self.content,
            "type": self.type.value,
            "importance": self.importance,
            "tags": self.tags,
            "metadata": self.metadata,
        }


class RecallInput:
    """Input for searching memories."""

    def __init__(
        self,
        query: str,
        limit: int = 10,
        type: Optional[MemoryType | str] = None,
        tags: Optional[list[str]] = None,
        max_hops: Optional[int] = None,
        activation_threshold: Optional[float] = None,
        blend_weight: Optional[float] = None,
        agent_id: Optional[str] = None,
    ) -> None:
        self.query = query
        self.limit = limit
        self.type = MemoryType(type) if isinstance(type, str) else type
        self.tags = tags or []
        self.max_hops = max_hops
        self.activation_threshold = activation_threshold
        self.blend_weight = blend_weight
        self.agent_id = agent_id

    def to_params(self, agent_id: str) -> dict[str, str]:
        params: dict[str, str] = {
            "q": self.query,
            "agentId": agent_id,
            "limit": str(self.limit),
        }
        if self.type:
            params["type"] = self.type.value
        if self.tags:
            params["tags"] = ",".join(self.tags)
        if self.max_hops is not None:
            params["maxHops"] = str(self.max_hops)
        if self.activation_threshold is not None:
            params["activationThreshold"] = str(self.activation_threshold)
        if self.blend_weight is not None:
            params["blendWeight"] = str(self.blend_weight)
        return params


class AssociateInput:
    """Input for creating an explicit association between two memories."""

    def __init__(
        self,
        target_id: str,
        strength: float = 0.5,
        origin: AssociationOrigin | str = AssociationOrigin.EXPLICIT,
        relation_type: AssociationRelationType | str = AssociationRelationType.RELATES_TO,
        agent_id: Optional[str] = None,
    ) -> None:
        self.target_id = target_id
        self.strength = strength
        self.origin = AssociationOrigin(origin) if isinstance(origin, str) else origin
        self.relation_type = (
            AssociationRelationType(relation_type)
            if isinstance(relation_type, str)
            else relation_type
        )
        self.agent_id = agent_id

    def to_dict(self) -> dict[str, Any]:
        return {
            "targetId": self.target_id,
            "strength": self.strength,
            "origin": self.origin.value,
            "relationType": self.relation_type.value,
        }


class AssociateResult:
    """Result of an association operation."""

    def __init__(self, success: bool) -> None:
        self.success = success


class ConsolidationResult:
    """Result of a memory consolidation run."""

    def __init__(
        self,
        agent_id: str,
        trigger_reason: str,
        dry_run: bool,
        stored_count: int,
        archived_count: int,
        clusters_processed: int,
        skipped: dict[str, Any],
        errors: list[str],
        summary_ids: list[str],
    ) -> None:
        self.agent_id = agent_id
        self.trigger_reason = trigger_reason
        self.dry_run = dry_run
        self.stored_count = stored_count
        self.archived_count = archived_count
        self.clusters_processed = clusters_processed
        self.skipped = skipped
        self.errors = errors
        self.summary_ids = summary_ids

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConsolidationResult":
        return cls(
            agent_id=data["agentId"],
            trigger_reason=data["triggerReason"],
            dry_run=bool(data.get("dryRun", False)),
            stored_count=int(data.get("storedCount", 0)),
            archived_count=int(data.get("archivedCount", 0)),
            clusters_processed=int(data.get("clustersProcessed", 0)),
            skipped=data.get("skipped", {}),
            errors=data.get("errors", []),
            summary_ids=data.get("summaryIds", []),
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    # Handle ISO 8601 with trailing 'Z'
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
