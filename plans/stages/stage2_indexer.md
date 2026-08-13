# 阶段 2：索引器执行方案（v2，已综合 cc 审核意见）

> 把解析器输出的符号/调用/导入持久化到 SQLite，支持高效查询。
> 前置 ADR：[ADR-002](../decisions/ADR-002-sqlite-access-strategy.md)（SQLite 访问策略）
> 本版已采纳 cc 审核的全部严重项（S1-S4）和建议项（B1-B6、O1-O3）。

---

## 一、模块结构

```
engine/src/code_archmage/indexer/
├── __init__.py      # 公共导出
├── schema.py        # DDL 常量 + init_db()
├── writer.py        # index_file() / index_directory() / 增量索引（先删后写）
├── resolver.py      # caller-callee 推断（最内层规则）+ callee 名称保守匹配
├── queries.py       # 查询接口（纯函数）
└── search.py        # FTS5 全文搜索
```

**设计原则**：
- `schema.py` / `writer.py` / `queries.py` 都是**纯同步**函数（ADR-002）
- **一个工作单元一个连接**（per-file / per-request），打开即用、用完即关（ADR-002 修订）
- 查询函数输入 `(conn, 参数)` → 输出 dataclass，用 `:memory:` 测试，无副作用
- 解析器输出（`ParseResult`）是索引器的唯一输入源

---

## 二、Schema 设计（DDL）

### 路径规范化约定（B5）

**所有 `file_path` 统一为：相对仓库根、POSIX 分隔符（`/`）、无 `./` 前缀。**
- 例：`src/main.py`、`tests/test_foo.py`
- 不用绝对路径（不可移植）、不用 `./` 前缀（与裸路径不一致会破坏主键）
- 循环 6 的红测试必须断言这一点

### DDL

