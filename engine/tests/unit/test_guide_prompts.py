"""tests/unit/test_guide_prompts.py – Stage 7b：导读 prompt 模板。"""

from __future__ import annotations

from code_archmage.llm.prompts.guide import (
    build_file_guide_prompt,
    build_module_guide_prompt,
    build_project_guide_prompt,
)


class TestGuidePrompts:
    """三级 prompt 的共性要求：注入上下文 + 中文 + code 围栏格式约束。"""

    def test_project_prompt_contains_context_and_rules(self) -> None:
        ctx = "PROJECT_CTX_MARKER"
        prompt = build_project_guide_prompt(ctx)
        assert ctx in prompt
        assert "中文" in prompt
        assert "```code" in prompt  # 必须给出 code 围栏格式要求

    def test_module_prompt_contains_context_and_rules(self) -> None:
        ctx = "MODULE_CTX_MARKER"
        prompt = build_module_guide_prompt(ctx)
        assert ctx in prompt
        assert "file=" in prompt
        assert "lines=" in prompt

    def test_file_prompt_contains_context_and_rules(self) -> None:
        ctx = "FILE_CTX_MARKER"
        prompt = build_file_guide_prompt(ctx)
        assert ctx in prompt
        assert "code" in prompt

    def test_prompts_are_distinct(self) -> None:
        """三级 prompt 角色不同（不能共用一套指令）。"""
        p = build_project_guide_prompt("x")
        m = build_module_guide_prompt("x")
        f = build_file_guide_prompt("x")
        assert len({p, m, f}) == 3

    def test_prompt_warns_only_indexed_files(self) -> None:
        """必须明确约束：只能引用上下文里出现过的文件。"""
        prompt = build_module_guide_prompt("x")
        assert "索引" in prompt or "上下文" in prompt
