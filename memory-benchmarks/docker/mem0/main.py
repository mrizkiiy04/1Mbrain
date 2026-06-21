"""
Mem0 OSS Server
===============

Lightweight FastAPI wrapper around the mem0ai SDK, configured with Qdrant
as the vector store. Provides the same REST interface as the official Mem0
server but with minimal dependencies (no Postgres, no Neo4j).

Endpoints:
  POST   /memories          Add memories from messages
  POST   /search            Search memories
  GET    /memories           List all memories for a user
  DELETE /memories           Delete all memories for a user
  DELETE /memories/{id}      Delete a single memory
  GET    /memories/{id}/history  Memory change history
  GET    /health             Health check
"""

import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

logger = logging.getLogger("mem0-server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# Priority:
#   1. /app/config.yaml  (custom config file, mounted via docker-compose)
#   2. Environment variables (simple defaults for OpenAI-only setup)
# ---------------------------------------------------------------------------

CONFIG_PATH = Path(os.getenv("MEM0_CONFIG_PATH", "/app/config.yaml"))


def _expand_env_vars(obj: Any) -> Any:
    """Recursively expand ${VAR} references in string values."""
    if isinstance(obj, str):
        import re
        def _replace(m: re.Match) -> str:
            return os.getenv(m.group(1), m.group(0))
        return re.sub(r"\$\{(\w+)\}", _replace, obj)
    if isinstance(obj, dict):
        return {k: _expand_env_vars(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_expand_env_vars(v) for v in obj]
    return obj


def _load_config() -> dict:
    """Load Mem0 config from YAML file or build from env vars."""
    if CONFIG_PATH.exists():
        logger.info("Loading config from %s", CONFIG_PATH)
        raw = yaml.safe_load(CONFIG_PATH.read_text())
        cfg = _expand_env_vars(raw)

        # Ensure version and defaults
        cfg.setdefault("version", "v1.1")
        cfg.setdefault("history_db_path", "/app/history/history.db")

        # Inject Qdrant connection if vector_store not specified
        if "vector_store" not in cfg:
            vs_config: dict[str, Any] = {
                "host": os.getenv("QDRANT_HOST", "qdrant"),
                "port": int(os.getenv("QDRANT_PORT", "6333")),
                "collection_name": os.getenv("COLLECTION_NAME", "memories"),
            }
            # Propagate embedding_dims so Qdrant creates the collection
            # with the correct vector size
            embed_dims = cfg.get("embedder", {}).get("config", {}).get("embedding_dims")
            if embed_dims:
                vs_config["embedding_model_dims"] = embed_dims
            cfg["vector_store"] = {"provider": "qdrant", "config": vs_config}

        logger.info(
            "Config: llm=%s/%s, embedder=%s/%s, vector_store=%s",
            cfg.get("llm", {}).get("provider", "?"),
            cfg.get("llm", {}).get("config", {}).get("model", "?"),
            cfg.get("embedder", {}).get("provider", "?"),
            cfg.get("embedder", {}).get("config", {}).get("model", "?"),
            cfg.get("vector_store", {}).get("provider", "?"),
        )
        return cfg

    # ----- Fallback: build config from environment variables -----
    logger.info("No config file found — building from environment variables")
    return {
        "version": "v1.1",
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "host": os.getenv("QDRANT_HOST", "qdrant"),
                "port": int(os.getenv("QDRANT_PORT", "6333")),
                "collection_name": os.getenv("COLLECTION_NAME", "memories"),
            },
        },
        "llm": {
            "provider": os.getenv("LLM_PROVIDER", "openai"),
            "config": {
                "model": os.getenv("LLM_MODEL", "gpt-4o-mini"),
                "temperature": 0.1,
            },
        },
        "embedder": {
            "provider": os.getenv("EMBEDDER_PROVIDER", "openai"),
            "config": {
                "model": os.getenv("EMBEDDER_MODEL", "text-embedding-3-small"),
            },
        },
        "history_db_path": os.getenv("HISTORY_DB_PATH", "/app/history/history.db"),
    }


config = _load_config()

# ---------------------------------------------------------------------------
# Register custom embedding providers
# ---------------------------------------------------------------------------

from mem0.utils.factory import EmbedderFactory

# Register SageMaker embedder (allowlist patched in Dockerfile via sed)
EmbedderFactory.provider_to_class["sagemaker"] = "sagemaker_embedder.SageMakerEmbedding"

# ---------------------------------------------------------------------------
# App lifespan — initialise Memory once at startup
# ---------------------------------------------------------------------------

memory_instance = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global memory_instance
    from mem0 import Memory

    logger.info("Initialising Mem0...")
    memory_instance = Memory.from_config(config)
    logger.info(
        "Mem0 ready (llm=%s, embedder=%s, vector_store=%s)",
        config.get("llm", {}).get("provider", "?"),
        config.get("embedder", {}).get("provider", "?"),
        config.get("vector_store", {}).get("provider", "?"),
    )
    yield
    logger.info("Shutting down")


