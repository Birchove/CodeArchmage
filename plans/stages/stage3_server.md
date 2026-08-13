# 阶段 3：服务层执行方案（FastAPI）

> 把索引器能力通过 HTTP 暴露给前端，同时守住隐私产品的安全底线。
> 前置：阶段 1（解析器）+ 阶段 2（索引器）已完成。
> 依据：`plans/dev_workflow.md` 阶段 3 + `plans/plan.md` MVP 闭环。
> 修订：v2 — 吸收 cc 审核反馈（S-1 索引侧 symlink 泄漏 + B-1~B-8 + O-1~O-4）。

---

## 一、阶段目标与范围

### 做（阶段 3）

- FastAPI 应用工厂（`create_app`）+ 四条安全硬规则（TDD 红测试固化）
- 只读查询 API：文件树、文件内容 + 符号大纲、符号详情、定义跳转、引用、调用者、被调用者、全文搜索
- 索引触发（同步 + 并发互斥）+ 索引库状态查询
- OpenAPI 契约（FastAPI 自动生成，前后端共享）+ 契约回归测试
- CORS 中间件（仅开发模式，允许 Vite dev server 端口）

### 不做（推迟到阶段 5）

- LLM 网关（`POST /api/llm/chat`）——涉及外部 API key、流式响应、多供应商适配，单独做更聚焦
- 惰性摘要（`POST /api/summaries`）——依赖 LLM 网关，阶段 5 一起做
- **理由**：MVP 最小闭环是"索引→文件树→折叠阅读→跳转→局部调用图"，前五步都不需要 LLM。阶段 3 先把"安全 + 查询 API 契约"打牢，阶段 4（前端垂直切片）就能串起最小闭环。

---

## 二、安全硬规则（四条，TDD 红测试固化）

产品以"隐私优先"为核心卖点（实习代码不能上传），但学生典型环境是宿舍/教室局域网。服务误绑 `0.0.0.0`，同网段任何人都能读到代码——这是最讽刺的翻车方式。

| # | 规则 | 实现位置 | 红测试 |
|---|------|----------|--------|
| 1 | **只绑定 `127.0.0.1`** | `run_server()` 默认 `host="127.0.0.1"`，传 `0.0.0.0` 强制改回 | 真实 socket 测试：uvicorn 起在 ephemeral 端口，`connect(("127.0.0.1", port))` 成功 |
| 2 | **路径沙箱（读）** | `security.resolve_path(repo_root, rel_path)`：root 和 target **都 resolve** 后比较 | `GET /api/files/../../etc/passwd` → 4xx；`%2e%2e%2f` 编码穿越 → 4xx；正常相对路径 → 200 |
| 3 | **拒绝符号链接逃逸（读）** | `resolve_path` 检测 `islink` 且 resolve 后目标在仓库根外 → 拒绝 | 仓库内 symlink 指向 `/tmp` → `PathEscapeError`；指向仓库内文件 → 通过 |
| 4 | **拒绝符号链接逃逸（索引）** | `writer._iter_python_files` 过滤 `is_symlink()` 条目（MVP 一律不跟随 symlink） | 仓库内 symlink `.py` 指向外部 → 索引后 `files` 表不含该路径 |

> **cc S-1 修复**：原方案规则 3 只防了"读路径"，没防"索引路径"。实测 `rglob("*.py")` 会收集 symlink `.py` 文件，把仓库外代码的符号/签名/导入吸进索引库——对隐私产品是实质泄漏。规则 4 把防线前移到索引侧。

### 索引路径白名单

仓库根在**启动时通过 CLI 参数固定**（`code-archmage <path>`），整个应用生命周期不变。`POST /api/index` 不接受 `path` 参数（仓库根已固定），只对固定仓库根执行索引。这从设计上杜绝了"索引任意路径"的攻击面。

### 已知限制（文档注明，不阻塞 MVP）

