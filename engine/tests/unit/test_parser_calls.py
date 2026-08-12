"""解析器测试：函数调用与方法调用（循环 4 + 5）。"""

from __future__ import annotations

from pathlib import Path

from code_archmage.parser.models import Call
from code_archmage.parser.parser import parse, parse_source


class TestParseCalls:
    """解析函数调用点。"""

    def test_direct_call(self) -> None:
        """直接调用 foo()：产生 Call，callee_name 为 foo。"""
        result = parse_source(b"foo(1, 2)\n", "<test>")
        assert result.calls == (Call(callee_name="foo", file_path="<test>", line=1, col=0),)

    def test_method_call(self) -> None:
        """方法调用 obj.method()：callee_name 为方法名 method。"""
        result = parse_source(b"obj.method()\n", "<test>")
        assert result.calls == (Call(callee_name="method", file_path="<test>", line=1, col=4),)

    def test_nested_calls(self, fixtures_dir: Path) -> None:
        """嵌套调用 a(b(c()))：产生 3 个 Call，按行号排序。"""
        result = parse(fixtures_dir / "nested_calls.py")

        # 第 2 行 foo(1, 2)
        # 第 3 行 bar.baz()
        # 第 4 行 a(b(c()))
        names_with_lines = [(c.callee_name, c.line) for c in result.calls]
        assert ("foo", 2) in names_with_lines
        assert ("baz", 3) in names_with_lines
        # 嵌套调用 a(b(c())) 产生 3 个调用：a, b, c
        assert ("a", 4) in names_with_lines
        assert ("b", 4) in names_with_lines
        assert ("c", 4) in names_with_lines

    def test_chained_method_call(self) -> None:
        """链式调用 a.b.c()：callee_name 取最末段 c。"""
        result = parse_source(b"a.b.c()\n", "<test>")
        assert result.calls == (Call(callee_name="c", file_path="<test>", line=1, col=4),)

    def test_call_inside_function(self) -> None:
        """函数体内的调用：Call 记录调用点位置，不关联 caller（索引器的活）。"""
        result = parse_source(b"def f():\n    foo()\n", "<test>")
        assert len(result.calls) == 1
        assert result.calls[0].callee_name == "foo"
        assert result.calls[0].line == 2
