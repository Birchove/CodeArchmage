"""惰性摘要：首次请求才调 LLM，结果缓存进 summaries 表。"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

from code_archmage.llm.config import LLMConfig
from code_archmage.llm.context import build_context
from code_archmage.llm.gateway import chat
from code_archmage.llm.prompts.summary import build_summary_prompt


@dataclass
class SummaryResult:
    symbol_id: int
    summary_text: str
    model: str
    cached: bool


def get_or_create(
    conn: sqlite3.Connection,
    symbol_id: int,
    config: LLMConfig,
    repo_root: Path,
) -> SummaryResult:
    """获取摘要缓存或惰性生成。

    - 有缓存 → 直接返回（不调 LLM）
    - 无缓存 → build_context → 调 LLM → 写入 summaries 表 → 返回
    """
    row = conn.execute(
        "SELECT summary_text, model FROM summaries WHERE symbol_id = ?",
        (symbol_id,),
    ).fetchone()
    if row is not None:
        return SummaryResult(
            symbol_id=symbol_id,
            summary_text=row[0],
            model=row[1],
            cached=True,
        )

    context = build_context(conn, symbol_id, repo_root=repo_root)
    prompt = build_summary_prompt(context)
    messages = [{"role": "user", "content": prompt}]
    summary_text = chat(messages, config)

    conn.execute(
        "INSERT OR REPLACE INTO summaries(symbol_id, summary_text, model, created_at) "
        "VALUES (?, ?, ?, datetime('now'))",
        (symbol_id, summary_text, config.model),
    )
    conn.commit()

    return SummaryResult(
        symbol_id=symbol_id,
        summary_text=summary_text,
        model=config.model,
        cached=False,
    )