```sql
-- ============================================================
-- meta：schema 版本与元信息（O1）
-- ============================================================
CREATE TABLE meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
-- init_db() 时写入 ('schema_version', '1')

-- ============================================================
-- files：文件记录（增量索引依据）
-- ============================================================
CREATE TABLE files (
    path        TEXT PRIMARY KEY,     -- 相对仓库根、POSIX 分隔符
    hash        TEXT NOT NULL,        -- 文件内容 SHA-256（O2：明确是内容 hash）
    indexed_at  TEXT NOT NULL         -- ISO8601 时间戳
);

-- ============================================================
-- symbols：符号定义
-- ============================================================
CREATE TABLE symbols (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL,          -- function | class | variable
    file_path   TEXT NOT NULL,
    line        INTEGER NOT NULL,       -- 1-based
    col         INTEGER NOT NULL,       -- 0-based
    end_line    INTEGER NOT NULL,
    signature   TEXT NOT NULL,
    bases       TEXT NOT NULL,          -- JSON 数组，如 ["Base", "Mixin"]
    decorators  TEXT NOT NULL,          -- JSON 数组，如 ["dataclass"]
    FOREIGN KEY (file_path) REFERENCES files(path)
);

CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_file ON symbols(file_path);

-- ============================================================
-- calls：调用边
-- ============================================================
CREATE TABLE calls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_id   INTEGER,                -- 调用者符号 id（最内层 function/method；NULL=模块级调用）
    callee_name TEXT NOT NULL,          -- 被调用名（解析阶段只知名）
    callee_id   INTEGER,                -- 仅全库唯一同名定义时填充；多候选/未解析=NULL
    file_path   TEXT NOT NULL,
    line        INTEGER NOT NULL,
    col         INTEGER NOT NULL,
    FOREIGN KEY (caller_id) REFERENCES symbols(id),
    FOREIGN KEY (callee_id) REFERENCES symbols(id),
    FOREIGN KEY (file_path) REFERENCES files(path)
);

CREATE INDEX idx_calls_caller      ON calls(caller_id);
CREATE INDEX idx_calls_callee_name ON calls(callee_name);
CREATE INDEX idx_calls_callee_id   ON calls(callee_id);

-- ============================================================
-- imports：导入语句
-- ============================================================
CREATE TABLE imports (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path     TEXT NOT NULL,
    module        TEXT NOT NULL,
    imported_name TEXT NOT NULL,
    alias         TEXT,                 -- NULL=无别名
    level         INTEGER NOT NULL DEFAULT 0,
    line          INTEGER NOT NULL,
    FOREIGN KEY (file_path) REFERENCES files(path)
);

CREATE INDEX idx_imports_file ON imports(file_path);
CREATE INDEX idx_imports_name ON imports(imported_name);

-- ============================================================
-- summaries：惰性摘要缓存（MVP 建表，阶段 5 填充）
-- ============================================================
CREATE TABLE summaries (
    symbol_id    INTEGER PRIMARY KEY,
    summary_text TEXT NOT NULL,
    model        TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (symbol_id) REFERENCES symbols(id)
);
-- 注：symbols 删除时 summaries 无级联清理（SQLite FK 默认不强制）。
-- MVP 阶段不生成摘要，影响有限；阶段 5 加 annotations 时一并处理迁移策略（O4）。

-- ============================================================
-- symbols_fts：FTS5 全文索引（符号名 + 文件路径）
-- 采用 external-content（外部内容表）模式，避免符号名重复存储（B1）
-- ============================================================
CREATE VIRTUAL TABLE symbols_fts USING fts5(
    name,
    file_path,
    content='symbols',
    content_rowid='id'
);

-- 触发器：symbols 增删改时同步 fts（保证一致性）
CREATE TRIGGER symbols_ai AFTER INSERT ON symbols BEGIN
    INSERT INTO symbols_fts(rowid, name, file_path) VALUES (new.id, new.name, new.file_path);
END;
CREATE TRIGGER symbols_ad AFTER DELETE ON symbols BEGIN
    INSERT INTO symbols_fts(symbols_fts, rowid, name, file_path) VALUES('delete', old.id, old.name, old.file_path);
END;
CREATE TRIGGER symbols_au AFTER UPDATE ON symbols BEGIN
    INSERT INTO symbols_fts(symbols_fts, rowid, name, file_path) VALUES('delete', old.id, old.name, old.file_path);
    INSERT INTO symbols_fts(rowid, name, file_path) VALUES (new.id, new.name, new.file_path);
END;
```

### Schema 设计要点

- **`meta` 表（O1）**：存 `schema_version`，阶段 5 加表时支持迁移而非重建库
- **`bases` / `decorators` 存 JSON 字符串**：SQLite 无原生数组类型，读取时 `json.loads`。不拆子表——MVP 不需要按基类/装饰器查询，JSON 足够
- **`calls.caller_id` 可空**：模块级调用（不在任何函数体内）记 NULL
- **`calls.callee_id` 语义（S3 修订）**：**仅在全库唯一同名定义时填充**；多候选（同名定义 >1）一律留 NULL，候选列表由 `find_callees` 查询时按 `callee_name` JOIN 实时计算返回。语义干净：`callee_id ≠ NULL` = 确定解析，`callee_id = NULL 且 name 有定义` = 多候选待用户选
- **FTS5 external-content 模式（B1 修订）**：注意术语是 "external-content"（`content='表名'`），不是 "contentless"（`content=''`）。外部内容表省存储，由触发器保证一致性；数据一致性也由"事务内先删后写"天然兜底。支持 `INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild')` 重建（纳入循环 8 测试，也是未来 schema 迁移的兜底手段）
- **`summaries` 表**：MVP 阶段只建结构，阶段 5（LLM 惰性摘要）才写入

---

## 三、阶段 2 专用 Fixtures（S4 修订）

阶段 1 的 fixtures 为解析场景设计，阶段 2 需要新增**跨文件关系**和**嵌套结构**场景。新增以下 fixtures（符合 dev_workflow.md "fixtures 是自己写的活文档"原则）：

