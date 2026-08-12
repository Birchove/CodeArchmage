"""tree-sitter Python 解析器。

输入 Python 源码，输出该文件的符号、调用、导入、错误（ParseResult）。

设计：
- 单文件解析，不处理跨文件关系（那是索引器的活）
- 行号 1-based，列号 0-based
- 错误语义三分：
  * 文件不存在 / OSError → 抛异常（调用方的 bug）
  * 语法错误 / 编码错误 → 进 ParseResult.errors（不致命）
  * 正常解析 → 填充 symbols/calls/imports
- 线程安全：Language 全局共享（构建昂贵），Parser 每次新建（构造便宜，无共享状态）
"""

from __future__ import annotations

from pathlib import Path

import tree_sitter_python as tspython
from tree_sitter import Language, Node, Parser, Tree

from .models import (
    Call,
    Import,
    ParseError,
    ParseErrorKind,
    ParseResult,
    Symbol,
    SymbolKind,
)

# Language 全局共享（构建昂贵，线程安全只读）
_LANGUAGE: Language = Language(tspython.language())


def _new_parser() -> Parser:
    """新建 Parser（构造便宜，避免共享实例的线程安全问题）。"""
    return Parser(_LANGUAGE)


def parse(file_path: Path) -> ParseResult:
    """解析单个 Python 文件。

    编码处理（PEP 263）：
    1. 检测 UTF-8 BOM 并剥离
    2. 尝试 UTF-8 解码
    3. UTF-8 失败则读 coding 声明，用声明的编码解码后转回 UTF-8
    4. 全部失败则返回空结果 + ENCODING_ERROR

    Args:
        file_path: 文件路径

    Returns:
        ParseResult

    Raises:
        FileNotFoundError: 文件不存在
        OSError: 文件不可读
    """
    file_path = Path(file_path)
    raw = file_path.read_bytes()
    source, encoding_error = _decode_source(raw)

    if encoding_error is not None:
        # 解码彻底失败：返回空结果 + 编码错误
        return ParseResult(
            file_path=str(file_path),
            symbols=(),
            calls=(),
            imports=(),
            errors=(encoding_error,),
        )

    return parse_source(source, str(file_path))


def _decode_source(raw: bytes) -> tuple[bytes, ParseError | None]:
    """按 PEP 263 解码源文件字节。

    Returns:
        (UTF-8 编码的 source, 错误)。成功时错误为 None。
    """
    # 1. 剥离 UTF-8 BOM
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
        # 有 BOM 一定是 UTF-8，直接返回
        return (raw, None)

    # 2. 尝试 UTF-8（Python 默认编码）
    try:
        raw.decode("utf-8")
        return (raw, None)  # 是合法 UTF-8，直接用
    except UnicodeDecodeError:
        pass  # 继续 try coding 声明

    # 3. 读 coding 声明（PEP 263：在前两行）
    encoding = _detect_coding(raw)
    if encoding is not None:
        try:
            text = raw.decode(encoding)
            return (text.encode("utf-8"), None)
        except (UnicodeDecodeError, LookupError):
            pass  # 声明的编码也解不了，或编码名无效

    # 4. 全部失败
    return (
        b"",
        ParseError(
            kind=ParseErrorKind.ENCODING_ERROR,
            message="无法解码文件：不是合法 UTF-8，且未找到有效的 coding 声明",
        ),
    )


def _detect_coding(raw: bytes) -> str | None:
    """检测 PEP 263 coding 声明（只看前两行）。

    支持两种形式：
    - # coding: xxx
    - # -*- coding: xxx -*-
    """
    import re

    # 只取前两行（PEP 263 规定）
    head = raw.split(b"\n", 2)[:2]
    pattern = re.compile(rb"coding[=:]\s*([-\w.]+)")

    for line in head:
        match = pattern.search(line)
        if match:
            return match.group(1).decode("ascii", errors="replace")
    return None


def parse_source(source: bytes, file_path: str) -> ParseResult:
    """解析 Python 源码字节串。

    底层接口，供 parse() 和测试使用。测试可内联代码字符串，不必每个场景落 fixture 文件。

    Args:
        source: 源码字节
        file_path: 用于填充结果的文件路径（仅作标识，不读取）

    Returns:
        ParseResult
    """
    parser = _new_parser()
    tree = parser.parse(source)
    return _extract(file_path, source, tree)


