"""解析器测试：编码边界与错误处理（循环 8）。

cc 建议：先试 PEP 263（coding 声明 + BOM 检测），解得开就正常解析，
解不开才记错误。BOM 要在喂给 tree-sitter 前剥掉。
"""

from __future__ import annotations

from pathlib import Path

from code_archmage.parser.models import ParseErrorKind
from code_archmage.parser.parser import parse, parse_source


class TestEncodingBoundary:
    """编码边界：GBK / BOM / 解码失败。"""

    def test_utf8_bom_stripped(self, tmp_path: Path) -> None:
        """带 UTF-8 BOM 的文件：BOM 剥掉后正常解析。"""
        file = tmp_path / "bom.py"
        # 写入 UTF-8 BOM + 正常 Python 代码
        file.write_bytes(b"\xef\xbb\xbfdef foo():\n    pass\n")

        result = parse(file)
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "foo"
        assert result.errors == ()

    def test_gbk_with_coding_declaration(self, tmp_path: Path) -> None:
        """带 coding 声明的 GBK 文件：按声明解码后正常解析。"""
        file = tmp_path / "gbk.py"
        # GBK 编码，含中文注释和 coding 声明
        content = "# -*- coding: gbk -*-\ndef foo():\n    # 中文注释\n    pass\n"
        file.write_bytes(content.encode("gbk"))

        result = parse(file)
        assert len(result.symbols) == 1
        assert result.symbols[0].name == "foo"
        assert result.errors == ()

    def test_undecodable_file_records_error(self, tmp_path: Path) -> None:
        """无法解码的文件（无 coding 声明的纯 GBK）：记录 ENCODING_ERROR，不崩溃。"""
        file = tmp_path / "bad.py"
        # 纯 GBK 字节，无 coding 声明，UTF-8 解码会失败
        file.write_bytes("x = '中文'".encode("gbk"))

        result = parse(file)
        # 不崩溃，返回空结果 + 编码错误
        assert result.symbols == ()
        assert len(result.errors) >= 1
        assert result.errors[0].kind == ParseErrorKind.ENCODING_ERROR


class TestSyntaxError:
    """语法错误：tree-sitter 容错解析，记录错误但不崩溃。"""

    def test_syntax_error_recorded(self) -> None:
        """语法错误：记录 SYNTAX_ERROR，但仍返回部分结果。"""
        # def 后面缺函数名
        result = parse_source(b"def ():\n    pass\n", "<test>")
        assert len(result.errors) >= 1
        assert result.errors[0].kind == ParseErrorKind.SYNTAX_ERROR

    def test_valid_code_has_no_errors(self) -> None:
        """正常代码：errors 为空。"""
        result = parse_source(b"def foo():\n    pass\n", "<test>")
        assert result.errors == ()

    def test_partial_result_on_syntax_error(self) -> None:
        """语法错误后仍有部分结果：错误前后的有效定义仍被提取。"""
        # 第一个函数有效，第二个有语法错误
        source = b"def good():\n    pass\n\ndef :\n    pass\n"
        result = parse_source(source, "<test>")
        # good 函数应该被提取
        good = [s for s in result.symbols if s.name == "good"]
        assert len(good) == 1
        # 同时有语法错误记录
        assert any(e.kind == ParseErrorKind.SYNTAX_ERROR for e in result.errors)