- **TOCTOU**：`resolve_path` 校验与实际读文件之间存在时间窗口，文件可能被换成 symlink。MVP 单用户本地场景可接受。
- **symlink 目录不索引**：`pathlib.rglob` 不进入 symlink 目录（含指向仓库内部的），这些目录下的文件不会被索引。MVP 可接受。

---

## 三、模块结构

```
engine/src/code_archmage/server/
├── __init__.py      # 公共导出：create_app, run_server, resolve_path, PathEscapeError
├── app.py           # create_app() 应用工厂 + CORS + 路由注册 + run_server()
├── security.py      # 路径沙箱：resolve_path() + PathEscapeError
├── models.py        # Pydantic 响应模型
└── routes.py        # 所有 API 路由（11 个端点，单文件不超 300 行）
```

4 个文件，按职责清晰分层。若 `routes.py` 后续膨胀（加 LLM 路由），再拆 `routes/` 子包。

### 需要在 indexer 补充的小改动

1. **`indexer/queries.py` 补 `find_symbol_by_id`**：`find_symbol_by_id(conn, symbol_id) -> Symbol | None`（当前只有按 name 查的 `find_definition`，缺按 id 查）。一个查询函数 + 一个测试。

2. **`indexer/writer.py` 的 `_iter_python_files` 过滤 symlink**（cc S-1）：在遍历时跳过 `path.is_symlink()` 的条目。一个测试：仓库内 symlink `.py` 指向外部 → 索引后 `files` 表不含该路径。

---

## 四、应用状态与连接管理

### 应用工厂签名

```python
def create_app(repo_root: Path, db_path: Path | None = None, dev_mode: bool = False) -> FastAPI:
    """创建 FastAPI 应用。

    Args:
        repo_root: 被索引的仓库根目录（启动时固定，生命周期内不变）
        db_path: 索引库路径，默认 repo_root / ".code_archmage_index" / "index.sqlite"
        dev_mode: 开发模式（注册 CORS 中间件，允许 Vite dev server 端口）
    """
```

- **`db_path.parent.mkdir(parents=True, exist_ok=True)`**（cc B-4）：默认路径的父目录在全新仓库里不存在，`sqlite3.connect` 会抛 `OperationalError`。启动时先建目录。
- 启动时调用 `init_db(db_path)` 确保 schema 存在（幂等）
- `repo_root`、`db_path`、`dev_mode` 存入 `app.state`，通过依赖注入暴露给路由

### 索引并发互斥（cc B-1）

同步索引没有互斥时，两个并发请求（前端"索引"按钮双击）会同时跑全量索引（双倍 CPU），且第二个请求的写事务等锁超时 → `OperationalError: database is locked` → 裸 500。

```python
# app.state 上放一把锁（索引用 to_thread 在工作线程执行，需 threading.Lock）
app.state.index_lock = threading.Lock()

# POST /api/index 路由内：
if not app.state.index_lock.acquire(blocking=False):
    raise HTTPException(409, "索引正在进行中，请稍后重试")
try:
    ...  # 执行索引
finally:
    app.state.index_lock.release()
```

### 连接策略（遵循 ADR-002：每工作单元一个连接）

每个请求在自己的工作线程内开连接、查询、关闭，**不在 asyncio 事件循环线程开连接**：

```python
async def _run_query(db_path: Path, func, *args):
    """在工作线程内开连接 → 执行同步查询 → 关闭连接。"""
    def _work():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        try:
            return func(conn, *args)
        finally:
            conn.close()
    try:
        return await asyncio.to_thread(_work)
    except sqlite3.OperationalError as e:
        # cc B-8: locked/busy 统一转 503，不吐裸 500
        raise HTTPException(503, f"数据库暂时不可用，请重试：{e}")
```

- 连接生命周期完全在工作线程内，不跨线程传递，无需 `check_same_thread=False`
- 每请求独立连接，无共享状态，符合 ADR-002

### 依赖注入

```python
def get_repo_root(request: Request) -> Path:
    return request.app.state.repo_root

def get_db_path(request: Request) -> Path:
    return request.app.state.db_path
```

### run_server 端口策略（cc O-3）