def _extract(file_path: str, source: bytes, tree: Tree) -> ParseResult:
    """从 AST 提取符号、调用、导入、错误。"""
    symbols: list[Symbol] = []
    calls: list[Call] = []
    imports: list[Import] = []
    errors: list[ParseError] = []

    # 收集语法错误（tree-sitter 用 ERROR 节点标记）
    _collect_syntax_errors(source, tree.root_node, errors)

    # 迭代遍历（显式栈，避免深嵌套栈溢出）
    _walk_iterative(file_path, source, tree.root_node, symbols, calls, imports)

    # 按代码位置排序（栈遍历是 LIFO，需排序保证按出现顺序输出）
    symbols.sort(key=lambda s: (s.line, s.col))
    calls.sort(key=lambda c: (c.line, c.col))
    imports.sort(key=lambda i: i.line)

    return ParseResult(
        file_path=file_path,
        symbols=tuple(symbols),
        calls=tuple(calls),
        imports=tuple(imports),
        errors=tuple(errors),
    )


def _walk_iterative(
    file_path: str,
    source: bytes,
    root: Node,
    symbols: list[Symbol],
    calls: list[Call],
    imports: list[Import],
) -> None:
    """迭代遍历 AST（显式栈），收集符号/调用/导入。

    顺序无关（我们只收集不排序），用 LIFO 栈即可。
    从 root.children 开始遍历，不处理 root 本身（避免 _walk_with_decorators 重复处理）。
    """
    stack: list[Node] = list(root.children)
    while stack:
        node = stack.pop()
        node_type = node.type

        if node_type == "function_definition":
            sym = _build_function_symbol(file_path, source, node)
            if sym is not None:
                symbols.append(sym)
        elif node_type == "class_definition":
            sym = _build_class_symbol(file_path, source, node, decorators=())
            if sym is not None:
                symbols.append(sym)
        elif node_type == "call":
            call = _build_call(file_path, source, node)
            if call is not None:
                calls.append(call)
        elif node_type == "import_statement":
            imp = _build_import_statement(file_path, source, node)
            imports.extend(imp)
        elif node_type == "import_from_statement":
            imp = _build_import_from_statement(file_path, source, node)
            imports.extend(imp)
        elif node_type == "decorated_definition":
            # 装饰器定义：提取装饰器名，递归进内部定义时把装饰器传下去
            decos = _extract_decorators(source, node)
            for child in node.children:
                if child.type in ("function_definition", "class_definition"):
                    _walk_with_decorators(file_path, source, child, symbols, calls, imports, decos)
                else:
                    stack.append(child)
            continue  # 已手动处理子节点，不重复推入

        # 继续遍历子节点
        for child in node.children:
            stack.append(child)


def _walk_with_decorators(
    file_path: str,
    source: bytes,
    node: Node,
    symbols: list[Symbol],
    calls: list[Call],
    imports: list[Import],
    decorators: tuple[str, ...],
) -> None:
    """处理带装饰器信息的定义节点，并继续遍历其子树。"""
    if node.type == "function_definition":
        sym = _build_function_symbol(file_path, source, node, decorators=decorators)
        if sym is not None:
            symbols.append(sym)
    elif node.type == "class_definition":
        sym = _build_class_symbol(file_path, source, node, decorators=decorators)
        if sym is not None:
            symbols.append(sym)

    # 继续遍历子节点（找嵌套定义/调用）
    _walk_iterative(file_path, source, node, symbols, calls, imports)


def _extract_decorators(source: bytes, decorated_node: Node) -> tuple[str, ...]:
    """从 decorated_definition 提取装饰器名列表（从上到下）。"""
    names: list[str] = []
    for child in decorated_node.children:
        if child.type == "decorator":
            # decorator 节点：@ + 表达式（通常是 identifier，也可能是 attribute 如 @a.b）
            name = _decorator_name(child, source)
            if name is not None:
                names.append(name)
    return tuple(names)


def _decorator_name(decorator_node: Node, source: bytes) -> str | None:
    """取单个装饰器的名字（取最末段，如 @a.b.c 取 c）。"""
    # decorator 的子节点：@ + 表达式
    for child in decorator_node.children:
        if child.type == "@":
            continue
        # 表达式可能是 identifier、attribute、call 等
        return _expression_name(child, source)
    return None


def _expression_name(node: Node, source: bytes) -> str | None:
    """取表达式节点的名字（identifier 取自身；attribute 取末段；call 取被调者名）。"""
    if node.type == "identifier":
        return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")
    if node.type == "attribute":
        # a.b.c → 取最后一个 identifier
        last_id = None
        for child in node.children:
            if child.type == "identifier":
                last_id = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
        return last_id
    if node.type == "call":
        # @foo() 形式：call 的第一个子节点是表达式
        for child in node.children:
            if child.type != "argument_list":
                return _expression_name(child, source)
    # 兜底：取整个文本
    text = source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")
    return text


