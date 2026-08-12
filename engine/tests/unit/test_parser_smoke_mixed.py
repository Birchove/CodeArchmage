"""解析器测试：混合冒烟 fixture（回归基线）。

这个测试验证一个包含所有已支持语法特性的综合文件，
确保解析器改动后整体行为稳定。
"""

from __future__ import annotations

from pathlib import Path

from code_archmage.parser.models import SymbolKind
from code_archmage.parser.parser import parse


def test_smoke_mixed_full_result(fixtures_dir: Path) -> None:
    """混合 fixture：全等断言所有符号、调用、导入。"""
    result = parse(fixtures_dir / "smoke_mixed.py")

    # 符号：Config 类 + get_name 方法 + create_config 函数 + load 函数
    assert len(result.symbols) == 4
    assert result.symbols[0].name == "Config"
    assert result.symbols[0].kind == SymbolKind.CLASS
    assert result.symbols[0].bases == ("BaseConfig",)
    assert result.symbols[0].decorators == ("dataclass",)

    assert result.symbols[1].name == "get_name"
    assert result.symbols[1].kind == SymbolKind.FUNCTION

    assert result.symbols[2].name == "create_config"
    assert result.symbols[2].signature == "create_config(path: str) -> Config"

    assert result.symbols[3].name == "load"
    assert result.symbols[3].signature == "load(path: str) -> Dict"

    # 导入：os + typing.Dict
    assert len(result.imports) == 2
    assert result.imports[0].module == "os"
    assert result.imports[1].module == "typing"

    # 调用：load(path) + Config(name=...) + data["name"]（subscript，不是 call）
    # 注意：data["name"] 是 subscript 节点，不是 call，所以不产生 Call
    callee_names = {c.callee_name for c in result.calls}
    assert "load" in callee_names
    assert "Config" in callee_names

    # 无错误
    assert result.errors == ()
