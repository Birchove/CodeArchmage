"""导读 Markdown 块解析测试（Stage 7b 循环 2）。

parse_guide_markdown 把 LLM 生成的导读 Markdown 切分为有序块：
- text 块：普通 Markdown
- code 块：```code file=... lines=a-b``` 引用，由引擎实时切片（不信 LLM 给的内容）

宽容解析原则（LLM 输出不可靠）：
- 畸形 code 围栏 / 缺 file 属性 → 降级为 text 块
- 行号越界 / 文件不在索引 → 降级为 text 块并注明原因
"""

from __future__ import annotations

from code_archmage.llm.guide_blocks import (
    CodeBlock,
    TextBlock,
    parse_guide_markdown,
)

VALID_FILES = {"src/a.py", "src/b.py"}
# src/a.py 有 10 行，src/b.py 有 20 行
FILE_LENGTHS = {"src/a.py": 10, "src/b.py": 20}


class TestParseGuideBlocks:
    """基本切分。"""

    def test_pure_text(self) -> None:
        """纯文本 → 单个 text 块。"""
        blocks = parse_guide_markdown("这是讲解段落。", VALID_FILES, FILE_LENGTHS)
        assert blocks == [TextBlock(text="这是讲解段落。")]

    def test_text_and_code_alternating(self) -> None:
        """text / code 交替切分（notebook 形态）。"""
        md = "第一段讲解。\n\n```code file=src/a.py lines=1-5\n```\n\n第二段讲解。"
        blocks = parse_guide_markdown(md, VALID_FILES, FILE_LENGTHS)
        assert blocks == [
            TextBlock(text="第一段讲解。"),
            CodeBlock(file_path="src/a.py", start_line=1, end_line=5, note=None),
            TextBlock(text="第二段讲解。"),
        ]

    def test_code_block_with_content_ignored(self) -> None:
        """LLM 在围栏里写了内容 → 忽略（以引擎切片为准）。"""
        md = "```code file=src/a.py lines=1-3\ndef fake():\n    pass\n```"
        blocks = parse_guide_markdown(md, VALID_FILES, FILE_LENGTHS)
        assert blocks == [CodeBlock(file_path="src/a.py", start_line=1, end_line=3, note=None)]

    def test_empty_markdown(self) -> None:
        """空内容 → 空列表。"""
        assert parse_guide_markdown("", VALID_FILES, FILE_LENGTHS) == []
        assert parse_guide_markdown("   \n  ", VALID_FILES, FILE_LENGTHS) == []


class TestParseGuideBlocksLenient:
    """宽容解析：坏输入降级，绝不抛异常。"""

    def test_unknown_file_degrades_to_text(self) -> None:
        """file 不在索引 → text 块注明原因。"""
        md = "```code file=not/indexed.py lines=1-5\n```"
        blocks = parse_guide_markdown(md, VALID_FILES, FILE_LENGTHS)
        assert len(blocks) == 1
        assert isinstance(blocks[0], TextBlock)
        assert "not/indexed.py" in blocks[0].text

    def test_out_of_range_lines_degrades_to_text(self) -> None:
        """行号越界 → text 块注明原因。"""
        md = "```code file=src/a.py lines=5-99\n```"
        blocks = parse_guide_markdown(md, VALID_FILES, FILE_LENGTHS)
        assert len(blocks) == 1
        assert isinstance(blocks[0], TextBlock)

    def test_malformed_fence_degrades_to_text(self) -> None:
        """缺 file / 缺 lines / 行号非数字 → 降级为 text。"""
        for bad in (
            "```code lines=1-5\n```",  # 缺 file
            "```code file=src/a.py\n```",  # 缺 lines
            "```code file=src/a.py lines=x-y\n```",  # 非数字
        ):
            blocks = parse_guide_markdown(bad, VALID_FILES, FILE_LENGTHS)
            assert len(blocks) == 1
            assert isinstance(blocks[0], TextBlock), f"应降级为 text：{bad!r}"

    def test_unclosed_code_fence_degrades(self) -> None:
        """未闭合的 code 围栏 → 降级为 text（不丢内容）。"""
        md = "讲解。\n\n```code file=src/a.py lines=1-2"
        blocks = parse_guide_markdown(md, VALID_FILES, FILE_LENGTHS)
        assert any(isinstance(b, TextBlock) and "讲解。" in b.text for b in blocks)

    def test_plain_code_fence_kept_as_text(self) -> None:
        """普通 ```python 围栏（LLM 示意代码）→ 原样保留在 text 块。"""
        md = "看这个模式：\n```python\ndef f(): pass\n```\n结束。"
        blocks = parse_guide_markdown(md, VALID_FILES, FILE_LENGTHS)
        # 全部归入 text（不产生 CodeBlock）
        assert all(isinstance(b, TextBlock) for b in blocks)
        joined = "".join(b.text for b in blocks if isinstance(b, TextBlock))
        assert "def f(): pass" in joined

    def test_reversed_line_range_degrades(self) -> None:
        """lines=5-2（起大于止）→ 降级。"""
        md = "```code file=src/a.py lines=5-2\n```"
        blocks = parse_guide_markdown(md, VALID_FILES, FILE_LENGTHS)
        assert len(blocks) == 1
        assert isinstance(blocks[0], TextBlock)