```
engine/tests/fixtures/python/
├── （阶段 1 已有 8 个，保留复用）
├── nested_function.py       # 嵌套函数（S2：测 caller 最内层规则）
├── cross_file_a.py          # 调用 cross_file_b 的定义（跨文件 callee 解析）
├── cross_file_b.py          # 定义被 cross_file_a 调用的函数
└── name_collision.py        # 同名函数跨文件定义（多候选核心场景）
```

**fixture 设计要点**：
- `nested_function.py`：`def outer(): def inner(): foo()`——验证 caller 取最内层 inner 而非 outer
- `cross_file_a.py` / `cross_file_b.py`：a.py 调用 b.py 的 `bar()`，验证跨文件 callee_id 正确填充
- `name_collision.py`：两个文件各定义一个 `setup()`，验证多候选时 callee_id=NULL、`find_callees` 返回多个候选

---

## 四、TDD 循环清单（9 个循环）

> cc 建议（B3）将原循环 7 拆为两个，故从 8 个调整为 9 个。
> 每个循环 = 一个红绿重构 = 一个 commit。

### 循环 1：Schema 初始化
- 🔴 红：`init_db(":memory:")` 返回的 conn，查 `sqlite_master` 断言所有表（含 `meta`）、索引、FTS 触发器存在；查 `meta` 表断言 `schema_version='1'`
- 🟢 绿：实现 `schema.py` 的 DDL 常量 + `init_db()`
- 🔵 重构：DDL 拆成可读的多段常量
- **验收**：7 张表（含 meta）+ 3 个 FTS 触发器 + 7 个索引 + schema_version 全部存在

### 循环 2：索引单个文件（symbols + files 写入）
- 🔴 红：索引 `simple_function.py`（相对路径 `simple_function.py`）→ 查 `symbols` 表断言 1 行，字段全对（name/kind/line/col/end_line/signature/bases JSON/decorators JSON）；查 `files` 表断言 path + hash + indexed_at 存在
- 🟢 绿：实现 `writer.index_file(conn, repo_root, parse_result)`，先只写 symbols + files
- 🔵 重构：抽取 `_insert_symbol()` 私有函数；路径规范化为相对仓库根 POSIX 形式
- **验收**：函数名、kind、行号、signature、bases/decorators（JSON）正确写入；file_path 是相对仓库根的 POSIX 路径

### 循环 3：索引单个文件（calls + imports 写入）
- 🔴 红：索引 `nested_calls.py` → 查 `calls` 表断言 **5 行**（阶段 1 测试 `test_parser_calls.py:25` 已证明该 fixture 产生 5 个调用：foo、baz、a、b、c）；索引 `imports.py` → 查 `imports` 表断言行数和字段（module/imported_name/alias/level）
- 🟢 绿：扩展 `index_file()` 写入 calls + imports（此时 caller_id / callee_id 暂留 NULL）
- 🔵 重构：单文件写入用单个事务包裹（原子性）
- **验收**：calls / imports 表内容正确，单文件写入是原子的

### 循环 4：caller 推断——最内层规则（S2 修订）
- 🔴 红：
  - 索引 `nested_function.py`（`def outer(): def inner(): foo()`）→ 断言 `foo()` 调用的 `caller_id` = inner 的 id（**最内层**，不是 outer）
  - 索引 `class_with_methods.py` → 断言方法体内的调用 `caller_id` = 方法 id（**不是类 id**——类符号虽有 line/end_line 但不作为 caller）
  - 模块级调用（不在任何函数体内）→ `caller_id = NULL`
- 🟢 绿：实现 `resolver.assign_callers(conn)`：遍历 calls，按 `(file_path, line)` 找行范围包含它的 **function/method** 符号（跳过 class），取 `end_line - line` 最小（即最内层）者
- 🔵 重构：行范围查找用 SQL 窗口或内存索引加速
- **验收**：嵌套函数取最内层；方法调用 caller 是方法不是类；模块级调用 caller_id=NULL