```python
def run_server(repo_root: Path, host: str = "127.0.0.1", port: int = 8765) -> None:
    """启动 uvicorn 服务。host 强制 127.0.0.1，port 默认 8765。"""
```

- 默认端口 `8765`（与 `.env.example` 的 `SERVER_PORT` 一致）
- 端口被占用时 uvicorn 默认报错退出（不自动换端口，避免用户找不到服务）
- `host` 传 `0.0.0.0` 时强制改回 `127.0.0.1`（安全硬规则 1）

---

## 五、API 契约

所有响应为 JSON。错误统一返回 `{"detail": "..."}` + HTTP 4xx/5xx（FastAPI 默认格式）。

| Method | Path | 用途 | 对应 indexer 调用 |
|--------|------|------|-------------------|
| `GET` | `/api/health` | 健康检查 | — |
| `POST` | `/api/index` | 触发索引（同步 + 互斥，仓库根固定） | `index_directory` + `assign_callers` + `resolve_callees` |
| `GET` | `/api/index/status` | 索引库统计 | `SELECT COUNT` from files/symbols |
| `GET` | `/api/files/tree` | 已索引的 .py 文件路径列表（扁平） | `SELECT file_path FROM files` |
| `GET` | `/api/files/{file_path:path}` | 文件内容 + 符号大纲 | 读磁盘 + `SELECT FROM symbols WHERE file_path=?` |
| `GET` | `/api/symbols/{symbol_id}` | 符号详情（含定义位置） | `find_symbol_by_id`（新增） |
| `GET` | `/api/symbols?name=` | 按名称查定义（候选列表） | `find_definition` |
| `GET` | `/api/symbols/{symbol_id}/references?limit=` | 引用列表 | `find_references` |
| `GET` | `/api/symbols/{symbol_id}/callers` | 调用者列表 | `find_symbol_by_id` → `find_callers` |
| `GET` | `/api/symbols/{symbol_id}/callees` | 被调用者列表 | `find_callees` |
| `GET` | `/api/search?q=&limit=` | FTS5 全文搜索 | `search_fts` |

### 关键设计决策

1. **索引触发为同步**（非 dev_workflow 原写的"异步 task_id"）：MVP 单用户场景，索引中等仓库（几百 .py）几秒内完成，同步阻塞可接受。避免引入任务队列/状态机/并发去重的复杂度。配套并发互斥锁（B-1）防止双击双跑。`GET /api/index/status` 返回的是"索引库当前统计"（文件数、符号数、schema 版本），不是"正在索引的进度"。

2. **文件树返回扁平路径列表**（非嵌套树）：后端只返回 `["src/main.py", "src/utils.py", ...]`，前端构建嵌套树（前端强项，有现成组件）。后端保持简单。

3. **不单独做 `/api/symbols/{id}/definition`**：symbols 表存的就是定义，`GET /api/symbols/{id}` 已含 `file_path` + `line`（即定义位置）。按名称查定义用 `GET /api/symbols?name=foo`。

4. **symbol id 不保证跨索引稳定**：增量索引的"先删后写"会改变自增 id。MVP 可接受——重新索引后前端重新加载。文档标注此限制。

5. **大结果集 limit**（cc O-1）：`/api/search`、`/api/symbols/{id}/references` 加 `limit` 查询参数（默认 200，上限 500），防止几万行仓库返回几千条撑爆前端 DOM。

### 响应模型（完整定义）

