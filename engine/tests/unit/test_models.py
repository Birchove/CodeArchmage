"""数据模型测试：验证 frozen 语义等语言层面行为。"""

from __future__ import annotations

import dataclasses

import pytest

from code_archmage.parser.models import Symbol, SymbolKind


class TestSymbolFrozen:
    """Symbol 的 frozen dataclass 语义。"""

    def test_symbol_is_frozen(self) -> None:
        """Symbol 不可修改字段（frozen dataclass）。"""
        sym = Symbol(
            name="foo",
            kind=SymbolKind.FUNCTION,
            file_path="<test>",
            line=1,
            col=0,
            end_line=2,
            signature="foo()",
        )
        with pytest.raises(dataclasses.FrozenInstanceError):
            sym.name = "bar"  # type: ignore[misc]

    def test_symbol_value_equality(self) -> None:
        """值相等的两个 Symbol 应相等。"""
        sym1 = Symbol(
            name="foo",
            kind=SymbolKind.FUNCTION,
            file_path="<test>",
            line=1,
            col=0,
            end_line=2,
            signature="foo()",
        )
        sym2 = Symbol(
            name="foo",
            kind=SymbolKind.FUNCTION,
            file_path="<test>",
            line=1,
            col=0,
            end_line=2,
            signature="foo()",
        )
        assert sym1 == sym2
