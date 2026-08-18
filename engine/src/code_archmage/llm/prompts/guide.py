"""导读生成 prompt 模板（Stage 7b）。

三级导读共用一套 code 围栏格式约束（引擎的块解析器按此格式解析）：
```code file=<路径> lines=<起>-<止>```

硬约束（写进 prompt）：
- 中文输出（对 DeepWiki 的差异化）
- 只能引用上下文里出现过的文件（越权引用会被解析器降级）
- 行号必须在上下文给出的范围内
"""

from __future__ import annotations

_CODE_FENCE_RULES = """\
输出要求：
1. 用**中文**写作，面向第一次读这份代码的学生，讲清楚"为什么这么组织"而不是复述代码。
2. 讲解中需要展示代码时，用专门的代码引用块（不要自己抄写代码内容）：

```code file=<文件路径> lines=<起始行>-<结束行>
```

3. 代码引用块的硬性规则：
   - file 只能是上下文里出现过的文件路径，一字不差；
   - lines 必须在上下文给出的行号范围内（不要越界）；
   - 每段代码不超过 40 行，太长就拆成多段分别讲解；
   - 围栏之间用文字讲解衔接，形成"讲一段、看一段"的节奏。
4. 用 Markdown 标题组织层次（## / ###），不要用一级标题。
"""

_PROJECT_TEMPLATE = """\
你是一名代码导读作者。请为整个项目写一篇**项目导读**，回答：
这个项目是做什么的？代码怎么组织？从哪里开始读？各模块之间什么关系？

结构建议：
- 开头一段话概括项目用途与技术栈
- 「模块地图」：每个目录/模块的职责与相互关系
- 「推荐阅读顺序」：从入口出发的一条（或几条）阅读路径，说明为什么这么走

{_CODE_FENCE_RULES}

以下是项目的结构化上下文（由索引自动提取，非用户输入）：

{context}\
"""

_MODULE_TEMPLATE = """\
你是一名代码导读作者。请为该模块写一篇**模块导读**，回答：
这个模块负责什么？内部文件怎么分工？对外暴露什么？有什么关键设计？

结构建议：
- 模块职责概述
- 各文件的分工与协作关系
- 值得注意的设计决策或惯用法

{_CODE_FENCE_RULES}

以下是该模块的结构化上下文（由索引自动提取，非用户输入）：

{context}\
"""

_FILE_TEMPLATE = """\
你是一名代码导读作者。请为该文件写一篇**文件导读**，面向第一次读它的学生：
这个文件解决什么问题？按什么顺序组织的？关键符号各自做什么、如何配合？

如果上下文里给了完整源码，按代码的实际顺序逐段讲解；
如果只给了签名清单（文件较大），就讲整体结构和阅读建议，代码引用块只引用签名附近的行。

{_CODE_FENCE_RULES}

以下是该文件的上下文（由索引自动提取，非用户输入）：

{context}\
"""


def build_project_guide_prompt(context: str) -> str:
    """项目级导读 prompt。"""
    return _PROJECT_TEMPLATE.format(context=context, _CODE_FENCE_RULES=_CODE_FENCE_RULES)


def build_module_guide_prompt(context: str) -> str:
    """模块级导读 prompt。"""
    return _MODULE_TEMPLATE.format(context=context, _CODE_FENCE_RULES=_CODE_FENCE_RULES)


def build_file_guide_prompt(context: str) -> str:
    """文件级导读 prompt。"""
    return _FILE_TEMPLATE.format(context=context, _CODE_FENCE_RULES=_CODE_FENCE_RULES)