```python
# models.py
from pydantic import BaseModel

class SymbolOut(BaseModel):
    id: int
    name: str
    kind: str
    file_path: str
    line: int
    col: int
    end_line: int
    signature: str
    bases: list[str]       # cc B-5: 阶段 5 继承图需要，现在就带上
    decorators: list[str]  # cc B-5

class ReferenceOut(BaseModel):
    file_path: str
    line: int
    col: int
    kind: str

class SearchHitOut(BaseModel):
    symbol_id: int
    name: str
    kind: str
    file_path: str
    line: int
    snippet: str   # FTS 命中上下文片段

class FileContentOut(BaseModel):
    path: str
    content: str
    language: str  # 固定 "python"（MVP 仅 Python）
    symbols: list[SymbolOut]

class FileTreeOut(BaseModel):
    paths: list[str]

class IndexResultOut(BaseModel):
    files_total: int       # cc B-5: 库内总文件数（索引后）
    files_changed: int     # 本次实际变更数
    symbols_total: int
    calls_total: int
    duration_ms: int

class IndexStatusOut(BaseModel):
    file_count: int
    symbol_count: int
    schema_version: str
    repo_root: str         # cc B-5: 前端展示"正在看哪个仓库"
    db_path: str
```

---

## 六、TDD 循环清单（13 个循环）

每个循环：🔴 写失败测试 → 🟢 最小实现通过 → 🔵 重构。

| # | 循环 | 红（失败测试） | 绿（实现） |
|---|------|----------------|------------|
| 1 | **路径沙箱基础** | `resolve_path(root, "../../etc/passwd")` 抛 `PathEscapeError`；`%2e%2e%2f` 编码穿越同样拒绝；正常相对路径返回合法 `Path`；root 和 target 都 resolve（macOS `/tmp`→`/private/tmp` 陷阱） | `security.py`：`resolve_path()` + `PathEscapeError` |
| 2 | **符号链接逃逸（读）** | 仓库内 symlink 指向 `/tmp` → `PathEscapeError`；指向仓库内文件 → 通过 | `resolve_path` 增加 `islink` + resolve 后比较 |
| 3 | **符号链接逃逸（索引）** | 仓库内 symlink `.py` 指向外部 → 索引后 `files` 表不含该路径 | `writer._iter_python_files` 过滤 `is_symlink()` |
| 4 | **应用骨架 + 安全 + CORS** | `create_app(tmp_root)` 不抛异常（全新空仓库，无 `.code_archmage_index/` 目录）；`GET /api/health` → 200；`run_server` 默认 `host="127.0.0.1"` `port=8765`；传 `0.0.0.0` 强制改回；`dev_mode=True` 注册 CORS 且 origins 含 `localhost:5173`；`dev_mode=False` 不注册 CORS | `app.py`：`create_app()` + `run_server()` + `mkdir` + health + CORS |
| 5 | **索引触发 + 并发互斥 + 空仓库** | `POST /api/index` → 索引 fixtures → 200 `IndexResultOut`（计数 > 0）；空仓库（无 .py）→ 200 全零；并发双请求 → 第二个 409 | 索引路由 + `index_lock` + 组合 `index_directory` + `assign_callers` + `resolve_callees` |
| 6 | **索引状态 + 空库** | `GET /api/index/status`（已索引）→ 200 `IndexStatusOut`；（未索引/空库）→ file_count=0，不报错 | 状态路由：COUNT 查询 |
| 7 | **文件树** | `GET /api/files/tree`（已索引）→ 200 `{"paths": [...]}`；（空库）→ `{"paths": []}` | 文件树路由：`SELECT file_path FROM files` |
| 8 | **文件内容 + 符号大纲 + 错误路径** | `GET /api/files/foo.py` → 200 `FileContentOut`；`../../etc/passwd` → 4xx；不存在的文件 → 404；路径指向目录 → 4xx | 文件内容路由 + `resolve_path` 集成 |
| 9 | **符号详情 + 按名查定义** | `GET /api/symbols/{id}` → 200 `SymbolOut`（含 bases/decorators）；`GET /api/symbols?name=foo` → 200 `list[SymbolOut]`；不存在 id → 404 | 符号路由 + `indexer.find_symbol_by_id`（新增） |
| 10 | **引用 + 调用者 + 被调用者 + limit** | `GET /api/symbols/{id}/references?limit=10` → 200 `list[ReferenceOut]`；`/callers` → `list[SymbolOut]`；`/callees` → `list[SymbolOut]`；limit 截断生效 | 三个关系路由 + limit 参数 |
| 11 | **全文搜索 + limit + 空结果** | `GET /api/search?q=foo` → 200 `list[SearchHitOut]`；`limit=5` 截断；空 q → 400；无匹配 → 空列表 | 搜索路由：`search_fts` |
| 12 | **OpenAPI 契约回归** | `GET /openapi.json` → 200；抽查关键端点 response schema（字段名、类型存在） | 无新代码，验证 FastAPI 自动生成的契约完整 |
| 13 | **集成测试 + 索引中查询** | 完整流程：`POST /api/index` → `GET /api/files/tree` → `GET /api/files/{path}` → `GET /api/symbols/{id}` → `GET /api/symbols/{id}/callers`，全链路断言 | 无新代码，验证组装正确 |