def _build_function_symbol(
    file_path: str, source: bytes, node: Node, decorators: tuple[str, ...] = ()
) -> Symbol | None:
    """从 function_definition 节点构建 Symbol（含返回注解 + 装饰器）。"""
    name = _child_text(node, source, "identifier")
    if name is None:
        return None

    params_text = _child_text(node, source, "parameters") or ""
    return_type = _return_type_text(node, source)
    signature = f"{name}{params_text}"
    if return_type is not None:
        signature = f"{signature} -> {return_type}"

    start_row = node.start_point[0] + 1
    start_col = node.start_point[1]
    end_row = node.end_point[0] + 1

    return Symbol(
        name=name,
        kind=SymbolKind.FUNCTION,
        file_path=file_path,
        line=start_row,
        col=start_col,
        end_line=end_row,
        signature=signature,
        decorators=decorators,
    )


def _build_class_symbol(
    file_path: str, source: bytes, node: Node, decorators: tuple[str, ...] = ()
) -> Symbol | None:
    """从 class_definition 节点构建 Symbol（含基类 + 装饰器）。"""
    name = _child_text(node, source, "identifier")
    if name is None:
        return None

    bases = _extract_bases(source, node)
    bases_text = ", ".join(bases)
    signature = f"{name}({bases_text})" if bases else name

    start_row = node.start_point[0] + 1
    start_col = node.start_point[1]
    end_row = node.end_point[0] + 1

    return Symbol(
        name=name,
        kind=SymbolKind.CLASS,
        file_path=file_path,
        line=start_row,
        col=start_col,
        end_line=end_row,
        signature=signature,
        bases=bases,
        decorators=decorators,
    )


def _extract_bases(source: bytes, class_node: Node) -> tuple[str, ...]:
    """从 class_definition 的 argument_list 提取基类名列表。"""
    arg_list = None
    for child in class_node.children:
        if child.type == "argument_list":
            arg_list = child
            break
    if arg_list is None:
        return ()

    bases: list[str] = []
    for child in arg_list.children:
        if child.type == "identifier":
            bases.append(
                source[child.start_byte : child.end_byte].decode("utf-8", errors="replace")
            )
    return tuple(bases)


def _return_type_text(node: Node, source: bytes) -> str | None:
    """取函数返回类型注解文本（-> 后面的 type 节点）。

    tree-sitter Python 把返回注解解析为 `->` 节点 + `type` 节点。
    参数注解也是 `type` 节点，所以要找 `->` 之后的那个才准确。
    """
    seen_arrow = False
    for child in node.children:
        if child.type == "->":
            seen_arrow = True
            continue
        if seen_arrow and child.type == "type":
            return source[child.start_byte : child.end_byte].decode("utf-8", errors="replace")
    return None


def _build_call(file_path: str, source: bytes, node: Node) -> Call | None:
    """从 call 节点构建 Call。

    call 节点的结构：
    - 直接调用：call → identifier + argument_list
    - 方法调用：call → attribute(identifier + . + identifier) + argument_list
    """
    callee_name: str | None = None
    callee_col: int = 0

    for child in node.children:
        if child.type == "identifier":
            # 直接调用：函数名就是这个 identifier
            callee_name = source[child.start_byte : child.end_byte].decode(
                "utf-8", errors="replace"
            )
            callee_col = child.start_point[1]
            break
        if child.type == "attribute":
            # 方法调用：取 attribute 的最后一个 identifier（方法名）
            last_id = None
            for attr_child in child.children:
                if attr_child.type == "identifier":
                    last_id = attr_child
            if last_id is not None:
                callee_name = source[last_id.start_byte : last_id.end_byte].decode(
                    "utf-8", errors="replace"
                )
                callee_col = last_id.start_point[1]
            break

    if callee_name is None:
        return None

    return Call(
        callee_name=callee_name,
        file_path=file_path,
        line=node.start_point[0] + 1,
        col=callee_col,
    )


def _build_import_statement(file_path: str, source: bytes, node: Node) -> list[Import]:
    """解析 import 语句（import x / import x as y / import a.b.c）。

    tree-sitter 结构：
    - import x：import_statement → dotted_name(identifier)
    - import x as y：import_statement → aliased_import(dotted_name + as + identifier)
    - import a.b.c：import_statement → dotted_name(identifier . identifier . identifier)
    """
    line = node.start_point[0] + 1
    result: list[Import] = []
    for child in node.children:
        if child.type == "dotted_name":
            module = _dotted_name_text(child, source)
            result.append(
                Import(
                    file_path=file_path,
                    module=module,
                    imported_name=module.split(".")[0],
                    alias=None,
                    line=line,
                )
            )
        elif child.type == "aliased_import":
            # import x as y
            module = None
            alias = None
            for sub in child.children:
                if sub.type == "dotted_name":
                    module = _dotted_name_text(sub, source)
                elif sub.type == "identifier":
                    alias = _node_text(sub, source)
            if module is not None:
                result.append(
                    Import(
                        file_path=file_path,
                        module=module,
                        imported_name=module.split(".")[0],
                        alias=alias,
                        line=line,
                    )
                )
    return result


