"""
1MBrain Python HTTP Server Wrapper
===================================
A lightweight HTTP server that proxies requests from local agent tools
(Hermes, LangChain plugins, etc.) to the 1MBrain Node.js API server.

Usage:
    python server.py [--port 8765] [--api-url http://localhost:3100] [--api-key YOUR_KEY]

Or via environment variables:
    ONEMILLION_API_URL=http://localhost:3100 ONEMILLION_API_KEY=your-key python server.py
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import HTTPError
import urllib.parse
import urllib.request

# ---------------------------------------------------------------------------
# Logging — always write to stderr so crashes are visible
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("1mbrain-server")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def get_config() -> dict:
    parser = argparse.ArgumentParser(description="1MBrain Python server wrapper")
    parser.add_argument("--port", type=int, default=int(os.environ.get("SERVER_PORT", "8765")))
    parser.add_argument(
        "--api-url",
        default=os.environ.get("ONEMILLION_API_URL", "http://localhost:3100"),
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("ONEMILLION_API_KEY", os.environ.get("MASTER_API_KEY", "")),
    )
    args = parser.parse_args()
    return {"port": args.port, "api_url": args.api_url.rstrip("/"), "api_key": args.api_key}


CONFIG: dict = {}


# ---------------------------------------------------------------------------
# Request Handler
# ---------------------------------------------------------------------------

class OneMBrainProxyHandler(BaseHTTPRequestHandler):
    """
    Proxies HTTP requests to the 1MBrain Node.js API server.

    Bug fixes applied (from Hermes agent feedback 2025-06):
      - Use self.rfile.read(n) instead of self.request.read() ← critical
      - Override log_message() to use logger instead of pass ← observability
      - Wrap all handlers in try/except ← prevent silent connection drops
    """

    # ------------------------------------------------------------------
    # Logging — never silence this in production code
    # ------------------------------------------------------------------

    def log_message(self, format: str, *args: object) -> None:  # type: ignore[override]
        """Route access logs to Python logger instead of stdout."""
        logger.debug("HTTP %s", format % args)

    def log_error(self, format: str, *args: object) -> None:  # type: ignore[override]
        """Route error logs to Python logger."""
        logger.error("HTTP error %s", format % args)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _read_body(self) -> bytes:
        """Read request body safely using self.rfile (not self.request)."""
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return b""
        return self.rfile.read(length)  # ← correct: rfile, not request.read()

    def _proxy(self, method: str, body: bytes | None = None) -> None:
        """Forward the request to the 1MBrain Node.js API and relay the response."""
        target_url = CONFIG["api_url"] + self.path
        headers: dict[str, str] = {
            "Content-Type": self.headers.get("content-type", "application/json"),
            "X-API-Key": CONFIG.get("api_key", ""),
        }
        # Forward auth headers if present
        for h in ("x-agent-id", "x-api-key", "authorization"):
            val = self.headers.get(h)
            if val:
                headers[h] = val

        req = urllib.request.Request(
            target_url,
            data=body if body else None,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(req) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("content-type", "application/json"))
                self.send_header("Content-Length", str(len(resp_body)))
                self.end_headers()
                self.wfile.write(resp_body)

        except HTTPError as exc:
            err_body = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err_body)))
            self.end_headers()
            self.wfile.write(err_body)
            logger.warning("Upstream error %s %s → HTTP %d", method, self.path, exc.code)

        except Exception as exc:  # noqa: BLE001
            logger.error("Proxy error %s %s: %s", method, self.path, exc, exc_info=True)
            error_body = json.dumps({"success": False, "error": str(exc)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(error_body)))
            self.end_headers()
            self.wfile.write(error_body)

    # ------------------------------------------------------------------
    # HTTP Method Handlers — all wrapped in try/except to prevent silent drops
    # ------------------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        try:
            self._proxy("GET")
        except Exception:  # noqa: BLE001
            logger.error("Unhandled error in do_GET:\n%s", traceback.format_exc())
            self._send_internal_error()

    def do_POST(self) -> None:  # noqa: N802
        try:
            body = self._read_body()
            self._proxy("POST", body)
        except Exception:  # noqa: BLE001
            logger.error("Unhandled error in do_POST:\n%s", traceback.format_exc())
            self._send_internal_error()

    def do_DELETE(self) -> None:  # noqa: N802
        try:
            self._proxy("DELETE")
        except Exception:  # noqa: BLE001
            logger.error("Unhandled error in do_DELETE:\n%s", traceback.format_exc())
            self._send_internal_error()

    def do_PUT(self) -> None:  # noqa: N802
        try:
            body = self._read_body()
            self._proxy("PUT", body)
        except Exception:  # noqa: BLE001
            logger.error("Unhandled error in do_PUT:\n%s", traceback.format_exc())
            self._send_internal_error()

    def _send_internal_error(self) -> None:
        body = json.dumps({"success": False, "error": "Internal proxy error"}).encode()
        try:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception:  # noqa: BLE001
            pass  # Connection already broken — nothing we can do


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    global CONFIG  # noqa: PLW0603
    CONFIG = get_config()

    if not CONFIG["api_key"]:
        logger.warning(
            "No API key configured — set ONEMILLION_API_KEY or MASTER_API_KEY env var, "
            "or pass --api-key. Requests requiring auth will be rejected."
        )

    server = HTTPServer(("0.0.0.0", CONFIG["port"]), OneMBrainProxyHandler)

    logger.info(
        "1MBrain Python proxy server started\n"
        "  Listening on: http://0.0.0.0:%d\n"
        "  Forwarding to: %s\n"
        "  API key: %s",
        CONFIG["port"],
        CONFIG["api_url"],
        "***" + CONFIG["api_key"][-4:] if len(CONFIG.get("api_key", "")) > 4 else "(not set)",
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server stopped by user (SIGINT)")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
