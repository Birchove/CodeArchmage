"""SQLite 索引模块（阶段 2 实现）。

把解析器输出的符号/调用/导入持久化到 SQLite，支持高效查询。
设计依据：plans/stages/stage2_indexer.md + ADR-002。
"""

from .queries import Reference, find_callees, find_callers, find_definition, find_references
from .resolver import assign_callers, resolve_callees
from .schema import SCHEMA_VERSION, init_db
from .search import search_fts
from .writer import index_directory, index_file

__all__ = [
    "SCHEMA_VERSION",
    "Reference",
    "assign_callers",
    "find_callees",
    "find_callers",
    "find_definition",
    "find_references",
    "index_directory",
    "index_file",
    "init_db",
    "resolve_callees",
    "search_fts",
]
