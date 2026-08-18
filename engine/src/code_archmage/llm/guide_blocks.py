"""导读 Markdown 块解析（Stage 7b 循环 2）。

把 LLM 生成的导读 Markdown 切分为有序块：
- TextBlock：普通 Markdown（含 LLM 示意的 ```python 围栏，原样保留）
- CodeBlock：```code file=... lines=a-b``` 引用，内容由引擎实时切片

宽容解析原则（LLM 输出不可靠）：
- 畸形围栏 / 缺属性 / 行号非法 / 文件不在索引 → 降级为 text 块并注明原因
- 绝不抛异常：解析失败只影响展示形态，不影响导读可用性
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

_CODE_FENCE_PREFIX = "code"
_FENCE_RE = re.compile(r"^\s*```(.*)$")
_CODE_ATTR_RE = re.compile(r"^\s*code\s+file=(\S+)\s+lines=(\d+)-(\d+)\s*$")


@dataclass(frozen=True)
class TextBlock:
    """普通 Markdown 块（渲染为 react-markdown）。"""

    text: str


@dataclass(frozen=True)
class CodeBlock:
    """源码引用块（file_path + lines；内容由引擎切片，不信 LLM 给的内容）。"""

    file_path: str
    start_line: int
    end_line: int
    note: str | None  # 预留：截断等附加说明


GuideBlock = TextBlock | CodeBlock


def parse_guide_markdown(
    markdown: str,
    valid_files: frozenset[str] | set[str],
    file_lengths: Mapping[str, int],
) -> list[GuideBlock]:
    """把导读 Markdown 切分为块列表。

    Args:
        markdown: LLM 生成的导读原文。
        valid_files: 索引内的文件路径集合（越权引用降级）。
        file_lengths: 每个文件的行数（行号越界降级）。

    Returns:
        有序的块列表；坏 code 引用降级为带说明的 text 块。
    """
    lines = markdown.split("\n")
    blocks: list[GuideBlock] = []
    text_buf: list[str] = []
    n = len(lines)

    def flush() -> None:
        text = "\n".join(text_buf).strip()
        if text:
            blocks.append(TextBlock(text=text))
        text_buf.clear()

    i = 0
    while i < n:
        m = _FENCE_RE.match(lines[i])
        if m and m.group(1).strip().startswith(_CODE_FENCE_PREFIX):
            attr = _CODE_ATTR_RE.match(m.group(1))
            if attr:
                # 找闭合围栏（内容不可信，跳过即可）
                j = i + 1
                while j < n and not _FENCE_RE.match(lines[j]):
                    j += 1
                closed = j < n
                if closed:
                    flush()
                    blocks.append(_resolve_code_block(attr, valid_files, file_lengths))
                    i = j + 1
                    continue
            # 未闭合或属性畸形 → 围栏行并入 text，照常展示
            text_buf.append(lines[i])
            i += 1
            continue

        # 普通行 / 普通围栏（```python 等）→ 归入 text
        text_buf.append(lines[i])
        if m:  # 普通围栏：把围栏体也收进来直到闭合
            i += 1
            while i < n and not _FENCE_RE.match(lines[i]):
                text_buf.append(lines[i])
                i += 1
            if i < n:
                text_buf.append(lines[i])
        i += 1

    flush()
    return blocks


def _resolve_code_block(
    attr: re.Match[str],
    valid_files: frozenset[str] | set[str],
    file_lengths: Mapping[str, int],
) -> GuideBlock:
    """校验 code 引用：合法 → CodeBlock，否则降级为说明性 text。"""
    file_path = attr.group(1)
    start_line = int(attr.group(2))
    end_line = int(attr.group(3))

    if file_path not in valid_files:
        return TextBlock(text=f"（引用了索引外的文件 `{file_path}`，代码块已省略）")
    total = file_lengths.get(file_path, 0)
    if start_line < 1 or end_line > total or start_line > end_line:
        return TextBlock(
            text=(
                f"（引用的行号 {start_line}-{end_line} 超出 `{file_path}`"
                f" 的范围（共 {total} 行），代码块已省略）"
            )
        )
    return CodeBlock(file_path=file_path, start_line=start_line, end_line=end_line, note=None)
