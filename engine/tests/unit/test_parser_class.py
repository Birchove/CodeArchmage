"""解析器测试：类定义与装饰器（循环 2 + 7）。"""

from __future__ import annotations

from pathlib import Path

from code_archmage.parser.models import Symbol, SymbolKind
from code_archmage.parser.parser import parse, parse_source


class TestParseClass:
    """解析类定义。"""

    def test_class_with_base_and_methods(self, fixtures_dir: Path) -> None:
        """类：名/基类/方法都正确；方法作为独立 function 符号存在。"""
        result = parse(fixtures_dir / "class_with_methods.py")
        fp = str(fixtures_dir / "class_with_methods.py")

        # 类本身 + 两个方法（方法不嵌套在类符号内，而是扁平的独立符号）
        assert result.symbols == (
            Symbol(
                name="Dog",
                kind=SymbolKind.CLASS,
                file_path=fp,
                line=1,
                col=0,
                end_line=6,
                signature="Dog(Animal)",
                bases=("Animal",),
            ),
            Symbol(
                name="bark",
                kind=SymbolKind.FUNCTION,
                file_path=fp,
                line=2,
                col=4,
                end_line=3,
                signature="bark(self)",
            ),
            Symbol(
                name="sit",
                kind=SymbolKind.FUNCTION,
                file_path=fp,
                line=5,
                col=4,
                end_line=6,
                signature="sit(self, duration: int) -> bool",
            ),
        )

    def test_class_without_base(self) -> None:
        """无基类的类：bases 为空，signature 不含括号。"""
        result = parse_source(b"class Empty:\n    pass\n", "<test>")
        cls = result.symbols[0]
        assert cls.name == "Empty"
        assert cls.bases == ()
        assert cls.signature == "Empty"


class TestParseDecorator:
    """解析装饰器。"""

    def test_decorated_class(self, fixtures_dir: Path) -> None:
        """带装饰器的类：decorators 字段记录装饰器名。"""
        result = parse(fixtures_dir / "decorators.py")

        cls = next(s for s in result.symbols if s.name == "Point")
        assert cls.kind == SymbolKind.CLASS
        assert cls.decorators == ("dataclass",)

    def test_decorated_function(self, fixtures_dir: Path) -> None:
        """带装饰器的函数：decorators 字段记录装饰器名。"""
        result = parse(fixtures_dir / "decorators.py")

        func = next(s for s in result.symbols if s.name == "area")
        assert func.kind == SymbolKind.FUNCTION
        assert func.decorators == ("property",)

    def test_multiple_decorators(self) -> None:
        """多个装饰器：按从上到下顺序记录。"""
        source = b"@a\n@b\ndef f():\n    pass\n"
        result = parse_source(source, "<test>")
        func = result.symbols[0]
        assert func.decorators == ("a", "b")

    def test_decorated_class_full_equality(self, fixtures_dir: Path) -> None:
        """装饰器类全等断言：确保符号不重复（A1 回归测试）。"""
        result = parse(fixtures_dir / "decorators.py")
        fp = str(fixtures_dir / "decorators.py")

        # 关键：恰好 2 个符号（Point 类 + area 函数），不能重复
        assert len(result.symbols) == 2
        assert result.symbols == (
            Symbol(
                name="Point",
                kind=SymbolKind.CLASS,
                file_path=fp,
                line=2,
                col=0,
                end_line=4,
                signature="Point",
                decorators=("dataclass",),
            ),
            Symbol(
                name="area",
                kind=SymbolKind.FUNCTION,
                file_path=fp,
                line=8,
                col=0,
                end_line=9,
                signature="area(self)",
                decorators=("property",),
            ),
        )