app = FastAPI(
    title="Mem0 OSS Server",
    description="Open-source memory server backed by Qdrant",
    lifespan=lifespan,
)


def _get_memory():
    if memory_instance is None:
        raise HTTPException(503, "Memory not initialised")
    return memory_instance


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class AddRequest(BaseModel):
    messages: list[dict[str, Any]]
    user_id: str | None = None
    agent_id: str | None = None
    run_id: str | None = None
    metadata: dict[str, Any] | None = None
    observation_date: str | None = None
    custom_instructions: str | None = None


class SearchRequest(BaseModel):
    query: str
    user_id: str | None = None
    agent_id: str | None = None
    run_id: str | None = None
    limit: int = Field(default=100, ge=1, le=1000)
    filters: dict[str, Any] | None = None
    rerank: bool = False


class UpdateRequest(BaseModel):
    data: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/memories")
def add_memories(req: AddRequest):
    """Add memories extracted from a conversation."""
    mem = _get_memory()
    params: dict[str, Any] = {}
    if req.user_id:
        params["user_id"] = req.user_id
    if req.agent_id:
        params["agent_id"] = req.agent_id
    if req.run_id:
        params["run_id"] = req.run_id
    if req.metadata:
        params["metadata"] = req.metadata
    # observation_date and custom_instructions: pass through only if
    # the installed mem0ai version supports them
    if req.custom_instructions:
        params["prompt"] = req.custom_instructions

    try:
        result = mem.add(req.messages, **params)
        return result
    except Exception as e:
        logger.exception("add() failed")
        raise HTTPException(500, str(e))


@app.post("/search")
def search_memories(req: SearchRequest):
    """Search memories by semantic similarity + BM25 + entity boost."""
    mem = _get_memory()
    params: dict[str, Any] = {"limit": req.limit}
    if req.user_id:
        params["user_id"] = req.user_id
    if req.agent_id:
        params["agent_id"] = req.agent_id
    if req.run_id:
        params["run_id"] = req.run_id
    if req.filters:
        params["filters"] = req.filters
    if req.rerank:
        params["rerank"] = True

    try:
        result = mem.search(req.query, **params)
        return result
    except Exception as e:
        logger.exception("search() failed")
        raise HTTPException(500, str(e))


@app.get("/memories")
def get_memories(
    user_id: str | None = Query(None),
    agent_id: str | None = Query(None),
    run_id: str | None = Query(None),
):
    """List all memories for a given user/agent/run."""
    mem = _get_memory()
    params: dict[str, Any] = {}
    if user_id:
        params["user_id"] = user_id
    if agent_id:
        params["agent_id"] = agent_id
    if run_id:
        params["run_id"] = run_id

    if not params:
        raise HTTPException(400, "Provide at least one of: user_id, agent_id, run_id")

    try:
        return mem.get_all(**params)
    except Exception as e:
        logger.exception("get_all() failed")
        raise HTTPException(500, str(e))


@app.get("/memories/{memory_id}")
def get_memory(memory_id: str):
    """Get a single memory by ID."""
    mem = _get_memory()
    try:
        return mem.get(memory_id)
    except Exception as e:
        raise HTTPException(404, str(e))


@app.put("/memories/{memory_id}")
def update_memory(memory_id: str, req: UpdateRequest):
    """Update a memory's content."""
    mem = _get_memory()
    try:
        return mem.update(memory_id, data=req.data)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/memories/{memory_id}")
def delete_memory(memory_id: str):
    """Delete a single memory."""
    mem = _get_memory()
    try:
        mem.delete(memory_id)
        return {"message": "Memory deleted"}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.delete("/memories")
def delete_all_memories(
    user_id: str | None = Query(None),
    agent_id: str | None = Query(None),
    run_id: str | None = Query(None),
):
    """Delete all memories for a user/agent/run."""
    mem = _get_memory()
    params: dict[str, Any] = {}
    if user_id:
        params["user_id"] = user_id
    if agent_id:
        params["agent_id"] = agent_id
    if run_id:
        params["run_id"] = run_id

    if not params:
        raise HTTPException(400, "Provide at least one of: user_id, agent_id, run_id")

    try:
        mem.delete_all(**params)
        return {"message": "All memories deleted"}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/memories/{memory_id}/history")
def memory_history(memory_id: str):
    """Get mutation history for a memory."""
    mem = _get_memory()
    try:
        return mem.history(memory_id)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/reset")
def reset_all():
    """Reset ALL memories. Use with caution."""
    mem = _get_memory()
    try:
        mem.reset()
        return {"message": "All memories reset"}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/health")
def health():
    """Health check."""
    return {
        "status": "ok",
        "llm": config.get("llm", {}).get("provider", "?"),
        "embedder": config.get("embedder", {}).get("provider", "?"),
    }


@app.get("/")
def root():
    return {"message": "Mem0 OSS Server", "docs": "/docs"}
