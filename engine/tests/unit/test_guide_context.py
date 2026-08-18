"""导读上下文组装测试（Stage 7b 循环 3）。

三级导读的 LLM 输入上下文（确定性、可单测）：
- 文件导读：小文件给完整源码；超大文件降级为签名清单
- 模块导读：文件签名 + imports（不含函数体）；超文件数上限截断
- 项目导读：目录结构 + 每文件统计 + 入口启发式标记
"""

from __future__ import annotations

from pathlib import Path

import pytest

from code_archmage.indexer.schema import init_db
from code_archmage.indexer.writer import index_directory
from code_archmage.llm.guide_context import (
    build_file_guide_context,
    build_module_guide_context,
    build_project_guide_context,
)


@pytest.fixture()
def indexed_repo(tmp_path: Path):
    """造一个含 main.py + pkg/ 的小仓库并索引，返回 (conn, repo_root)。"""
    (tmp_path / "main.py").write_bytes(
        b'"""\xe5\x85\xa5\xe5\x8f\xa3\xe6\xa8\xa1\xe5\x9d\x97\xe3\x80\x82"""\n\n'
        b"from pkg.core import run\n\n\n"
        b"def main():\n    run()\n\n\n"
        b'if __name__ == "__main__":\n    main()\n',
    )
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    (pkg / "core.py").write_bytes(
        b"def run():\n    return 1\n\n\ndef helper(x):\n    return x\n",
    )
    (pkg / "util.py").write_bytes(b"def fmt(v):\n    return str(v)\n")

    conn = init_db(":memory:")
    index_directory(conn, tmp_path)
    return conn, tmp_path


class TestFileGuideContext:
    """文件级导读上下文。"""

    def test_small_file_includes_full_source(self, indexed_repo) -> None:
        """小文件 → 含完整源码（带文件头信息）。"""
        conn, repo = indexed_repo
        ctx = build_file_guide_context(conn, repo, "pkg/core.py")

        assert "pkg/core.py" in ctx
        assert "def run():" in ctx  # 完整源码在内
        assert "def helper(x):" in ctx
        conn.close()

    def test_large_file_degrades_to_signatures(self, tmp_path: Path) -> None:
        """超 500 行文件 → 不给完整源码，给签名清单 + 降级说明。"""
        # 造 501 行的文件（每 10 行一个函数）
        body = "\n".join(f"def fn{i}():\n    pass\n" for i in range(51))
        (tmp_path / "big.py").write_bytes(body.encode("utf-8"))
        conn = init_db(":memory:")
        index_directory(conn, tmp_path)

        ctx = build_file_guide_context(conn, repo_root=tmp_path, file_path="big.py")
        conn.close()

        assert "fn0()" in ctx  # 签名清单里有
        assert "fn50()" in ctx
        assert "完整源码" not in ctx  # 不含完整源码段
        assert len(ctx.splitlines()) < 300  # 明显小于 500 行原文

    def test_unknown_file_empty(self, indexed_repo) -> None:
        """不在索引里的文件 → 空字符串。"""
        conn, repo = indexed_repo
        assert build_file_guide_context(conn, repo, "nope.py") == ""
        conn.close()


class TestModuleGuideContext:
    """模块级导读上下文。"""

    def test_lists_signatures_and_imports(self, indexed_repo) -> None:
        """含模块内各文件的符号签名 + 导入关系；不含函数体。"""
        conn, repo = indexed_repo
        ctx = build_module_guide_context(conn, repo, "pkg")

        assert "pkg/core.py" in ctx
        assert "pkg/util.py" in ctx
        assert "run()" in ctx  # 签名
        assert "fmt(" in ctx
        # main.py 不属于 pkg 模块
        assert "main.py" not in ctx
        # 不含函数体行
        assert "    return 1" not in ctx
        conn.close()

    def test_truncates_beyond_file_limit(self, tmp_path: Path) -> None:
        """模块内文件数超上限 → 只取符号数最多的前 N 个 + 截断说明。"""
        mod = tmp_path / "many"
        mod.mkdir()
        for i in range(20):
            (mod / f"m{i}.py").write_bytes(f"def f{i}():\n    pass\n".encode())

        conn = init_db(":memory:")
        index_directory(conn, tmp_path)
        ctx = build_module_guide_context(conn, repo_root=tmp_path, module_path="many")
        conn.close()

        assert "截断" in ctx  # 有截断说明
        # 文件条目数受限（签名行 + 截断说明）
        listed = [ln for ln in ctx.splitlines() if ln.startswith("### ")]
        assert len(listed) <= 15

    def test_unknown_module_empty(self, indexed_repo) -> None:
        """不存在的模块 → 空字符串。"""
        conn, repo = indexed_repo
        assert build_module_guide_context(conn, repo, "ghost") == ""
        conn.close()


class TestProjectGuideContext:
    """项目级导读上下文。"""

    def test_structure_and_entry_marker(self, indexed_repo) -> None:
        """含文件清单 + 统计；入口文件被标记。"""
        conn, repo = indexed_repo
        ctx = build_project_guide_context(conn, repo)

        assert "main.py" in ctx
        assert "pkg/core.py" in ctx
        # main.py 含 __main__ 守卫 → 被标记为入口
        main_line = next(ln for ln in ctx.splitlines() if "main.py" in ln)
        assert "入口" in main_line
        conn.close()

    def test_empty_repo(self, tmp_path: Path) -> None:
        """空仓库 → 空字符串（无文件可讲）。"""
        conn = init_db(":memory:")
        assert build_project_guide_context(conn, repo_root=tmp_path) == ""
        conn.close()
