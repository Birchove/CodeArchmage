"""解析器测试：函数定义。

阶段 1 第一个 TDD 循环。用值相等比较（frozen dataclass 天然支持），
一个 fixture 一个测试，整体构造期望 Symbol 与结果比较。
"""

from __future__ import annotations

from pathlib import Path

from code_archmage.parser.models import Symbol, SymbolKind
from code_archmage.parser.parser import parse, parse_source


class TestParseFunction:
    """解析函数定义。"""

    def test_simple_function(self, fixtures_dir: Path) -> None:
        """简单函数：名/类型/行号/签名/结束行全部正确。"""
        result = parse(fixtures_dir / "simple_function.py")

        assert result.symbols == (
            Symbol(
                name="foo",
                kind=SymbolKind.FUNCTION,
                file_path=str(fixtures_dir / "simple_function.py"),
                line=1,
                col=0,
                end_line=2,
                signature="foo(x, y)",
            ),
        )
        assert result.calls == ()
        assert result.imports == ()
        assert result.errors == ()

    def test_function_with_return_type(self, fixtures_dir: Path) -> None:
        """带返回类型注解的函数：signature 应含 -> int。"""
        result = parse(fixtures_dir / "function_with_return_type.py")

        assert result.symbols == (
            Symbol(
                name="add",
                kind=SymbolKind.FUNCTION,
                file_path=str(fixtures_dir / "function_with_return_type.py"),
                line=1,
                col=0,
                end_line=2,
                signature="add(x: int, y: int) -> int",
            ),
        )

    def test_parse_source_inline(self) -> None:
        """parse_source 支持内联代码，无需落 fixture 文件。"""
        result = parse_source(b"def hello():\n    pass\n", "<test>")

        assert result.symbols == (
            Symbol(
                name="hello",
                kind=SymbolKind.FUNCTION,
                file_path="<test>",
                line=1,
                col=0,
                end_line=2,
                signature="hello()",
            ),
        )

    def test_parse_nonexistent_file_raises(self, tmp_path: Path) -> None:
        """文件不存在应抛 FileNotFoundError（调用方 bug，不静默）。"""
        with __import__("pytest").raises(FileNotFoundError):
            parse(tmp_path / "nonexistent.py")