---

## 七、测试策略

### 测试基础设施

- **TestClient**：FastAPI 自带（基于 httpx），同步接口测 async 路由
- **临时仓库 fixture**：每个测试用 `tmp_path` 创建临时仓库 + 临时 db，自包含不依赖外部 fixtures
- **索引 fixture**：在 `tmp_path` 内写几个简单 .py 文件（或复制 `engine/tests/fixtures/python/` 的样本）
- **symlink fixture**：`tmp_path` 内建 symlink 指向另一个 `tmp_path_factory` 临时目录（避免 macOS `/tmp`→`/private/tmp` resolve 陷阱）

### 测试分组

```
engine/tests/server/
├── conftest.py              # create_app + TestClient + 临时仓库 + symlink fixtures
├── test_security.py         # 循环 1-3：路径沙箱 + 符号链接（读 + 索引）
├── test_app.py              # 循环 4：应用骨架 + health + 绑定地址 + CORS + mkdir
├── test_index.py            # 循环 5-6：索引触发 + 并发互斥 + 空仓库 + 状态
├── test_files.py            # 循环 7-8：文件树 + 文件内容 + 路径穿越 + 错误路径
├── test_symbols.py          # 循环 9-10：符号详情 + 关系查询 + limit
├── test_search.py           # 循环 11：全文搜索 + limit + 空结果
├── test_contract.py         # 循环 12：OpenAPI 契约回归
└── integration/
    └── test_server_flow.py  # 循环 13：全链路集成
```

### 安全测试单独成组

`test_security.py` 和 `test_files.py` 中的路径穿越用例，是本阶段的**核心交付物**，优先级高于功能测试。

---

## 八、验收标准

1. **四条安全硬规则全部有红测试固化**，且测试通过（含索引侧 symlink 过滤）
2. **11 个 API 端点全部实现**，OpenAPI 文档（`/docs`）可访问且 schema 完整
3. **OpenAPI 契约回归测试通过**（`/openapi.json` 关键端点 schema 断言）
4. **所有测试通过**，服务层测试覆盖率 ≥ 90%
5. **集成测试**：完整流程（索引→文件树→文件内容→符号→关系）全链路跑通
6. **并发安全**：双击索引按钮不会双跑或 500（互斥锁 + 409）
7. **质量门禁**：`ruff check` + `ruff format --check` + `mypy --strict` 全部通过
8. **CORS**：开发模式允许 `localhost:5173`，生产同源不受影响，有测试固化
9. **不引入新依赖**（除 FastAPI + uvicorn + pydantic，pyproject.toml 已有 httpx）

---

## 九、不做清单（阶段 3 明确排除）

- LLM 网关（`/api/llm/chat`）→ 阶段 5
- 惰性摘要（`/api/summaries`）→ 阶段 5
- 异步索引 + task_id 轮询 → 未来优化（MVP 同步 + 互斥锁够用）
- WebSocket 实时推送 → 未来优化
- 多仓库支持 → 未来（MVP 单仓库）
- 文件监听（watchdog 自动重索引）→ 未来优化
- force 全量重建参数 → MVP 删库重启即可
- 非 .py 文件的文件树 → MVP 仅 Python
- 分页（offset/cursor）→ MVP 用 limit 截断，完整分页推迟