def _build_import_from_statement(file_path: str, source: bytes, node: Node) -> list[Import]:
    """解析 from-import 语句。

    tree-sitter 结构：
    - from x import y：import_from_statement → dotted_name(x) + dotted_name(y)
    - from x import y as z：import_from_statement → dotted_name(x) + aliased_import(...)
    - from .pkg import y：import_from_statement → relative_import + dotted_name(y)
    - from ..q import *：import_from_statement → relative_import + wildcard_import
    """
    line = node.start_point[0] + 1
    module: str | None = None
    level = 0

    # 第一遍：找 module 和 level（from 后的部分）
    for child in node.children:
        if child.type == "dotted_name" and module is None:
            # from x import 的 x（绝对导入）
            module = _dotted_name_text(child, source)
        elif child.type == "relative_import":
            # from .pkg import 的 .pkg
            level, mod = _relative_import_parts(child, source)
            module = mod

    if module is None:
        return []

    # 第二遍：找 imported_name 和 alias（import 后的部分）
    result: list[Import] = []
    for child in node.children:
        if child.type == "dotted_name" and _is_after_import(node, child, source):
            # from x import y 的 y
            imported = _dotted_name_text(child, source)
            result.append(
                Import(
                    file_path=file_path,
                    module=module,
                    imported_name=imported,
                    alias=None,
                    level=level,
                    line=line,
                )
            )
        elif child.type == "aliased_import":
            # from x import y as z
            imported = None
            alias = None
            for sub in child.children:
                if sub.type == "dotted_name":
                    imported = _dotted_name_text(sub, source)
                elif sub.type == "identifier":
                    alias = _node_text(sub, source)
            if imported is not None:
                result.append(
                    Import(
                        file_path=file_path,
                        module=module,
                        imported_name=imported,
                        alias=alias,
                        level=level,
                        line=line,
                    )
                )
        elif child.type == "wildcard_import":
            # from x import *
            result.append(
                Import(
                    file_path=file_path,
                    module=module,
                    imported_name="*",
                    alias=None,
                    level=level,
                    line=line,
                )
            )
    return result


def _is_after_import(node: Node, target: Node, source: bytes) -> bool:
    """判断 target 节点是否在 'import' 关键字之后（用于区分 from-module 和 imported-name）。"""
    seen_import_kw = False
    for child in node.children:
        if child.type == "import":
            seen_import_kw = True
        elif child is target:
            return seen_import_kw
    return False


def _relative_import_parts(node: Node, source: bytes) -> tuple[int, str]:
    """解析 relative_import 节点，返回 (level, module)。

    relative_import → import_prefix(. 或 .. 或 ...) + dotted_name(可选)
    """
    level = 0
    module = ""
    for child in node.children:
        if child.type == "import_prefix":
            # 数点数
            prefix_text = _node_text(child, source)
            level = prefix_text.count(".")
        elif child.type == "dotted_name":
            module = _dotted_name_text(child, source)
    return (level, module)


def _dotted_name_text(node: Node, source: bytes) -> str:
    """取 dotted_name 节点的完整文本（如 a.b.c）。"""
    return _node_text(node, source).replace(" ", "")


def _node_text(node: Node, source: bytes) -> str:
    """取任意节点的原始文本。"""
    return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _child_text(node: Node, source: bytes, child_type: str) -> str | None:
    """取节点某类直接子节点的文本，找不到返回 None。"""
    for child in node.children:
        if child.type == child_type:
            return source[child.start_byte : child.end_byte].decode("utf-8", errors="replace")
    return None


def _collect_syntax_errors(source: bytes, root: Node, errors: list[ParseError]) -> None:
    """收集 tree-sitter 标记的语法错误（ERROR 节点）。

    tree-sitter 是容错解析器：遇到语法错误不崩溃，而是插入 ERROR 或 MISSING 节点继续。
    我们遍历找这些节点，记录行号。
    """
    stack: list[Node] = list(root.children)
    while stack:
        node = stack.pop()
        if node.type == "ERROR" or node.is_error or node.is_missing:
            errors.append(
                ParseError(
                    kind=ParseErrorKind.SYNTAX_ERROR,
                    message=f"语法错误：{_snippet(source, node)}",
                    line=node.start_point[0] + 1,
                )
            )
        for child in node.children:
            stack.append(child)


def _snippet(source: bytes, node: Node, max_len: int = 40) -> str:
    """取节点文本的短摘要（用于错误信息）。"""
    text = source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")
    text = text.replace("\n", "\\n")
    if len(text) > max_len:
        text = text[:max_len] + "..."
    return text
