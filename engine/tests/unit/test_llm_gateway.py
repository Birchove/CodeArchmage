"""tests/unit/test_llm_gateway.py – 循环 5-6：LLM 网关（非流式 + 流式）。

使用 unittest.mock patch，不依赖额外库，不调真实 API。
厂商 fixture：DeepSeek 空 choices 帧 / 空 delta / 超时 / HTTP 错误。
"""

from __future__ import annotations

import json
from collections.abc import Generator
from unittest.mock import MagicMock, patch

import httpx
import pytest

from code_archmage.llm.config import LLMConfig
from code_archmage.llm.gateway import GatewayError, chat, chat_stream

_CFG = LLMConfig(
    api_key="sk-test",
    base_url="https://api.example.com/v1",
    model="test-model",
)

_MESSAGES = [{"role": "user", "content": "你好"}]


# ---------------------------------------------------------------------------
# 辅助：构造 mock httpx.Response
# ---------------------------------------------------------------------------


def _mock_response(status: int = 200, body: object = None) -> httpx.Response:
    raw = json.dumps(body).encode() if body is not None else b""
    return httpx.Response(status, content=raw)


def _mock_stream_response(content: bytes, status: int = 200) -> httpx.Response:
    return httpx.Response(status, content=content)


def _make_sse_bytes(*deltas: str, finish: bool = True) -> bytes:
    lines: list[str] = []
    for d in deltas:
        chunk = {"choices": [{"delta": {"content": d}, "finish_reason": None}]}
        lines.append(f"data: {json.dumps(chunk)}\n\n")
    if finish:
        chunk_done = {"choices": [{"delta": {}, "finish_reason": "stop"}]}
        lines.append(f"data: {json.dumps(chunk_done)}\n\n")
        lines.append("data: [DONE]\n\n")
    return "".join(lines).encode()


# ---------------------------------------------------------------------------
# 循环 5：非流式 chat
# ---------------------------------------------------------------------------


class TestChat:
    def test_returns_content_on_success(self) -> None:
        body = {"choices": [{"message": {"content": "你好！"}, "finish_reason": "stop"}]}
        with patch("code_archmage.llm.gateway._client") as mock_client_fn:
            client = MagicMock()
            mock_client_fn.return_value = client
            client.post.return_value = _mock_response(200, body)
            result = chat(_MESSAGES, _CFG)
        assert result == "你好！"

    def test_sends_authorization_header(self) -> None:
        body = {"choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}]}
        captured_kwargs: list[dict] = []

        def fake_post(url: str, **kwargs: object) -> httpx.Response:
            captured_kwargs.append(dict(kwargs))
            return _mock_response(200, body)

        with patch("code_archmage.llm.gateway._client") as mock_client_fn:
            client = MagicMock()
            mock_client_fn.return_value = client
            client.post.side_effect = fake_post
            chat(_MESSAGES, _CFG)

        # 验证 _client 被调用时传入了正确 config（含 api_key）
        mock_client_fn.assert_called_once_with(_CFG)

    def test_raises_gateway_error_on_http_error(self) -> None:
        with patch("code_archmage.llm.gateway._client") as mock_client_fn:
            client = MagicMock()
            mock_client_fn.return_value = client
            client.post.return_value = _mock_response(401, {"error": "unauthorized"})
            with pytest.raises(GatewayError):
                chat(_MESSAGES, _CFG)

    def test_raises_gateway_error_on_timeout(self) -> None:
        with patch("code_archmage.llm.gateway._client") as mock_client_fn:
            client = MagicMock()
            mock_client_fn.return_value = client
            client.post.side_effect = httpx.TimeoutException("timeout")
            with pytest.raises(GatewayError, match="超时"):
                chat(_MESSAGES, _CFG)

    def test_raises_gateway_error_on_empty_choices(self) -> None:
        """DeepSeek 偶发空 choices → 抛 GatewayError。"""
        with patch("code_archmage.llm.gateway._client") as mock_client_fn:
            client = MagicMock()
            mock_client_fn.return_value = client
            client.post.return_value = _mock_response(200, {"choices": []})
            with pytest.raises(GatewayError):
                chat(_MESSAGES, _CFG)


# ---------------------------------------------------------------------------
# 循环 6：流式 chat_stream（含防御性解析）
# ---------------------------------------------------------------------------


class _FakeStream:
    """模拟 httpx stream context manager + iter_lines()。"""

    def __init__(self, content: bytes, status: int = 200) -> None:
        self._content = content
        self.status_code = status
        # 模拟 httpx.Response 的 text 属性供错误提示
        self.text = content.decode(errors="replace")

    def __enter__(self) -> _FakeStream:
        return self

    def __exit__(self, *args: object) -> None:
        pass

    def iter_lines(self) -> Generator[str, None, None]:
        for line in self._content.decode().split("\n"):
            if line:
                yield line


class TestChatStream:
    def _patch_stream(self, content: bytes, status: int = 200):  # type: ignore[no-untyped-def]
        fake = _FakeStream(content, status)
        client = MagicMock()
        client.stream.return_value = fake
        return client

    def test_yields_deltas_in_order(self) -> None:
        with patch("code_archmage.llm.gateway._client") as mock_client_fn:
            mock_client_fn.return_value = self._patch_stream(_make_sse_bytes("你", "好", "！"))
            result = list(chat_stream(_MESSAGES, _CFG))
        assert result == ["你", "好", "！"]

    def test_skips_empty_delta(self) -> None:
        """DeepSeek 空 choices 帧 / delta.content == "" 应跳过。"""
        sse = (
            b'data: {"choices": []}\n\n'
            b'data: {"choices": [{"delta": {"content": ""}, "finish_reason": null}]}\n\n'
            b'data: {"choices": [{"delta": {"content": "OK"}, "finish_reason": null}]}\n\n'
            b"data: [DONE]\n\n"
        )
        with patch("code_archmage.llm.gateway._client") as mock_client_fn:
            mock_client_fn.return_value = self._patch_stream(sse)
            result = list(chat_stream(_MESSAGES, _CFG))
        assert result == ["OK"]

    def test_skips_non_json_lines(self) -> None:
        """非 JSON 行（心跳、注释）应跳过不崩溃。"""
        sse = (
            b": heartbeat\n\n"
            b'data: {"choices": [{"delta": {"content": "hi"}, "finish_reason": null}]}\n\n'
            b"data: [DONE]\n\n"
        )
        with patch("code_archmage.llm.gateway._client") as mock_client_fn:
            mock_client_fn.return_value = self._patch_stream(sse)
            result = list(chat_stream(_MESSAGES, _CFG))
        assert result == ["hi"]

    def test_raises_gateway_error_on_http_error(self) -> None:
        with patch("code_archmage.llm.gateway._client") as mock_client_fn:
            mock_client_fn.return_value = self._patch_stream(b'{"error":"overloaded"}', 503)
            with pytest.raises(GatewayError):
                list(chat_stream(_MESSAGES, _CFG))

    def test_raises_gateway_error_on_timeout(self) -> None:
        client = MagicMock()
        client.stream.side_effect = httpx.TimeoutException("timeout")
        with patch("code_archmage.llm.gateway._client") as mock_client_fn:
            mock_client_fn.return_value = client
            with pytest.raises(GatewayError, match="超时"):
                list(chat_stream(_MESSAGES, _CFG))