### 循环 5：callee 名称保守匹配——唯一才填充（S3 修订）
- 🔴 红：
  - 索引 `cross_file_a.py` + `cross_file_b.py`（a 调 b 的 `bar()`，全库唯一 `bar` 定义）→ 断言 `calls.callee_id` 被填充为 b.py 中 `bar` 的 symbol id
  - 索引 `name_collision.py`（两个文件各定义 `setup()`）→ 断言调用 `setup()` 的 `callee_id = NULL`（多候选不填充）
  - 索引含 `print()` 调用的文件 → 断言 `callee_id = NULL`（无定义）
- 🟢 绿：实现 `resolver.resolve_callees(conn)`：按 `callee_name` 查 `symbols.name`，**仅当全库唯一同名定义时**填充 callee_id；多个或零个则留 NULL
- 🔵 重构：明确"保守匹配"语义——不追求精确，多候选交给查询层实时 JOIN
- **验收**：全库唯一同名 → 填 callee_id；多候选/无定义 → NULL

### 循环 6：索引整个目录 + 增量索引 + 先删后写（S1 修订）
- 🔴 红（5 条）：
  1. 索引 `fixtures/python/` 整个目录 → 断言 `files` 表行数 = .py 文件数
  2. **二次索引（无改动）→ 断言各表行数不变**（幂等性，B6）
  3. **修改一个文件后二次索引 → 断言旧符号消失、新符号出现**（先删后写）
  4. **删除一个文件后二次索引 → 断言该文件的 symbols/calls/imports 全部消失**（孤儿清理）
  5. **路径规范化**：断言 `files.path` 全是相对仓库根的 POSIX 路径（无 `./`、无绝对路径）
- 🟢 绿：实现 `writer.index_directory(conn, repo_root)`：
  - 遍历 .py（跳过 `__pycache__`/venv/`.venv`）
  - 按 hash 增量：hash 相同跳过
  - hash 变化或新文件：**事务内先按 `file_path` DELETE 旧 symbols/calls/imports（FTS 由触发器自动同步），再插入新数据**
  - 磁盘上已删除的文件：从 files/symbols/calls/imports 清除
- 🔵 重构：抽取 `_iter_python_files()` + `_file_hash()` + `_delete_file_data(conn, file_path)`
- **验收**：全量索引正确；增量索引幂等；修改文件先删后写；删除文件清理孤儿；路径规范化

### 循环 6b：venv 过滤 + ParseError 处理（B2、O3）
- 🔴 红：
  1. 在临时目录造 `.venv/site.py` → 索引后断言它**不入库**（O3）
  2. 索引含语法错误的 fixture（如 `smoke_mixed.py` 若有错误，或造一个 `syntax_error.py`）→ 断言**不崩溃**，部分结果（能解析的符号）照常写入，`files` 表照常记录（B2）
- 🟢 绿：扩展 `index_directory` 的过滤逻辑；`index_file` 对含 ParseError 的 ParseResult 照常索引已解析出的 symbols/calls/imports
- 🔵 重构：明确 ParseError 处理策略——**照常索引部分结果 + 写 files 表**（用户修复后下次增量会重新解析）
- **验收**：venv 被跳过；含 ParseError 的文件不崩溃、部分索引

### 循环 7：查询接口——定义 + 引用（B3 拆分）
- 🔴 红：
  - `find_definition(conn, "foo")` → 返回 Symbol（或多个候选）
  - `find_definition(conn, "不存在的名")` → 返回空
  - `find_references(conn, symbol_id)` → 返回引用点列表（**明确范围：调用点 `calls.callee_id=symbol_id` + 导入点 `imports.imported_name=symbol.name`**；变量读取等其他引用二期）
- 🟢 绿：实现 `queries.py` 的 `find_definition` + `find_references`
- 🔵 重构：公共的 row → dataclass 映射函数
- **验收**：定义查找和引用查找（调用+导入）正确

