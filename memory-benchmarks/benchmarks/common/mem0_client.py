"""
Mem0 Client
===========

Async client for Mem0 with two backend modes:

  - **oss** (default): Connects to the self-hosted Mem0 OSS server.
    Simple REST calls to /memories, /search, etc. No auth required.
    Start the server with: docker compose up -d

  - **cloud**: Connects to the Mem0 cloud API (api.mem0.ai).
    Uses V3 endpoints with async event polling. Requires API key + org/project IDs.

Both modes expose the same async interface:
  client.add(messages, user_id, ...)
  client.search(query, user_id, top_k=200, ...)
  client.delete_user(user_id)
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

import aiohttp
from aiolimiter import AsyncLimiter

logger = logging.getLogger(__name__)


class Mem0Client:
    """Async Mem0 client supporting both OSS server and cloud API.

    Args:
        mode: "oss" for self-hosted server, "cloud" for api.mem0.ai.
        host: Server URL. Defaults to MEM0_HOST env or http://localhost:8888 (oss)
              / https://api.mem0.ai (cloud).
        api_key: Cloud API key. Falls back to MEM0_API_KEY env var. (cloud mode only)
        organization_id: Cloud org ID. Falls back to MEM0_ORGANIZATION_ID. (cloud only)
        project_id: Cloud project ID. Falls back to MEM0_PROJECT_ID. (cloud only)
        max_retries: Maximum retry attempts for API calls.
        retry_delay: Base delay in seconds between retries (doubles each attempt).
        rpm: Requests per minute rate limit.
        timeout: HTTP request timeout in seconds.
        event_poll_interval: Seconds between event status polls. (cloud only)
        event_poll_timeout: Max seconds to wait for event completion. (cloud only)
    """

    def __init__(
        self,
        mode: str = "oss",
        host: str | None = None,
        api_key: str | None = None,
        organization_id: str | None = None,
        project_id: str | None = None,
        max_retries: int = 5,
        retry_delay: float = 5.0,
        rpm: int = 60,
        timeout: float = 300.0,
        event_poll_interval: float = 0.5,
        event_poll_timeout: float = 300.0,
    ):
        self.mode = mode

        if mode == "cloud":
            default_host = "https://api.mem0.ai"
        else:
            default_host = "http://localhost:8888"

        self.host = (host or os.getenv("MEM0_HOST", default_host)).rstrip("/")
        self.api_key = api_key or os.getenv("MEM0_API_KEY", "")
        self.organization_id = organization_id or os.getenv("MEM0_ORGANIZATION_ID", "")
        self.project_id = project_id or os.getenv("MEM0_PROJECT_ID", "")
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.event_poll_interval = event_poll_interval
        self.event_poll_timeout = event_poll_timeout
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.limiter = AsyncLimiter(100000, 60)  # no client-side rate limiting
        self._session: aiohttp.ClientSession | None = None

    @property
    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.mode == "cloud" and self.api_key:
            headers["Authorization"] = f"Token {self.api_key}"
        return headers

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            connector = aiohttp.TCPConnector(limit=0)  # unlimited concurrent connections
            self._session = aiohttp.ClientSession(
                headers=self._headers,
                timeout=self.timeout,
                connector=connector,
            )
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def __aenter__(self) -> Mem0Client:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    # =========================================================================
    # Add
    # =========================================================================

    async def add(
        self,
        messages: list[dict[str, str]],
        user_id: str,
        observation_date: str | None = None,
        timestamp: int | None = None,
        custom_instructions: str | None = None,
        metadata: dict | None = None,
    ) -> dict | None:
        """Add memories from a conversation.

        Returns dict with "results" key listing extracted memories, or None on failure.
        """
        if self.mode == "oss":
            return await self._add_oss(messages, user_id, observation_date, timestamp, custom_instructions, metadata)
        else:
            return await self._add_cloud(messages, user_id, observation_date, timestamp, custom_instructions, metadata)

    async def _add_oss(
        self, messages, user_id, observation_date, timestamp, custom_instructions, metadata,
    ) -> dict | None:
        """Add via OSS server — synchronous endpoint, no event polling."""
        session = await self._get_session()

        payload: dict[str, Any] = {"messages": messages, "user_id": user_id}
        if timestamp is not None:
            payload["timestamp"] = timestamp
        elif observation_date is not None:
            # Convert ISO date to unix epoch
            try:
                d = datetime.strptime(observation_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                payload["timestamp"] = int(d.timestamp())
            except ValueError:
                pass
        if custom_instructions:
            payload["custom_instructions"] = custom_instructions
        if metadata:
            payload["metadata"] = metadata

        for attempt in range(self.max_retries):
            try:
                async with self.limiter:
                    async with session.post(f"{self.host}/memories", json=payload) as resp:
                        if resp.status >= 500:
                            raise aiohttp.ClientResponseError(
                                resp.request_info, resp.history, status=resp.status
                            )
                        resp.raise_for_status()
                        data = await resp.json()

                # Normalise: OSS returns {"results": [...]} directly
                if isinstance(data, dict) and "results" in data:
                    return data
                if isinstance(data, list):
                    return {"results": data}
                return {"results": []}

            except Exception as exc:
                logger.warning("ADD attempt %d/%d failed (user=%s): %s", attempt + 1, self.max_retries, user_id, str(exc)[:200])
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                else:
                    logger.error("ADD failed after %d attempts for user=%s", self.max_retries, user_id)
                    return None

    async def _add_cloud(
        self, messages, user_id, observation_date, timestamp, custom_instructions, metadata,
    ) -> dict | None:
        """Add via Mem0 cloud V3 API with async event polling."""
        session = await self._get_session()

        payload: dict[str, Any] = {"messages": messages, "user_id": user_id}
        # Cloud V3 API accepts `timestamp` (unix epoch int), not observation_date
        if timestamp is not None:
            payload["timestamp"] = timestamp
        elif observation_date is not None:
            # Convert ISO date string to unix epoch for the cloud API
            from datetime import datetime as dt_cls
            try:
                d = dt_cls.strptime(observation_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                payload["timestamp"] = int(d.timestamp())
            except ValueError:
                pass
        if custom_instructions:
            payload["custom_instructions"] = custom_instructions
        if metadata:
            payload["metadata"] = metadata

        for attempt in range(self.max_retries):
            try:
                async with self.limiter:
                    async with session.post(f"{self.host}/v3/memories/", json=payload) as resp:
                        resp.raise_for_status()
                        resp_data = await resp.json()

                event_id = resp_data.get("event_id")
                if not event_id:
                    logger.warning("V3 add returned no event_id: %s", resp_data)
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(self.retry_delay * (attempt + 1))
                        continue
                    return None

                event_data = await self._wait_for_event(event_id)
                if event_data is None:
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(self.retry_delay * (attempt + 1))
                        continue
                    return None

                return {"results": self._parse_event_results(event_data)}

            except Exception as exc:
                logger.warning("ADD attempt %d/%d failed (user=%s): %s", attempt + 1, self.max_retries, user_id, str(exc)[:200])
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                else:
                    logger.error("ADD failed after %d attempts for user=%s", self.max_retries, user_id)
                    return None

    # =========================================================================
    # Search
    # =========================================================================

    async def search(
        self,
        query: str,
        user_id: str,
        top_k: int = 200,
        rerank: bool = False,
        score_debug: bool = False,
    ) -> list[dict]:
        """Search memories. Returns list of results sorted by score descending."""
        if self.mode == "oss":
            return await self._search_oss(query, user_id, top_k, rerank)
        else:
            return await self._search_cloud(query, user_id, top_k, rerank, score_debug)

    async def _search_oss(self, query, user_id, top_k, rerank) -> list[dict]:
        """Search via OSS server."""
        session = await self._get_session()
        payload: dict[str, Any] = {
            "query": query,
            "user_id": user_id,
            "limit": top_k,
        }
        if rerank:
            payload["rerank"] = True

        for attempt in range(self.max_retries):
            try:
                async with self.limiter:
                    async with session.post(f"{self.host}/search", json=payload) as resp:
                        if resp.status >= 500:
                            raise aiohttp.ClientResponseError(
                                resp.request_info, resp.history, status=resp.status
                            )
                        resp.raise_for_status()
                        data = await resp.json()

                # Normalise OSS results
                results = data.get("results", data) if isinstance(data, dict) else data
                if not isinstance(results, list):
                    results = []

                normalised = []
                for r in results:
                    entry: dict[str, Any] = {
                        "memory": r.get("memory", r.get("data", "")),
                        "score": r.get("score", 0),
                        "id": r.get("id", ""),
                    }
                    if r.get("created_at"):
                        entry["created_at"] = r["created_at"]
                    if r.get("updated_at"):
                        entry["updated_at"] = r["updated_at"]
                    # Map score_breakdown → score_debug for consistency
                    breakdown = r.get("score_breakdown") or r.get("score_debug")
                    if breakdown:
                        entry["score_debug"] = {
                            "combined_score": r.get("score", 0),
                            "semantic_score": breakdown.get("semantic", 0),
                            "bm25_score": breakdown.get("bm25", 0),
                            "entity_boost": breakdown.get("entity_boost", 0),
                        }
                    normalised.append(entry)

                normalised.sort(key=lambda x: x.get("score", 0), reverse=True)
                return normalised

            except Exception as exc:
                logger.warning("SEARCH attempt %d/%d failed (user=%s): %s", attempt + 1, self.max_retries, user_id, str(exc)[:200])
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                else:
                    logger.error("SEARCH failed after %d attempts for user=%s", self.max_retries, user_id)
                    return []

    async def _search_cloud(self, query, user_id, top_k, rerank, score_debug) -> list[dict]:
        """Search via Mem0 cloud V3 API."""
        session = await self._get_session()
        payload: dict[str, Any] = {
            "query": query,
            "filters": {"user_id": user_id},
            "top_k": top_k,
            "rerank": rerank,
        }
        if score_debug:
            payload["score_debug"] = True

        for attempt in range(self.max_retries):
            try:
                async with self.limiter:
                    async with session.post(f"{self.host}/v3/memories/search/", json=payload) as resp:
                        resp.raise_for_status()
                        resp_data = await resp.json()

                results = resp_data.get("results", []) if isinstance(resp_data, dict) else resp_data
                results.sort(key=lambda x: x.get("score", 0), reverse=True)
                return results

            except Exception as exc:
                logger.warning("SEARCH attempt %d/%d failed (user=%s): %s", attempt + 1, self.max_retries, user_id, str(exc)[:200])
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                else:
                    logger.error("SEARCH failed after %d attempts for user=%s", self.max_retries, user_id)
                    return []

    # =========================================================================
    # Delete
    # =========================================================================

    async def delete_user(self, user_id: str) -> bool:
        """Delete all memories for a user. Returns True on success."""
        if self.mode == "oss":
            return await self._delete_user_oss(user_id)
        else:
            return await self._delete_user_cloud(user_id)

    async def _delete_user_oss(self, user_id: str) -> bool:
        session = await self._get_session()
        try:
            async with self.limiter:
                async with session.delete(
                    f"{self.host}/memories",
                    params={"user_id": user_id},
                ) as resp:
                    resp.raise_for_status()
            logger.info("Deleted memories for user %s", user_id)
            return True
        except Exception as exc:
            logger.warning("Failed to delete user %s: %s", user_id, exc)
            return False

    async def _delete_user_cloud(self, user_id: str) -> bool:
        session = await self._get_session()
        try:
            async with self.limiter:
                async with session.delete(f"{self.host}/v1/entities/user/{user_id}/") as resp:
                    resp.raise_for_status()
            logger.info("Deleted user %s", user_id)
            return True
        except Exception as exc:
            logger.warning("Failed to delete user %s: %s", user_id, exc)
            return False

    # =========================================================================
    # Cloud-only: event polling
    # =========================================================================

    async def _get_event_status(self, event_id: str) -> dict | None:
        session = await self._get_session()
        url = f"{self.host}/v1/event/{event_id}/"
        for attempt in range(3):
            try:
                async with self.limiter:
                    async with session.get(url) as resp:
                        resp.raise_for_status()
                        return await resp.json()
            except Exception as exc:
                logger.warning("Event poll %d/3 failed for %s: %s", attempt + 1, event_id, exc)
                if attempt < 2:
                    await asyncio.sleep(self.retry_delay)
        return None

    async def _wait_for_event(self, event_id: str) -> dict | None:
        start = time.monotonic()
        while (time.monotonic() - start) < self.event_poll_timeout:
            data = await self._get_event_status(event_id)
            if data is None:
                return None
            status = data.get("status", "UNKNOWN")
            if status == "SUCCEEDED":
                return data
            if status == "FAILED":
                logger.error("Event %s failed: %s", event_id, data.get("error", ""))
                return None
            await asyncio.sleep(self.event_poll_interval)
        logger.error("Event %s timed out after %.0fs", event_id, self.event_poll_timeout)
        return None

    @staticmethod
    def _parse_event_results(event_data: dict) -> list[dict]:
        raw = event_data.get("results", [])
        results = []
        if not raw or not isinstance(raw, list):
            return results
        for item in raw:
            if not isinstance(item, dict):
                continue
            if "memory" in item and "event" in item:
                results.append(item)
            elif "data" in item and isinstance(item.get("data"), dict):
                data = item["data"]
                entry = {
                    "id": item.get("id"),
                    "event": item.get("event"),
                    "memory": data.get("memory"),
                }
                if item.get("event") == "UPDATE":
                    entry["previous_memory"] = data.get("old_memory", data.get("previous_memory", ""))
                results.append(entry)
        return results


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def format_search_results(search_results: list[dict]) -> tuple[list[dict], dict | None]:
    """Normalize search results into a clean format for benchmark output.

    Returns:
        Tuple of (formatted results list, query_debug dict or None).
    """
    if not search_results:
        return [], None

    query_debug = None
    if isinstance(search_results, dict):
        query_debug = search_results.get("query_debug")
        search_results = search_results.get("results", [])

    sorted_results = sorted(search_results, key=lambda x: x.get("score", 0), reverse=True)
    formatted = []
    for r in sorted_results:
        entry: dict[str, Any] = {
            "memory": r.get("memory", ""),
            "score": r.get("score", 0),
            "id": r.get("id", ""),
        }
        if r.get("created_at"):
            entry["created_at"] = r["created_at"]
        if r.get("updated_at"):
            entry["updated_at"] = r["updated_at"]
        if r.get("score_debug"):
            entry["score_debug"] = r["score_debug"]
        formatted.append(entry)
    return formatted, query_debug
