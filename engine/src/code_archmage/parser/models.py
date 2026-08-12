"""解析器输出的数据模型。

这些是解析阶段（单文件、无跨文件关系）的原始数据结构。
跨文件关系（caller-callee 边、定义-引用匹配）由索引器在阶段 2 建立。

设计原则：
- 用 frozen dataclass：不可变，可作为字典 key、可哈希、值相等比较
- 行号 1-based（符合编辑器/人类习惯），列号 0-based（tree-sitter 原生）
- signature 保留原始文本，便于展示
- 新增字段一律带默认值，保持向后兼容
"""

from __future__ import annotations

import enum
from dataclasses import dataclass


class SymbolKind(enum.StrEnum):
    """符号类型（StrEnum：Python 3.11+ 原生，可直接当字符串用）。"""

    FUNCTION = "function"
    CLASS = "class"
    VARIABLE = "variable"


@dataclass(frozen=True)
class Symbol:
    """一个代码符号（函数 / 类 / 变量）的定义。

    Attributes:
        name: 符号名（如 "foo"、"MyClass"、"MAX_SIZE"）
        kind: 符号类型
        file_path: 所在文件路径
        line: 定义起始行（1-based）
        col: 定义起始列（0-based）
        end_line: 定义结束行（1-based，含函数体最后一行）
        signature: 签名文本（函数为 "foo(x, y) -> int"，类为 "MyClass(Base)"，变量为空串）
        bases: 基类名列表（仅类有值，如 ("Base", "Mixin")）；索引器据此建继承图
        decorators: 装饰器名列表（如 ("dataclass", "staticmethod")）；不脱层，只记名字
    """

    name: str
    kind: SymbolKind
    file_path: str
    line: int
    col: int
    end_line: int
    signature: str
    bases: tuple[str, ...] = ()
    decorators: tuple[str, ...] = ()


@dataclass(frozen=True)
class Call:
    """一个函数调用点。

    解析阶段只记录"调用了谁的名字"和"在哪一行"，不记录"谁调用的"。
    caller 由索引器通过"调用点落在哪个函数的行范围内"推断。

    Attributes:
        callee_name: 被调用的名字（直接调用为 "foo"；方法调用 obj.method() 记 "method"）
        file_path: 所在文件路径
        line: 调用行（1-based）
        col: 被调用名列的起始列（0-based）
    """

    callee_name: str
    file_path: str
    line: int
    col: int


@dataclass(frozen=True)
class Import:
    """一条导入语句。

    覆盖所有 Python 导入形式（约定）：
        import x          → module="x",      imported_name="x", alias=None, level=0
        import x as y     → module="x",      imported_name="x", alias="y",  level=0
        import a.b.c      → module="a.b.c",  imported_name="a", alias=None, level=0
                            （绑定名是首段 "a"，不是 "a.b.c"）
        from x import y   → module="x",      imported_name="y", alias=None, level=0
        from x import y as z → module="x",   imported_name="y", alias="z",  level=0
        from x import *   → module="x",      imported_name="*", alias=None, level=0
        from .pkg import y  → module="pkg",  imported_name="y", alias=None, level=1
        from ..pkg import y → module="pkg",  imported_name="y", alias=None, level=2

    Attributes:
        file_path: 所在文件路径
        module: 模块名（不含前导点；相对导入的点用 level 表示）
        imported_name: 导入的名字（star 导入为 "*"）
        alias: 别名（as 后的名字），无别名为 None
        level: 相对导入层级（0=绝对导入，1=from .，2=from ..）
        line: 导入语句所在行（1-based）
    """

    file_path: str
    module: str
    imported_name: str
    alias: str | None
    level: int = 0
    line: int = 0


class ParseErrorKind(enum.StrEnum):
    """解析错误类型。"""

    SYNTAX_ERROR = "syntax_error"
    ENCODING_ERROR = "encoding_error"


@dataclass(frozen=True)
class ParseError:
    """一个解析错误（不致命，解析会继续并记录）。

    Attributes:
        kind: 错误类型
        message: 错误描述
        line: 错误所在行（1-based），编码错误可能为 None
    """

    kind: ParseErrorKind
    message: str
    line: int | None = None


@dataclass(frozen=True)
class ParseResult:
    """单个文件的完整解析结果。

    错误语义（重要）：
    - 文件不存在 / OSError → parse() 抛异常（调用方的 bug，不该静默）
    - 语法错误 / 编码错误 → 进 errors 字段（解析问题，不致命）
    - 正常解析 → symbols/calls/imports 填充，errors 为空

    Attributes:
        file_path: 文件路径
        symbols: 该文件定义的所有符号
        calls: 该文件中所有函数调用点
        imports: 该文件中所有导入语句
        errors: 解析过程中遇到的非致命错误
    """

    file_path: str
    symbols: tuple[Symbol, ...]
    calls: tuple[Call, ...]
    imports: tuple[Import, ...]
    errors: tuple[ParseError, ...] = ()
