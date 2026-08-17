"""LLM 网关——OpenAI 兼容协议。

支持任何 OpenAI 兼容的供应商（DeepSeek / 智谱 / 通义千问 / Ollama 等）。
使用 httpx 直调，不引入 openai SDK（保留流式控制权）。

- chat()        非流式，返回完整 assistant 内容字符串
- chat_stream() 流式，yield delta 字符串（防御性解析：跳过非 JSON / 空 delta / 空 choices）
"""

from __future__ import annotations

import json
from collections.abc import Generator, Sequence

import httpx

from code_archmage.llm.config import LLMConfig

# 请求超时（秒）
_TIMEOUT = 60.0

Message = dict[str, str]


class GatewayError(Exception):
    """LLM 网关调用失败（HTTP 错误 / 超时 / 响应格式异常）。"""


def chat(
    messages: Sequence[Message],
    config: LLMConfig,
    *,
    timeout: float = _TIMEOUT,
) -> str:
    """非流式调用。返回 assistant 回复字符串。

    Raises:
        GatewayError: HTTP 错误、超时、或响应格式异常。
    """
    try:
        resp = _client(config).post(
            "/chat/completions",
            json={"model": config.model, "messages": list(messages), "stream": False},
            timeout=timeout,
        )
    except httpx.TimeoutException as e:
        raise GatewayError(f"LLM 调用超时：{e}") from e
    except httpx.RequestError as e:
        raise GatewayError(f"LLM 请求失败：{e}") from e

    _raise_for_status(resp)

    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise GatewayError(f"LLM 返回空 choices：{data}")
    content = choices[0].get("message", {}).get("content", "")
    return str(content)


def chat_stream(
    messages: Sequence[Message],
    config: LLMConfig,
    *,
    timeout: float = _TIMEOUT,
) -> Generator[str, None, None]:
    """流式调用。yield delta 字符串（防御性：跳过非 JSON / 空 delta / 空 choices）。

    Raises:
        GatewayError: HTTP 错误或超时（在第一个 yield 前抛出）。
    """
    try:
        with _client(config).stream(
            "POST",
            "/chat/completions",
            json={"model": config.model, "messages": list(messages), "stream": True},
            timeout=timeout,
        ) as resp:
            _raise_for_status(resp)
            for line in resp.iter_lines():
                delta = _parse_sse_line(line)
                if delta:
                    yield delta
    except httpx.TimeoutException as e:
        raise GatewayError(f"LLM 流式调用超时：{e}") from e
    except httpx.RequestError as e:
        raise GatewayError(f"LLM 流式请求失败：{e}") from e


# ---------------------------------------------------------------------------
# 私有辅助
# ---------------------------------------------------------------------------


def _client(config: LLMConfig) -> httpx.Client:
    return httpx.Client(
        base_url=config.base_url,
        headers={"Authorization": f"Bearer {config.api_key}"},
    )


def _raise_for_status(resp: httpx.Response) -> None:
    """HTTP 非 2xx → 抛 GatewayError。"""
    if resp.status_code >= 400:
        raise GatewayError(
            f"LLM 服务返回错误 {resp.status_code}：{resp.text[:200]}"
        )


def _parse_sse_line(line: str) -> str:
    """解析单行 SSE 数据，返回 delta content 字符串。

    防御性行为：
    - 非 `data: ` 开头行（心跳 / 注释）→ 跳过
    - `[DONE]` → 跳过
    - JSON 解析失败 → 跳过
    - 空 choices / 空 delta.content → 跳过
    """
    if not line.startswith("data: "):
        return ""
    payload = line[len("data: "):]
    if payload.strip() == "[DONE]":
        return ""
    try:
        data = json.loads(payload)
    except (json.JSONDecodeError, ValueError):
        return ""
    choices = data.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    content = delta.get("content") or ""
    return str(content)