### 循环 8：查询接口——调用者 + 被调用者（B3 拆分）
- 🔴 红：
  - `find_callers(conn, name)` → 返回调用者符号列表
  - `find_callees(conn, symbol_id)` → 返回被调用者列表（**含多候选**：callee_id 有值直接返回；callee_id=NULL 但 callee_name 有定义，JOIN 返回多个候选）
- 🟢 绿：实现 `queries.py` 的 `find_callers` + `find_callees`
- 🔵 重构：`find_callees` 的多候选逻辑用 LEFT JOIN 统一处理
- **验收**：调用者查找正确；被调用者查找含多候选场景

### 循环 9：FTS5 全文搜索（B1 修订）
- 🔴 红：
  - `search_fts(conn, "foo")` → 返回包含 "foo" 的符号
  - `search_fts(conn, "MyClass")` → 返回类
  - `search_fts(conn, "zzz不存在")` → 返回空
  - `INSERT INTO symbols_fts(symbols_fts) VALUES('rebuild')` → 重建后搜索结果不变（B1：验证重建命令）
- 🟢 绿：实现 `search.py`，用 FTS5 MATCH 查询
- 🔵 重构：处理 FTS5 特殊字符转义（避免查询注入）
- **验收**：符号名搜索可用；特殊字符不崩溃；rebuild 命令可用

---

## 五、测试策略

- **单元测试**：每个循环的红测试，用 `sqlite3.connect(":memory:")` 跑，无副作用、快
- **集成测试**：`tests/integration/test_indexer_directory.py`——索引整个 `fixtures/python/` 目录（含新增的 4 个阶段 2 专用 fixture），跑全套查询，断言跨文件关系正确
- **fixtures**：复用阶段 1 的 8 个 + 新增 4 个阶段 2 专用（见第三节）
- **覆盖率目标**：`indexer/` 模块 ≥ 80%（dev_workflow.md 强制门禁）

---

## 六、验收标准（阶段 2 完成定义）

1. ✅ 9 个 TDD 循环全部通过（红绿重构完整）
2. ✅ `indexer/` 模块测试覆盖率 ≥ 80%
3. ✅ ruff check + ruff format + mypy strict 全绿
4. ✅ 集成测试：索引 `fixtures/python/` 全目录（含新增 fixture），所有查询接口返回正确结果
5. ✅ **跨文件 callee 解析正确**（B6）：`cross_file_a.py` 调 `cross_file_b.py` 的函数，callee_id 正确填充
6. ✅ **增量索引幂等**（B6）：连续两次全量索引后各表行数不变
7. ✅ **先删后写**（S1）：修改文件后旧符号消失；删除文件后孤儿数据清理
8. ✅ **caller 最内层规则**（S2）：嵌套函数取最内层；方法调用 caller 是方法不是类
9. ✅ **多候选保守匹配**（S3）：同名多定义时 callee_id=NULL，`find_callees` 返回多个候选
10. ✅ **含 ParseError 文件不崩溃**（B2/B6）：部分索引，files 表照常记录
11. ✅ **路径规范化**（B5）：file_path 全是相对仓库根的 POSIX 路径
12. ✅ FTS5 搜索：符号名搜索可用，特殊字符不崩溃，rebuild 命令可用
13. ✅ cc 审核通过（无严重项）

---

## 七、不做（明确排除，避免范围蔓延）

- ❌ 异步包装（留到阶段 3 服务层）
- ❌ 路径沙箱 / 安全校验（留到阶段 3 服务层）
- ❌ LLM 摘要生成（`summaries` 表只建结构，阶段 5 填充）
- ❌ 跨语言符号解析（MVP 仅 Python）
- ❌ 精确类型推断（按"名称保守匹配"做，不追求完美）
- ❌ 变量读取引用（`find_references` 仅含调用点 + 导入点，变量读取二期）
- ❌ 文件重命名的专门处理（按"删旧 + 增新"处理，不做 rename 检测）

---

> 下一步：用户拍板本方案 → 进入循环 1（Schema 初始化）。
