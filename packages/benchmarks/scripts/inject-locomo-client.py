"""
Mock Mem0 Client for 1MBrain
============================

This file overwrites `benchmarks/common/mem0_client.py` in the memory-benchmarks suite.
It intercepts `add()` and `search()` calls intended for Mem0 and translates them to 1MBrain's API.
"""

import asyncio
import logging
import os
import json
from typing import Any

import httpx
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

class Mem0Client:
    def __init__(
        self,
        mode: str = "oss",
        host: str | None = None,
        api_key: str | None = None,
        **kwargs,
    ):
        # Point to the 1MBrain API server
        self.api_url = (host or os.getenv("ONEMBRAIN_HOST", "http://localhost:3000")).rstrip("/")
        self.api_key = api_key or os.getenv("ONEMBRAIN_API_KEY", "test-key")
        self.openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self._session = None

    async def __aenter__(self):
        self._session = httpx.AsyncClient(base_url=self.api_url)
        return self

    async def __aexit__(self, *exc):
        if self._session:
            await self._session.aclose()

    @property
    def _headers(self):
        return {
            "Content-Type": "application/json",
            "X-API-Key": self.api_key,
        }

    async def add(self, messages: list[dict[str, str]], user_id: str, **kwargs) -> dict | None:
        """Extract facts from messages using OpenAI and store them in 1MBrain."""
        if not self._session:
            self._session = httpx.AsyncClient(base_url=self.api_url)

        # 1. Convert conversation to a single text block
        text = "\n".join(f"{m['role']}: {m['content']}" for m in messages)

        # 2. Extract facts using OpenAI (mimicking what Mem0 does internally)
        prompt = (
            "Extract factual memories, preferences, and claims about the users from the following conversation.\n"
            "Return a JSON object with a 'facts' array containing strings.\n\n"
            f"Conversation:\n{text}"
        )

        try:
            response = await self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content
            if not content:
                return {"results": []}
            
            data = json.loads(content)
            facts = data.get("facts", [])
        except Exception as e:
            logger.error(f"Extraction failed: {e}")
            return {"results": []}

        # 3. Store each fact in 1MBrain
        results = []
        for fact in facts:
            headers = self._headers.copy()
            headers["X-Agent-Id"] = user_id
            payload = {
                "content": fact,
                "type": "episodic",
                "importance": 0.5,
                "tags": ["locomo-benchmark"]
            }
            try:
                resp = await self._session.post("/v1/memories", json=payload, headers=headers)
                resp.raise_for_status()
                mem_data = resp.json().get("data", {})
                results.append({"memory": fact, "event": "ADD", "id": mem_data.get("id", "")})
            except Exception as e:
                logger.error(f"Failed to save fact to 1MBrain: {e}")

        return {"results": results}

    async def search(self, query: str, user_id: str, top_k: int = 200, **kwargs) -> list[dict]:
        """Search 1MBrain and return Mem0-formatted results."""
        if not self._session:
            self._session = httpx.AsyncClient(base_url=self.api_url)

        headers = self._headers.copy()
        headers["X-Agent-Id"] = user_id
        
        params = {
            "query": query,
            "limit": top_k,
        }

        try:
            resp = await self._session.get("/v1/memories/search", params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json().get("data", [])
            
            # Format to match what LOCOMO expects
            formatted = []
            for item in data:
                formatted.append({
                    "id": item.get("id", ""),
                    "memory": item.get("content", ""),
                    "score": item.get("score", 0.0),
                })
            return formatted
        except Exception as e:
            logger.error(f"Search failed: {e}")
            return []

    async def delete_user(self, user_id: str) -> bool:
        """1MBrain doesn't have a mass delete_user endpoint out of the box, we just mock it for tests."""
        return True

def format_search_results(search_results: list[dict]) -> tuple[list[dict], dict | None]:
    return search_results, None
