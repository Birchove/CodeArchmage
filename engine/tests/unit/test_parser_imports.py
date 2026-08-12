"""解析器测试：导入语句（循环 6）。"""

from __future__ import annotations

from pathlib import Path

from code_archmage.parser.models import Import
from code_archmage.parser.parser import parse, parse_source


class TestParseImports:
    """解析导入语句。"""

    def test_simple_import(self) -> None:
        """import os：module=os, imported_name=os, alias=None。"""
        result = parse_source(b"import os\n", "<test>")
        assert result.imports == (
            Import(file_path="<test>", module="os", imported_name="os", alias=None, line=1),
        )

    def test_aliased_import(self) -> None:
        """import sys as system：alias=system。"""
        result = parse_source(b"import sys as system\n", "<test>")
        assert result.imports == (
            Import(file_path="<test>", module="sys", imported_name="sys", alias="system", line=1),
        )

    def test_dotted_import(self) -> None:
        """import a.b.c：module=a.b.c，绑定名是首段 a。"""
        result = parse_source(b"import a.b.c\n", "<test>")
        assert result.imports == (
            Import(file_path="<test>", module="a.b.c", imported_name="a", alias=None, line=1),
        )

    def test_from_import(self) -> None:
        """from typing import Dict。"""
        result = parse_source(b"from typing import Dict\n", "<test>")
        assert result.imports == (
            Import(file_path="<test>", module="typing", imported_name="Dict", alias=None, line=1),
        )

    def test_from_aliased_import(self) -> None:
        """from collections import OrderedDict as OD。"""
        result = parse_source(b"from collections import OrderedDict as OD\n", "<test>")
        assert result.imports == (
            Import(
                file_path="<test>",
                module="collections",
                imported_name="OrderedDict",
                alias="OD",
                line=1,
            ),
        )

    def test_star_import(self) -> None:
        """from utils import *：imported_name 为 '*'。"""
        result = parse_source(b"from utils import *\n", "<test>")
        assert result.imports == (
            Import(file_path="<test>", module="utils", imported_name="*", alias=None, line=1),
        )

    def test_relative_import(self) -> None:
        """from .pkg import helper：level=1。"""
        result = parse_source(b"from .pkg import helper\n", "<test>")
        assert result.imports == (
            Import(
                file_path="<test>",
                module="pkg",
                imported_name="helper",
                alias=None,
                level=1,
                line=1,
            ),
        )

    def test_relative_import_two_levels(self) -> None:
        """from ..core import Service：level=2。"""
        result = parse_source(b"from ..core import Service\n", "<test>")
        assert result.imports == (
            Import(
                file_path="<test>",
                module="core",
                imported_name="Service",
                alias=None,
                level=2,
                line=1,
            ),
        )

    def test_all_imports_from_fixture(self, fixtures_dir: Path) -> None:
        """综合 fixture：所有导入形式都正确解析，按行号排序。"""
        result = parse(fixtures_dir / "imports.py")
        fp = str(fixtures_dir / "imports.py")

        assert result.imports == (
            Import(file_path=fp, module="os", imported_name="os", alias=None, line=1),
            Import(file_path=fp, module="sys", imported_name="sys", alias="system", line=2),
            Import(file_path=fp, module="a.b.c", imported_name="a", alias=None, line=3),
            Import(file_path=fp, module="typing", imported_name="Dict", alias=None, line=4),
            Import(
                file_path=fp, module="collections", imported_name="OrderedDict", alias="OD", line=5
            ),
            Import(file_path=fp, module="utils", imported_name="*", alias=None, line=6),
            Import(file_path=fp, module="pkg", imported_name="helper", alias=None, level=1, line=7),
            Import(
                file_path=fp, module="core", imported_name="Service", alias="Svc", level=2, line=8
            ),
        )
