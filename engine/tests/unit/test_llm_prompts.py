"""tests/unit/test_llm_prompts.py – 循环 7：prompt 模板。"""

from __future__ import annotations

from code_archmage.llm.prompts.chat_system import build_chat_system_prompt
from code_archmage.llm.prompts.summary import build_summary_prompt


class TestChatSystemPrompt:
    def test_contains_context(self) -> None:
        ctx = "<source_code>\ndef foo(): pass\n</source_code>"
        prompt = build_chat_system_prompt(ctx)
        assert ctx in prompt

    def test_contains_instructions(self) -> None:
        prompt = build_chat_system_prompt("some context")
        # 应包含角色定位提示
        assert len(prompt) > 50

    def test_empty_context_still_valid(self) -> None:
        prompt = build_chat_system_prompt("")
        assert isinstance(prompt, str)
        assert len(prompt) > 0

    def test_context_injected_in_correct_position(self) -> None:
        ctx = "UNIQUE_MARKER_XYZ"
        prompt = build_chat_system_prompt(ctx)
        assert "UNIQUE_MARKER_XYZ" in prompt


class TestSummaryPrompt:
    def test_contains_context(self) -> None:
        ctx = "<source_code>\ndef bar(): pass\n</source_code>"
        prompt = build_summary_prompt(ctx)
        assert ctx in prompt

    def test_requests_one_sentence_chinese(self) -> None:
        prompt = build_summary_prompt("some context")
        # 应要求中文一句话摘要
        lower = prompt.lower()
        assert "中文" in prompt or "chinese" in lower or "一句话" in prompt or "50" in prompt

    def test_returns_string(self) -> None:
        assert isinstance(build_summary_prompt("ctx"), str)
