"""1MBrain Python SDK — portable memory layer for AI agents."""

from .client import OneMBrainClient, OneMBrainError
from .models import (
    AssociateInput,
    AssociateResult,
    AssociationRelationType,
    ConsolidationResult,
    Memory,
    MemoryType,
    RecallInput,
    RecallResult,
    RememberInput,
)
from .prompts import AGENT_SYSTEM_PROMPT

__all__ = [
    "OneMBrainClient",
    "OneMBrainError",
    "Memory",
    "MemoryType",
    "RememberInput",
    "RecallInput",
    "RecallResult",
    "AssociateInput",
    "AssociateResult",
    "AssociationRelationType",
    "ConsolidationResult",
    "AGENT_SYSTEM_PROMPT",
]

__version__ = "0.1.7"
