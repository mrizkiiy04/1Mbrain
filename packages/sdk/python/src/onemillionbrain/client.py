"""HTTP client for the 1MBrain REST API — sync and async variants."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any, Optional
from urllib.error import HTTPError

from .models import (
    AssociateInput,
    AssociateResult,
    ConsolidationResult,
    Memory,
    RecallInput,
    RecallResult,
    RememberInput,
)

try:
    import httpx  # type: ignore[import]
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False


class OneMBrainError(Exception):
    """Raised when the 1MBrain API returns an error response."""

    def __init__(self, message: str, status: int, details: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.details = details


# ---------------------------------------------------------------------------
# Sync Client (uses stdlib urllib — zero extra dependencies)
# ---------------------------------------------------------------------------


class OneMBrainClient:
    """
    Synchronous 1MBrain client.

    Example::

        from onemillionbrain import OneMBrainClient

        client = OneMBrainClient(
            api_url="http://localhost:3001",
            api_key="your-api-key",
            agent_id="my-agent",
        )

        memory = client.remember("User prefers dark mode")
        results = client.recall("user preferences")
        client.forget(memory.id)
    """

    def __init__(
        self,
        api_url: str,
        api_key: str,
        agent_id: Optional[str] = None,
    ) -> None:
        if not api_url:
            raise ValueError("api_url is required")
        if not api_key:
            raise ValueError("api_key is required")

        self._api_url = api_url.rstrip("/")
        self._api_key = api_key
        self._agent_id = agent_id

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def remember(
        self,
        content: str | RememberInput,
        *,
        type: str = "episodic",
        importance: float = 0.5,
        tags: Optional[list[str]] = None,
        metadata: Optional[dict[str, Any]] = None,
        agent_id: Optional[str] = None,
    ) -> Memory:
        """Store a new memory and return the persisted Memory object."""
        if isinstance(content, str):
            inp = RememberInput(
                content=content,
                type=type,
                importance=importance,
                tags=tags,
                metadata=metadata,
                agent_id=agent_id,
            )
        else:
            inp = content

        resolved = self._resolve_agent_id(inp.agent_id or agent_id)
        payload = inp.to_dict(resolved)
        data = self._post("/v1/memories", payload, agent_id=resolved)
        return Memory.from_dict(data["data"])

    def recall(
        self,
        query: str | RecallInput,
        *,
        limit: int = 10,
        type: Optional[str] = None,
        tags: Optional[list[str]] = None,
        max_hops: Optional[int] = None,
        activation_threshold: Optional[float] = None,
        blend_weight: Optional[float] = None,
        agent_id: Optional[str] = None,
        cross_agent: Optional[bool] = None,
    ) -> list[RecallResult]:
        """Search memories using vector similarity + spreading activation."""
        if isinstance(query, str):
            inp = RecallInput(
                query=query,
                limit=limit,
                type=type,
                tags=tags,
                max_hops=max_hops,
                activation_threshold=activation_threshold,
                blend_weight=blend_weight,
                agent_id=agent_id,
                cross_agent=cross_agent,
            )
        else:
            inp = query

        resolved = self._resolve_agent_id(inp.agent_id or agent_id)
        params = inp.to_params(resolved)
        data = self._get("/v1/memories/search", params, agent_id=resolved)
        return [RecallResult.from_dict(item) for item in data["data"]]

    def forget(self, memory_id: str, *, agent_id: Optional[str] = None) -> bool:
        """Hard-delete a memory by ID."""
        resolved = self._resolve_agent_id(agent_id)
        data = self._delete(f"/v1/memories/{memory_id}", agent_id=resolved)
        return bool(data.get("success", False))

    def associate(
        self,
        source_id: str,
        target_id: str | AssociateInput,
        *,
        strength: float = 0.5,
        origin: str = "explicit",
        relation_type: str = "relates_to",
        agent_id: Optional[str] = None,
    ) -> AssociateResult:
        """Create an explicit association between two memories."""
        if isinstance(target_id, str):
            inp = AssociateInput(
                target_id=target_id,
                strength=strength,
                origin=origin,
                relation_type=relation_type,
                agent_id=agent_id,
            )
        else:
            inp = target_id

        resolved = self._resolve_agent_id(inp.agent_id or agent_id)
        data = self._post(
            f"/v1/memories/{source_id}/associate",
            inp.to_dict(),
            agent_id=resolved,
        )
        return AssociateResult(success=bool(data.get("success", False)))

    def consolidate(
        self,
        *,
        dry_run: Optional[bool] = None,
        cluster_strategy: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> ConsolidationResult:
        """Run memory consolidation for the current agent."""
        resolved = self._resolve_agent_id(agent_id)
        payload: dict[str, Any] = {"agentId": resolved}
        if dry_run is not None:
            payload["dryRun"] = dry_run
        if cluster_strategy is not None:
            payload["clusterStrategy"] = cluster_strategy

        data = self._post("/v1/consolidate", payload, agent_id=resolved)
        return ConsolidationResult.from_dict(data["data"])

    # ------------------------------------------------------------------
    # Low-level HTTP helpers (stdlib urllib)
    # ------------------------------------------------------------------

    def _headers(self, agent_id: str) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "X-API-Key": self._api_key,
            "X-Agent-Id": agent_id,
        }

    def _get(
        self, path: str, params: dict[str, str], *, agent_id: str
    ) -> dict[str, Any]:
        qs = urllib.parse.urlencode(params)
        url = f"{self._api_url}{path}?{qs}"
        req = urllib.request.Request(url, headers=self._headers(agent_id), method="GET")
        return self._send(req)

    def _post(
        self, path: str, body: dict[str, Any], *, agent_id: str
    ) -> dict[str, Any]:
        url = f"{self._api_url}{path}"
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            url, data=data, headers=self._headers(agent_id), method="POST"
        )
        return self._send(req)

    def _delete(self, path: str, *, agent_id: str) -> dict[str, Any]:
        url = f"{self._api_url}{path}"
        req = urllib.request.Request(
            url, headers=self._headers(agent_id), method="DELETE"
        )
        return self._send(req)

    def _send(self, req: urllib.request.Request) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(req) as resp:
                body = resp.read().decode()
                return json.loads(body) if body else {}
        except HTTPError as exc:
            body = exc.read().decode()
            try:
                payload = json.loads(body)
            except Exception:
                payload = {"error": body}
            msg = payload.get("error") or payload.get("message") or exc.reason
            raise OneMBrainError(str(msg), exc.code, payload) from exc

    def ingest_url(
        self,
        url: str,
        *,
        confidence_threshold: Optional[float] = None,
        max_chunk_chars: Optional[int] = None,
        deduplicate: Optional[bool] = None,
        agent_id: Optional[str] = None,
    ) -> dict:
        """
        Ingest a web page URL and store its factual content as memories.

        The server-side pipeline will:
        1. Fetch the HTML page
        2. Extract main content → clean Markdown
        3. Chunk and extract factual claims via LLM
        4. Store facts as memories (type, importance, metadata auto-set)
        5. Deduplicate (skips same content already ingested)

        Works from any gateway: Telegram bot, Discord bot, CLI, etc.

        Example::

            result = client.ingest_url("https://kompas.com/read/2024/tech")
            print(f"Stored {result['storedCount']} facts from {result['title']}")

        :param url: The web page URL to ingest.
        :param confidence_threshold: Min LLM confidence to store a fact (0-1, default 0.75).
        :param max_chunk_chars: Max chunk size in characters (default 1800).
        :param deduplicate: Skip if already ingested (default True).
        :param agent_id: Override agent ID for this call.
        :returns: Dict with title, url, storedCount, memoryIds, deduplicated, etc.
        """
        resolved = self._resolve_agent_id(agent_id)
        payload: dict = {"url": url, "agentId": resolved}
        if confidence_threshold is not None:
            payload["confidenceThreshold"] = confidence_threshold
        if max_chunk_chars is not None:
            payload["maxChunkChars"] = max_chunk_chars
        if deduplicate is not None:
            payload["deduplicate"] = deduplicate

        data = self._post("/v1/ingest/url", payload, agent_id=resolved)
        return data.get("data", data)

    def _resolve_agent_id(self, agent_id: Optional[str]) -> str:
        resolved = agent_id or self._agent_id
        if not resolved:
            raise ValueError(
                "agent_id is required — pass it to the constructor or each method call"
            )
        return resolved


# ---------------------------------------------------------------------------
# Async Client (requires httpx)
# ---------------------------------------------------------------------------


class AsyncOneMBrainClient:
    """
    Asynchronous 1MBrain client powered by httpx.

    Requires: ``pip install onemillionbrain[async]``

    Example::

        import asyncio
        from onemillionbrain import AsyncOneMBrainClient

        async def main():
            async with AsyncOneMBrainClient(
                api_url="http://localhost:3001",
                api_key="your-api-key",
                agent_id="my-agent",
            ) as client:
                memory = await client.remember("User prefers dark mode")
                results = await client.recall("user preferences")
                await client.forget(memory.id)

        asyncio.run(main())
    """

    def __init__(
        self,
        api_url: str,
        api_key: str,
        agent_id: Optional[str] = None,
    ) -> None:
        if not _HAS_HTTPX:
            raise ImportError(
                "httpx is required for AsyncOneMBrainClient. "
                "Install it with: pip install onemillionbrain[async]"
            )
        if not api_url:
            raise ValueError("api_url is required")
        if not api_key:
            raise ValueError("api_key is required")

        self._api_url = api_url.rstrip("/")
        self._api_key = api_key
        self._agent_id = agent_id
        self._client: Optional[Any] = None  # httpx.AsyncClient

    async def __aenter__(self) -> "AsyncOneMBrainClient":
        self._client = httpx.AsyncClient(base_url=self._api_url)
        return self

    async def __aexit__(self, *args: Any) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def remember(
        self,
        content: str | RememberInput,
        *,
        type: str = "episodic",
        importance: float = 0.5,
        tags: Optional[list[str]] = None,
        metadata: Optional[dict[str, Any]] = None,
        agent_id: Optional[str] = None,
    ) -> Memory:
        """Async — Store a new memory."""
        if isinstance(content, str):
            inp = RememberInput(
                content=content,
                type=type,
                importance=importance,
                tags=tags,
                metadata=metadata,
                agent_id=agent_id,
            )
        else:
            inp = content

        resolved = self._resolve_agent_id(inp.agent_id or agent_id)
        data = await self._post("/v1/memories", inp.to_dict(resolved), agent_id=resolved)
        return Memory.from_dict(data["data"])

    async def recall(
        self,
        query: str | RecallInput,
        *,
        limit: int = 10,
        type: Optional[str] = None,
        tags: Optional[list[str]] = None,
        max_hops: Optional[int] = None,
        activation_threshold: Optional[float] = None,
        blend_weight: Optional[float] = None,
        agent_id: Optional[str] = None,
        cross_agent: Optional[bool] = None,
    ) -> list[RecallResult]:
        """Async — Search memories."""
        if isinstance(query, str):
            inp = RecallInput(
                query=query,
                limit=limit,
                type=type,
                tags=tags,
                max_hops=max_hops,
                activation_threshold=activation_threshold,
                blend_weight=blend_weight,
                agent_id=agent_id,
                cross_agent=cross_agent,
            )
        else:
            inp = query

        resolved = self._resolve_agent_id(inp.agent_id or agent_id)
        params = inp.to_params(resolved)
        data = await self._get("/v1/memories/search", params, agent_id=resolved)
        return [RecallResult.from_dict(item) for item in data["data"]]

    async def forget(self, memory_id: str, *, agent_id: Optional[str] = None) -> bool:
        """Async — Delete a memory."""
        resolved = self._resolve_agent_id(agent_id)
        data = await self._delete(f"/v1/memories/{memory_id}", agent_id=resolved)
        return bool(data.get("success", False))

    async def associate(
        self,
        source_id: str,
        target_id: str | AssociateInput,
        *,
        strength: float = 0.5,
        origin: str = "explicit",
        relation_type: str = "relates_to",
        agent_id: Optional[str] = None,
    ) -> AssociateResult:
        """Async — Create an explicit association."""
        if isinstance(target_id, str):
            inp = AssociateInput(
                target_id=target_id,
                strength=strength,
                origin=origin,
                relation_type=relation_type,
                agent_id=agent_id,
            )
        else:
            inp = target_id

        resolved = self._resolve_agent_id(inp.agent_id or agent_id)
        data = await self._post(
            f"/v1/memories/{source_id}/associate",
            inp.to_dict(),
            agent_id=resolved,
        )
        return AssociateResult(success=bool(data.get("success", False)))

    async def consolidate(
        self,
        *,
        dry_run: Optional[bool] = None,
        cluster_strategy: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> ConsolidationResult:
        """Async â€” Run memory consolidation for the current agent."""
        resolved = self._resolve_agent_id(agent_id)
        payload: dict[str, Any] = {"agentId": resolved}
        if dry_run is not None:
            payload["dryRun"] = dry_run
        if cluster_strategy is not None:
            payload["clusterStrategy"] = cluster_strategy

        data = await self._post("/v1/consolidate", payload, agent_id=resolved)
        return ConsolidationResult.from_dict(data["data"])

    # ------------------------------------------------------------------
    # Low-level HTTP helpers (httpx)
    # ------------------------------------------------------------------

    def _headers(self, agent_id: str) -> dict[str, str]:
        return {
            "X-API-Key": self._api_key,
            "X-Agent-Id": agent_id,
        }

    async def _get(
        self, path: str, params: dict[str, str], *, agent_id: str
    ) -> dict[str, Any]:
        resp = await self._client.get(path, params=params, headers=self._headers(agent_id))
        return self._handle(resp)

    async def _post(
        self, path: str, body: dict[str, Any], *, agent_id: str
    ) -> dict[str, Any]:
        resp = await self._client.post(path, json=body, headers=self._headers(agent_id))
        return self._handle(resp)

    async def _delete(self, path: str, *, agent_id: str) -> dict[str, Any]:
        resp = await self._client.delete(path, headers=self._headers(agent_id))
        return self._handle(resp)

    def _handle(self, resp: Any) -> dict[str, Any]:
        payload: dict[str, Any] = resp.json() if resp.content else {}
        if resp.is_error:
            msg = payload.get("error") or payload.get("message") or resp.reason_phrase
            raise OneMBrainError(str(msg), resp.status_code, payload)
        return payload

    async def ingest_url(
        self,
        url: str,
        *,
        confidence_threshold: Optional[float] = None,
        max_chunk_chars: Optional[int] = None,
        deduplicate: Optional[bool] = None,
        agent_id: Optional[str] = None,
    ) -> dict:
        """
        Async — Ingest a web page URL and store its factual content as memories.

        Example::

            async with AsyncOneMBrainClient(...) as client:
                result = await client.ingest_url("https://example.com/article")
                print(f"Stored {result['storedCount']} facts")
        """
        resolved = self._resolve_agent_id(agent_id)
        payload: dict = {"url": url, "agentId": resolved}
        if confidence_threshold is not None:
            payload["confidenceThreshold"] = confidence_threshold
        if max_chunk_chars is not None:
            payload["maxChunkChars"] = max_chunk_chars
        if deduplicate is not None:
            payload["deduplicate"] = deduplicate

        data = await self._post("/v1/ingest/url", payload, agent_id=resolved)
        return data.get("data", data)

    def _resolve_agent_id(self, agent_id: Optional[str]) -> str:
        resolved = agent_id or self._agent_id
        if not resolved:
            raise ValueError(
                "agent_id is required — pass it to the constructor or each method call"
            )
        return resolved
