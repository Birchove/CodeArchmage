"""索引库 Schema 定义与初始化。

DDL 按可读性拆成多段常量。init_db 用 IF NOT EXISTS 保证幂等。
WAL 模式对 :memory: 数据库无效（SQLite 会忽略），对文件库生效。

设计依据：plans/stages/stage2_indexer.md + ADR-002。
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

# ============================================================
# DDL：表结构
# ============================================================

_TABLE_META = """\
CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
)
"""

_TABLE_FILES = """\
CREATE TABLE IF NOT EXISTS files (
    path        TEXT PRIMARY KEY,
    hash        TEXT NOT NULL,
    indexed_at  TEXT NOT NULL
)
"""

_TABLE_SYMBOLS = """\
CREATE TABLE IF NOT EXISTS symbols (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    line        INTEGER NOT NULL,
    col         INTEGER NOT NULL,
    end_line    INTEGER NOT NULL,
    signature   TEXT NOT NULL,
    bases       TEXT NOT NULL,
    decorators  TEXT NOT NULL,
    FOREIGN KEY (file_path) REFERENCES files(path)
)
"""

_TABLE_CALLS = """\
CREATE TABLE IF NOT EXISTS calls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_id   INTEGER,
    callee_name TEXT NOT NULL,
    callee_id   INTEGER,
    file_path   TEXT NOT NULL,
    line        INTEGER NOT NULL,
    col         INTEGER NOT NULL,
    FOREIGN KEY (caller_id) REFERENCES symbols(id),
    FOREIGN KEY (callee_id) REFERENCES symbols(id),
    FOREIGN KEY (file_path) REFERENCES files(path)
)
"""

_TABLE_IMPORTS = """\
CREATE TABLE IF NOT EXISTS imports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path     TEXT NOT NULL,
    module        TEXT NOT NULL,
    imported_name TEXT NOT NULL,
    alias         TEXT,
    level         INTEGER NOT NULL DEFAULT 0,
    line          INTEGER NOT NULL,
    FOREIGN KEY (file_path) REFERENCES files(path)
)
"""

_TABLE_SUMMARIES = """\
CREATE TABLE IF NOT EXISTS summaries (
    symbol_id    INTEGER PRIMARY KEY,
    summary_text TEXT NOT NULL,
    model        TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (symbol_id) REFERENCES symbols(id)
)
"""

# Stage 7b：导读缓存（项目/模块/文件三级，按 scope+path 唯一）
_TABLE_GUIDES = """\
CREATE TABLE IF NOT EXISTS guides (
    scope        TEXT NOT NULL,
    path         TEXT NOT NULL,
    content_md   TEXT NOT NULL,
    model        TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    input_hash   TEXT NOT NULL,
    PRIMARY KEY (scope, path)
)
"""

# ============================================================
# DDL：索引
# ============================================================

_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)",
    "CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path)",
    "CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id)",
    "CREATE INDEX IF NOT EXISTS idx_calls_callee_name ON calls(callee_name)",
    "CREATE INDEX IF NOT EXISTS idx_calls_callee_id ON calls(callee_id)",
    "CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(file_path)",
    "CREATE INDEX IF NOT EXISTS idx_imports_name ON imports(imported_name)",
]

# ============================================================
# DDL：FTS5 全文索引（external-content 模式）
# ============================================================

_TABLE_FTS = """\
CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
    name,
    file_path,
    content='symbols',
    content_rowid='id'
)
"""

_TRIGGER_FTS_INSERT = """\
CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
    INSERT INTO symbols_fts(rowid, name, file_path)
    VALUES (new.id, new.name, new.file_path);
END
"""

_TRIGGER_FTS_DELETE = """\
CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
    INSERT INTO symbols_fts(symbols_fts, rowid, name, file_path)
    VALUES ('delete', old.id, old.name, old.file_path);
END
"""

_TRIGGER_FTS_UPDATE = """\
CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
    INSERT INTO symbols_fts(symbols_fts, rowid, name, file_path)
    VALUES ('delete', old.id, old.name, old.file_path);
    INSERT INTO symbols_fts(rowid, name, file_path)
    VALUES (new.id, new.name, new.file_path);
END
"""

# ============================================================
# 所有 DDL 按执行顺序排列
# ============================================================

_ALL_DDL: list[str] = [
    # 表（先建被引用的）
    _TABLE_META,
    _TABLE_FILES,
    _TABLE_SYMBOLS,
    _TABLE_CALLS,
    _TABLE_IMPORTS,
    _TABLE_SUMMARIES,
    _TABLE_GUIDES,
    # FTS 虚拟表（依赖 symbols）
    _TABLE_FTS,
    # FTS 触发器（依赖 symbols + symbols_fts）
    _TRIGGER_FTS_INSERT,
    _TRIGGER_FTS_DELETE,
    _TRIGGER_FTS_UPDATE,
    # 索引（最后建，不阻塞表创建）
    *_INDEXES,
]

# 当前 Schema 版本（未来迁移依据）
# 2：Stage 7b 新增 guides 表
SCHEMA_VERSION = "2"


def init_db(
    db_path: str | Path = ":memory:",
    conn: sqlite3.Connection | None = None,
) -> sqlite3.Connection:
    """初始化索引数据库，返回可用的连接。

    幂等：所有 DDL 用 IF NOT EXISTS，可重复调用。
    WAL 模式对 :memory: 无效（SQLite 忽略），对文件库生效。

    Args:
        db_path: 数据库路径，默认 :memory:（测试用）
        conn: 已有连接（幂等再初始化时传入），不传则新建

    Returns:
        初始化完成的 sqlite3.Connection（调用方负责关闭）
    """
    if conn is None:
        conn = sqlite3.connect(str(db_path))

    # WAL 模式（:memory: 下 SQLite 会忽略，返回 "memory"）
    conn.execute("PRAGMA journal_mode=WAL")

    # 执行所有 DDL
    conn.executescript(";".join(_ALL_DDL))

    # 写入 schema 版本（Stage 7b：v1→v2 升级覆盖旧版本值）
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
        (SCHEMA_VERSION,),
    )
    conn.commit()

    return conn
