"""
LLM Client
==========

Pluggable async LLM client supporting multiple providers:
- OpenAI (default)
- Anthropic
- Azure OpenAI

Provides text generation and structured output (JSON/Pydantic).
Includes retry logic and rate limiting.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, TypeVar

from aiolimiter import AsyncLimiter

logger = logging.getLogger(__name__)

T = TypeVar("T")


class LLMClient:
    """Async LLM client with retry logic and rate limiting.

    Supports OpenAI, Anthropic, and Azure OpenAI providers. For OpenAI-compatible
    APIs (e.g., vLLM, Parasail), set provider="openai" with a custom base_url.

    Args:
        model: Model identifier (e.g., "gpt-4o", "claude-sonnet-4-20250514").
        provider: One of "openai", "anthropic", "azure".
        api_key: API key. Falls back to provider-specific env vars.
        base_url: Custom base URL (OpenAI-compatible providers).
        max_retries: Maximum retry attempts per call.
        rpm: Requests per minute rate limit.
        timeout: Request timeout in seconds.
    """

    def __init__(
        self,
        model: str = "gpt-4o",
        provider: str = "openai",
        api_key: str | None = None,
        base_url: str | None = None,
        max_retries: int = 5,
        rpm: int = 200,
        timeout: float = 120.0,
        **kwargs: Any,
    ):
        self.model = model
        self.provider = provider.lower()
        self.max_retries = max_retries
        self.limiter = AsyncLimiter(rpm, 60)
        self.timeout = timeout
        self._client: Any = None
        self._api_key = api_key
        self._base_url = base_url

        if self.provider == "openai":
            self._api_key = (
                self._api_key
                or os.getenv("DEEPSEEK_API_KEY")
                or os.getenv("OPENAI_API_KEY")
            )
            self._base_url = (
                self._base_url
                or os.getenv("DEEPSEEK_BASE_URL")
                or os.getenv("OPENAI_BASE_URL")
            )

        if self.provider == "anthropic":
            self._init_anthropic(api_key)
        elif self.provider == "azure":
            self._init_azure(api_key, timeout, **kwargs)
        else:
            self._init_openai(self._api_key, self._base_url, timeout, **kwargs)

    def _openai_chat_token_limit_kwargs(self, max_tokens: int) -> dict[str, Any]:
        """Chat Completions: gpt-5 / o-series reject ``max_tokens``; use ``max_completion_tokens``."""
        m = self.model.lower()
        if m.startswith(("gpt-5", "o1", "o3", "o4")):
            return {"max_completion_tokens": max_tokens}
        return {"max_tokens": max_tokens}

    def _openai_chat_temperature_kwargs(self, temperature: float) -> dict[str, Any]:
        """gpt-5 / o-series only accept the default temperature (1); omit the param for those models."""
        m = self.model.lower()
        if m.startswith(("gpt-5", "o1", "o3", "o4")):
            return {}
        return {"temperature": temperature}

    def _parse_yes_no_judgment(self, raw: str) -> bool:
        """Extract the final yes/no verdict from judge output."""
        text = raw.strip()
        if not text:
            return False

        after_cot = re.split(r"</judge_thinking>|</thinking>", text, flags=re.IGNORECASE)
        verdict_region = after_cot[-1].strip() if after_cot else text
        verdict_lines = [line.strip().lower() for line in verdict_region.splitlines() if line.strip()]

        for line in reversed(verdict_lines):
            if line == "yes":
                return True
            if line == "no":
                return False

        token_matches = re.findall(r"\b(yes|no)\b", verdict_region.lower())
        if token_matches:
            return token_matches[-1] == "yes"

        return text.lower().startswith("yes")
    def _init_openai(self, api_key: str | None, base_url: str | None, timeout: float, **kwargs: Any) -> None:
        import openai
        client_kwargs: dict[str, Any] = {
            "timeout": openai.Timeout(timeout, connect=10.0),
        }
        if api_key:
            client_kwargs["api_key"] = api_key
        if base_url:
            client_kwargs["base_url"] = base_url
        self._client = openai.AsyncOpenAI(**client_kwargs)

    def _init_azure(self, api_key: str | None, timeout: float, **kwargs: Any) -> None:
        import openai
        self._client = openai.AsyncAzureOpenAI(
            azure_endpoint=kwargs.get("azure_endpoint") or os.getenv("AZURE_OPENAI_ENDPOINT", ""),
            api_key=api_key or os.getenv("AZURE_OPENAI_API_KEY"),
            api_version=kwargs.get("api_version", "2024-12-01-preview"),
            timeout=openai.Timeout(timeout, connect=10.0),
        )

    def _init_anthropic(self, api_key: str | None) -> None:
        import anthropic
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key or os.getenv("ANTHROPIC_API_KEY"),
        )

    # -------------------------------------------------------------------------
    # Text generation
    # -------------------------------------------------------------------------

    async def generate(
        self,
        system: str,
        user: str,
        temperature: float = 0,
        max_tokens: int = 4096,
    ) -> str:
        """Generate a text response.

        Args:
            system: System prompt.
            user: User message.
            temperature: Sampling temperature.
            max_tokens: Maximum tokens in the response.

        Returns:
            Generated text string.
        """
        if self.provider == "anthropic":
            return await self._generate_anthropic(system, user, temperature, max_tokens)
        return await self._generate_openai(system, user, temperature, max_tokens)

    async def _generate_openai(self, system: str, user: str, temperature: float, max_tokens: int) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})

        for attempt in range(self.max_retries):
            try:
                async with self.limiter:
                    resp = await asyncio.wait_for(
                        self._client.chat.completions.create(
                            model=self.model,
                            messages=messages,
                            **self._openai_chat_temperature_kwargs(temperature),
                            **self._openai_chat_token_limit_kwargs(max_tokens),
                        ),
                        timeout=self.timeout,
                    )
                content = resp.choices[0].message.content
                if content is None:
                    logger.warning(
                        "Generation returned None (finish_reason=%s)",
                        resp.choices[0].finish_reason,
                    )
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(2 * (attempt + 1))
                        continue
                    return ""
                return content.strip()
            except asyncio.TimeoutError:
                logger.warning("Generation attempt %d/%d timed out", attempt + 1, self.max_retries)
            except Exception as exc:
                logger.warning("Generation attempt %d/%d failed: %s", attempt + 1, self.max_retries, exc)
            if attempt < self.max_retries - 1:
                await asyncio.sleep(2 * (attempt + 1))
        return ""

    async def _generate_anthropic(self, system: str, user: str, temperature: float, max_tokens: int) -> str:
        for attempt in range(self.max_retries):
            try:
                async with self.limiter:
                    kwargs: dict[str, Any] = {
                        "model": self.model,
                        "messages": [{"role": "user", "content": user}],
                        "max_tokens": max_tokens,
                        "temperature": temperature,
                    }
                    if system:
                        kwargs["system"] = system
                    resp = await asyncio.wait_for(
                        self._client.messages.create(**kwargs),
                        timeout=self.timeout,
                    )
                content = resp.content[0].text if resp.content else ""
                return content.strip()
            except asyncio.TimeoutError:
                logger.warning("Anthropic generation attempt %d/%d timed out", attempt + 1, self.max_retries)
            except Exception as exc:
                logger.warning("Anthropic generation attempt %d/%d failed: %s", attempt + 1, self.max_retries, exc)
            if attempt < self.max_retries - 1:
                await asyncio.sleep(2 * (attempt + 1))
        return ""

    # -------------------------------------------------------------------------
    # Structured output
    # -------------------------------------------------------------------------

    async def generate_structured(
        self,
        system: str,
        user: str,
        response_format: type[T] | None = None,
        temperature: float = 0,
        max_tokens: int = 4096,
    ) -> Any:
        """Generate a structured response.

        For OpenAI/Azure, uses response_format={"type": "json_object"}.
        For Anthropic, instructs the model to return JSON and parses it.

        Args:
            system: System prompt.
            user: User message.
            response_format: Pydantic model class for validation (optional).
            temperature: Sampling temperature.
            max_tokens: Maximum tokens.

        Returns:
            Parsed dict or Pydantic model instance.
        """
        if self.provider == "anthropic":
            return await self._generate_structured_anthropic(system, user, response_format, temperature, max_tokens)
        return await self._generate_structured_openai(system, user, response_format, temperature, max_tokens)

    async def _generate_structured_openai(
        self,
        system: str,
        user: str,
        response_format: type[T] | None,
        temperature: float,
        max_tokens: int,
    ) -> Any:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})

        for attempt in range(self.max_retries):
            try:
                async with self.limiter:
                    resp = await asyncio.wait_for(
                        self._client.chat.completions.create(
                            model=self.model,
                            messages=messages,
                            **self._openai_chat_temperature_kwargs(temperature),
                            response_format={"type": "json_object"},
                            **self._openai_chat_token_limit_kwargs(max_tokens),
                        ),
                        timeout=self.timeout,
                    )
                raw = resp.choices[0].message.content
                if not raw:
                    if attempt < self.max_retries - 1:
                        await asyncio.sleep(2 * (attempt + 1))
                        continue
                    return {}

                parsed = json.loads(raw.strip())

                # Unwrap nested "final" wrapper some models produce
                if "final" in parsed and len(parsed) == 1:
                    inner = parsed["final"]
                    if isinstance(inner, str):
                        parsed = json.loads(inner)
                    elif isinstance(inner, dict):
                        parsed = inner

                if response_format is not None:
                    return response_format(**parsed)
                return parsed

            except (json.JSONDecodeError, ValueError) as exc:
                logger.warning("Structured output parse error attempt %d/%d: %s", attempt + 1, self.max_retries, exc)
            except asyncio.TimeoutError:
                logger.warning("Structured output attempt %d/%d timed out", attempt + 1, self.max_retries)
            except Exception as exc:
                logger.warning("Structured output attempt %d/%d failed: %s", attempt + 1, self.max_retries, exc)
            if attempt < self.max_retries - 1:
                await asyncio.sleep(2 * (attempt + 1))

        return {} if response_format is None else None

    async def _generate_structured_anthropic(
        self,
        system: str,
        user: str,
        response_format: type[T] | None,
        temperature: float,
        max_tokens: int,
    ) -> Any:
        # Anthropic doesn't have native JSON mode; instruct in system prompt
        json_system = system
        if "json" not in system.lower():
            json_system = f"{system}\n\nIMPORTANT: You must respond with valid JSON only. No other text."

        for attempt in range(self.max_retries):
            try:
                async with self.limiter:
                    kwargs: dict[str, Any] = {
                        "model": self.model,
                        "messages": [{"role": "user", "content": user}],
                        "max_tokens": max_tokens,
                        "temperature": temperature,
                    }
                    if json_system:
                        kwargs["system"] = json_system
                    resp = await asyncio.wait_for(
                        self._client.messages.create(**kwargs),
                        timeout=self.timeout,
                    )
                raw = resp.content[0].text if resp.content else ""
                raw = raw.strip()

                # Extract JSON from code blocks if wrapped
                json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
                if json_match:
                    raw = json_match.group(1)

                parsed = json.loads(raw)
                if response_format is not None:
                    return response_format(**parsed)
                return parsed

            except (json.JSONDecodeError, ValueError) as exc:
                logger.warning("Anthropic structured parse error attempt %d/%d: %s", attempt + 1, self.max_retries, exc)
            except asyncio.TimeoutError:
                logger.warning("Anthropic structured attempt %d/%d timed out", attempt + 1, self.max_retries)
            except Exception as exc:
                logger.warning("Anthropic structured attempt %d/%d failed: %s", attempt + 1, self.max_retries, exc)
            if attempt < self.max_retries - 1:
                await asyncio.sleep(2 * (attempt + 1))

        return {} if response_format is None else None

    # -------------------------------------------------------------------------
    # Yes/No judge shortcut
    # -------------------------------------------------------------------------

    async def judge_yes_no(self, prompt: str) -> tuple[bool, str]:
        """Run a yes/no judge prompt. Returns (correct, raw_response)."""
        raw = await self.generate(system="", user=prompt, temperature=0)
        return self._parse_yes_no_judgment(raw), raw
