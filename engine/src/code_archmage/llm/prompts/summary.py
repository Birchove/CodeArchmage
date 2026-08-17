"""摘要生成 prompt 模板。"""

from __future__ import annotations

_SUMMARY_TEMPLATE = """\
你是一名代码分析助手。请根据以下代码上下文，用**中文**写一句话摘要（不超过 50 字），
描述该符号的核心用途。要求：简洁、准确、不废话。只输出摘要正文，不加任何前缀或解释。

代码上下文：

{context}\
"""


def build_summary_prompt(context: str) -> str:
    """构建摘要生成 prompt。

    Args:
        context: build_context() 返回的上下文字符串。

    Returns:
        格式化后的 prompt 字符串（用于单次非流式调用）。
    """
    return _SUMMARY_TEMPLATE.format(context=context)
