# Code Archmage — 开发流程（TDD）

> 本文档定义 Code Archmage 的开发流程、TDD 节奏、项目结构、工具链、隐私保护与提交规范。
> 配套阅读：`plans/plan.md`（产品技术规划）。
> 本版整合了 Claude Code 审核意见（3 个严重问题 + 建议改进 + 可选优化）。

---

## 一、总体策略

### 1.1 TDD 核心节奏：红 → 绿 → 重构

每一个功能点都严格遵循三步循环，**不允许"先写实现再补测试"**：

```
🔴 红：写一个失败的测试，明确描述要做什么
   ↓
🟢 绿：写最少的代码让测试通过（允许丑陋）
   ↓
🔵 重构：在测试保护下改善代码（命名、结构、去重）
```

**关键纪律**：
- 没有失败的测试，就不写实现代码
- 每次循环控制在 5-15 分钟（测试粒度要小）
- 重构阶段绝不新增功能，只改善结构
- 提交粒度 = 一个完整的红绿重构循环

### 1.2 测试金字塔

```
        /\
       /E2E\          少量：Playwright，跑完整用户流程
      /------\
     / 集成测试 \      适量：跨模块协作（引擎↔SQLite、API↔引擎）
    /------------\
   /   单元测试    \    大量：纯函数、解析器、索引器、React 组件
  /----------------\
```

- **单元测试占 70%+**：引擎层（解析/索引/查询）是纯逻辑，TDD 收益最高
- **集成测试占 20%**：API 契约、SQLite 持久化、前端数据流
- **E2E 占 10%**：关键用户路径（打开仓库→索引→浏览→提问），用 Playwright

> **覆盖率说明**：覆盖率是参考指标，**禁止为凑覆盖写无断言测试**。门禁只对引擎核心模块（parser/indexer）强制 ≥80%，前端组件 ≥70% 即可。

### 1.3 开发顺序：分层 TDD + 垂直切片验证

**不采用**"先把引擎层全部做完再做前端"的瀑布式，也**不采用**纯垂直切片（前期没有足够单元测试保护）。

采用**分层 TDD 打基础 + 垂直切片串联验证**：

```
阶段 0：项目初始化（脚手架、工具链、CI、gitignore）
   ↓
阶段 1-2：引擎层 TDD（解析器 + 索引器）—— 可测试性最强，先打牢
   ↓
阶段 3：服务层 TDD（FastAPI，定义 API 契约 + 安全硬规则）
   ↓
阶段 4：第一个垂直切片（前端 + 服务 + 引擎串起来，E2E 验证最小闭环）
   ↓
阶段 5：迭代加厚（调用图、LLM、剥洋葱）
   ↓
阶段 6：发布准备（打包、文档、一键启动、跨平台）
```

**为什么引擎层先？** 它是纯函数式的"输入代码 → 输出符号表"，没有 UI、没有网络、没有副作用，TDD 在这里最纯粹、ROI 最高。前端依赖 API 契约，而 API 契约依赖引擎能力，所以引擎先行。

---

## 二、大阶段流程（概览）

| 阶段 | 目标 | 产出 | TDD 重点 |
|------|------|------|----------|
| **0. 初始化** | 仓库骨架、工具链、CI、gitignore | 可运行的空项目 + 绿色 CI | 测试框架能跑通"hello test" |
| **1. 解析器** | tree-sitter 解析 Python → 符号/调用 AST | `parser` 模块 + 测试 fixtures | 单元测试为主，fixtures 驱动 |
| **2. 索引器** | 符号表/调用边写入 SQLite + FTS5 | `indexer` 模块 + 数据库 schema | 单元 + 集成（内存 SQLite） |
| **3. 服务层** | FastAPI 暴露查询/跳转/调用图接口 + 安全硬规则 | `server` 模块 + OpenAPI 契约 | API 契约测试 + 安全红测试 |
| **4. 垂直切片** | 前端基础阅读（文件树+代码视图+跳转） | 可用的 localhost 应用 | 组件测试 + 1 条 E2E |
| **5. 加厚迭代** | 调用图、LLM 问答、剥洋葱 | 完整 MVP 功能 | 每个功能一个 TDD 循环 |
| **6. 发布** | 一键启动、打包、跨平台、文档 | 可分发的 MVP | E2E 回归 + 手动验收 |

---

## 三、细分步骤

### 阶段 0：项目初始化

**目标**：搭好骨架，让"写测试 → 跑测试 → CI"这条链路畅通。

#### 步骤
1. **创建 monorepo 结构**（见第四节）
2. **Python 引擎工具链**：
   - `pyproject.toml`（用 `uv` 管理依赖，快且省空间）
   - 测试：`pytest` + `pytest-cov` + `pytest-asyncio`
   - Lint/Format：`ruff`（lint + format 二合一，替代 black+flake8+isort）
   - 类型：`mypy`（strict 模式，引擎层强制）
3. **前端工具链**：
   - `package.json`（用 `pnpm`，快且省空间）
   - 构建：`Vite` + `React` + `TypeScript`（strict）
   - 测试：`Vitest` + `React Testing Library` + `Playwright`（E2E）
   - Lint/Format：`eslint` + `prettier`
4. **Git 钩子**（提交前自动检查）：
   - Python：`pre-commit` 框架，跑 ruff + pytest（快速子集）
   - 前端：`husky` + `lint-staged`，跑 eslint + tsc
5. **CI**（GitHub Actions）：
   - PR 触发：lint + 单元测试 + 构建
   - main 分支：完整测试 + 覆盖率上报
6. **`.gitignore`**（见第五节，重点保护隐私）
7. **README**：项目简介 + 一键启动说明 + 开发指南

#### TDD 验证点
- 写一个 `test_smoke.py`（`assert 1 + 1 == 2`）和 `smoke.test.tsx`，确认 pytest 和 vitest 都能跑通
- CI 上这两个测试能绿色通过

---

### 阶段 1：解析器（tree-sitter → 符号/调用）

**目标**：输入一段 Python 代码，输出结构化的符号列表和调用关系。

#### 测试 Fixtures 设计（关键）

在 `engine/tests/fixtures/python/` 下精心构造一组"解析测试用代码"，**每个文件专门触发一种解析场景**：

```
fixtures/python/
├── simple_function.py        # 简单函数定义
├── class_with_methods.py     # 类 + 方法 + self
├── nested_calls.py           # a(b(c())) 嵌套调用
├── method_calls.py           # obj.method() 方法调用
├── decorators.py             # 装饰器
├── imports.py                # import / from...import
├── async_functions.py        # async def
├── comprehensions.py         # 列表/字典推导式
├── walrus_operator.py        # := 海象运算符
├── star_imports.py           # from x import *（边界情况）
├── gbk_encoded.py            # 非 UTF-8 编码（GBK，中文作业常见）
└── bom_utf8.py               # 带 BOM 的 UTF-8
```

> **重要**：这些 fixtures 是**我们自己写的、专门设计的测试代码**，不是真实项目代码。它们既是测试输入，也是"解析器支持哪些语法"的活文档。

#### TDD 循环清单
1. 解析函数定义（名、参数、行号、返回类型注解）
2. 解析类定义（名、基类、方法列表）
3. 解析变量赋值（模块级、类成员）
4. 识别函数调用（直接调用 `foo()`）
5. 识别方法调用（`obj.method()`，记录为"属性调用"）
6. 处理导入语句（建立模块→符号映射）
7. 处理装饰器（不脱层，记录装饰器名）
8. **编码边界**：GBK / BOM 文件解码失败时不崩溃，跳过并记录错误

---

### 阶段 2：索引器（符号表 + 调用边 → SQLite）

**目标**：把解析器输出持久化到 SQLite，支持高效查询。

#### 索引数据库存放位置（cc 审核要求明确）

- **位置**：`<仓库根>/.code_archmage_index/`（项目根下的隐藏目录）
- **内容**：`index.sqlite`（主库）+ `index.sqlite-wal`、`index.sqlite-shm`（WAL 模式副产物）
- **gitignore**：整个 `.code_archmage_index/` 目录被忽略（含 WAL/SHM 副产物，不漏）
- **理由**：跟随项目走，删项目即删索引；隐藏目录不污染文件树视觉

#### 异步 SQLite 选型（开工前记 ADR）
FastAPI 是异步框架，SQLite 访问有两种方案，需在阶段 2 开工时定并记 ADR：
- 方案 A：`aiosqlite`（原生异步，但多一层包装、性能略低）
- 方案 B：同步 `sqlite3` + `asyncio.to_thread`（性能好，但要注意线程安全）
- 倾向方案 B（WAL 模式下读多写少，线程池足够），但需 ADR 确认。

#### TDD 循环清单
1. **Schema 设计**（先写测试验证 schema 正确）：
   - `symbols` 表：id, name, kind, file_path, line, col, end_line, signature
   - `calls` 表：caller_id, callee_name, callee_id(可空), file_path, line
   - `imports` 表：file_path, imported_module, imported_name, alias
   - `files` 表：path, hash, indexed_at
   - `summaries` 表：symbol_id, summary_text, model, created_at（惰性摘要缓存）
   - FTS5 虚拟表：对 symbols.name 和源码文本建全文索引
   > 注：`annotations`（笔记/批注）表移到二期，避免 MVP schema 返工。
2. **索引单个文件**：解析 → 写入符号/调用/导入 → 更新 FTS
3. **索引整个目录**：遍历 .py 文件，跳过 venv/__pycache__
4. **增量索引**：按文件 hash 判断是否需要重新解析
5. **查询接口**（纯函数，输入 db + 查询参数，输出结果）：
   - `find_definition(name)` → 符号定位
   - `find_references(symbol_id)` → 所有引用点
   - `find_callers(name)` → 调用者
   - `find_callees(symbol_id)` → 被调用者（含多候选）
   - `search_fts(query)` → 全文搜索

#### 测试策略
- 用 SQLite `:memory:` 跑每个测试，无副作用、快
- 集成测试：索引 fixtures 目录 → 查询 → 断言关系正确

---

### 阶段 3：服务层（FastAPI）+ 安全硬规则

**目标**：把索引器的能力通过 HTTP 暴露给前端，同时守住隐私产品的安全底线。

#### ⚠️ 本地服务安全硬规则（cc 审核指出的严重遗漏）

这个产品以"隐私优先"为核心卖点（实习代码不能上传），但学生的典型环境是宿舍/教室局域网。如果服务误绑 `0.0.0.0`，同网段任何人都能读到学生机上的代码。这是最讽刺的翻车方式，**必须靠 TDD 红测试固化**。

**三条硬规则**：
1. **只绑定 `127.0.0.1`**：uvicorn 启动参数强制 `host="127.0.0.1"`，绝不暴露到局域网
2. **路径沙箱**：所有文件路径 API（`/api/files/{path}`、`POST /api/index`）必须校验解析后的绝对路径在被索引仓库根目录内，拒绝 `../` 逃逸
3. **拒绝符号链接逃逸**：仓库内的符号链接如果指向根目录外，拒绝访问

**对应的 TDD 红测试**（必须写）：
```
🔴 红：GET /api/files/../../../etc/passwd → 断言返回 4xx，不返回内容
🔴 红：POST /api/index { path: "/etc" } → 断言返回 4xx，拒绝索引仓库外路径
🔴 红：启动服务后，断言 socket 只监听 127.0.0.1（可用 ss/netstat 验证）
```

#### API 契约先行（OpenAPI）

先写 `openapi.yaml`（或用 FastAPI 的 docstring 自动生成），明确每个接口的请求/响应 schema，**这是前后端的契约，双方都基于它写测试**。

#### 核心 API
```
POST /api/index          { path } → 触发索引（异步，返回 task_id）
GET  /api/index/status   → 索引进度
GET  /api/files/tree     → 文件树
GET  /api/files/{path}   → 文件内容 + 符号大纲（路径沙箱校验）
GET  /api/symbols/{id}   → 符号详情
GET  /api/symbols/{id}/definition   → 跳转目标
GET  /api/symbols/{id}/references   → 引用列表
GET  /api/symbols/{id}/callers      → 调用者
GET  /api/symbols/{id}/callees      → 被调用者
GET  /api/search?q=       → 全文搜索
POST /api/llm/chat       { message, context } → LLM 网关（流式）
POST /api/summaries      { symbol_id } → 惰性生成摘要
```

#### TDD 循环
```
🔴 红：写 TestClient 测试，断言 GET /api/files/tree 返回正确结构
🟢 绿：实现路由，调用 indexer，返回结果
🔵 重构：抽取公共的"db session 依赖注入"
```

- 每个接口一个测试文件，覆盖：正常路径、空结果、错误路径（文件不存在等）
- **安全测试单独成组**：路径穿越、越权索引、绑定地址验证
- LLM 网关测试：mock LLM 响应，不真实调用 API（省 token）

---

### 阶段 4：垂直切片（前端基础阅读）

**目标**：把"打开仓库 → 看到文件树 → 点开文件 → 看到代码 → 点符号跳转"这条最小路径跑通。

#### 前端 TDD 策略

React 组件测试用 **React Testing Library**，原则是**测行为不测实现**：
- ✅ 断言"点击文件后，代码区域显示该文件内容"
- ❌ 不断言"调用了 setState"

#### 细分循环
1. **文件树组件**：输入树结构 → 渲染 → 点击文件触发 onSelect
2. **代码视图组件**：CodeMirror 6 只读模式，输入代码 + 高亮
3. **符号大纲组件**：输入符号列表 → 渲染可折叠树 → 点击跳转
4. **跳转交互**：代码中点击符号 → 调用 API → 跳到定义
5. **数据层**：React Query（TanStack Query）封装 API 调用，测试缓存/加载态
6. **E2E（Playwright）**：启动测试用 fixtures 仓库 → 打开 localhost → 浏览 → 跳转，全程自动化

#### E2E 测试用专门的 fixtures 仓库
在 `web/tests/e2e/fixtures/sample_repo/` 放一个**精心设计的小型 Python 项目**（我们自己写的，约 10 个文件），专门用来跑端到端。**绝不使用真实私有代码**。

---

### 阶段 5：加厚迭代

每个功能独立一个 TDD 迭代，顺序建议（按用户价值排序）：

1. **全局搜索**（FTS5 已就绪，前端加个搜索框 + 结果列表）
2. **局部调用图**（react-flow，默认画上下游 1-2 层）
3. **LLM 对话面板**（含确定性上下文组装 —— 这是核心差异化）
4. **惰性摘要**（首次展开函数 → 调 LLM → 缓存）
5. **剥洋葱**（调用链展平，纯前端 + 已有 API）

每个功能都遵循：先写测试 → 实现 → 重构。

---

### 阶段 6：发布准备

1. **一键启动**：`code-archmage <path>` 命令（Python entry point），自动起服务 + 打开浏览器
2. **跨目录构建依赖**（cc 指出）：前端 `vite build` 产物要嵌入 engine 分发包（FastAPI 托管静态文件），engine 的构建脚本依赖 web 产物路径，**需在构建脚本里显式处理**
3. **打包**：用 PyInstaller 打包 Python 端
4. **跨平台 CI**（cc 指出）：学生用户是 Windows/macOS 混合，CI release 需双平台构建矩阵
5. **Tauri 壳**（可选，验证后）：套 Tauri，变成真正的桌面应用
6. **文档**：用户文档（如何配置 LLM key）+ 开发文档
7. **E2E 回归**：所有 Playwright 测试在打包产物上重跑一遍

---

## 四、项目结构

```
code_archmage/
├── engine/                      # Python 引擎 + 服务
│   ├── pyproject.toml
│   ├── src/code_archmage/
│   │   ├── parser/              # tree-sitter 解析
│   │   ├── indexer/             # SQLite 索引
│   │   ├── server/              # FastAPI
│   │   ├── llm/                 # LLM 网关
│   │   └── cli.py               # 一键启动入口
│   └── tests/
│       ├── fixtures/python/     # 解析测试用代码（自造）
│       ├── unit/
│       └── integration/
├── web/                         # React 前端
│   ├── package.json
│   ├── src/
│   │   ├── components/          # UI 组件
│   │   ├── hooks/               # 数据获取
│   │   ├── api/                 # API 客户端（由 openapi 生成）
│   │   └── App.tsx
│   └── tests/
│       ├── unit/                # vitest 组件测试
│       └── e2e/                 # playwright
│           └── fixtures/sample_repo/  # E2E 用小型项目（自造）
├── plans/                       # 规划文档（仓库正式结构）
│   ├── plan.md                  # 产品技术规划
│   ├── dev_workflow.md          # 本文档
│   ├── reference/               # 三份历史输入文档（原 agents_plans/）
│   └── decisions/               # ADR（架构决策记录）
├── .github/workflows/           # CI
├── .gitignore
├── .env.example                 # 环境变量模板（不含真实值）
└── README.md
```

> **结构说明**（回应"条理有层次、不混乱不过碎"）：
> - 顶层只有 `engine/` + `web/` + `plans/` + 配置文件，职责一目了然
> - `engine/` 用 Python 标准 src-layout（打包最佳实践）
> - `web/` 用标准 React 分层（components/hooks/api）
> - 原 `agents_plans/` 并入 `plans/reference/`，顶层少一个目录
> - 没有过度设计（不过早引入 apps/packages monorepo 框架），也不过碎

---

## 五、.gitignore 与隐私保护（重点）

> 用户明确要求：会推到 GitHub，注意隐私。以下必须严格忽略。

### 5.1 必须忽略的敏感内容

```gitignore
# === 密钥与环境变量（最高优先级）===
.env
.env.local
.env.*.local
*.pem
*.key
secrets/

# === 索引数据库（含代码符号信息，间接暴露代码结构）===
# 整个索引目录，含 sqlite 主库 + WAL/SHM 副产物
.code_archmage_index/
*.sqlite
*.sqlite3
*.sqlite-wal
*.sqlite-shm
*.db
index_cache/

# === AI 协作数据（含记忆、对话历史，可能含私有代码片段）===
.codebuddy/

# === 测试用的真实代码仓库（如有，绝不提交）===
test_repos/private/
*.private.py

# === Python ===
__pycache__/
*.py[cod]
*.egg-info/
.venv/
venv/
.pytest_cache/
.mypy_cache/
.ruff_cache/
htmlcov/
.coverage
coverage.xml

# === Node ===
node_modules/
dist/
build/
.vite/
coverage/

# === 系统/IDE ===
.DS_Store
Thumbs.db
.idea/
.vscode/
*.swp
*.swo

# === 日志 ===
*.log
logs/
```

> **注意**：`plans/` **不忽略**——规划文档和 ADR 是仓库正式结构的一部分，应随代码版本化管理。（cc 审核发现当前 .gitignore 误加了 `plans/`，阶段 0 会修正。）

### 5.2 隐私保护原则

1. **LLM API Key 永远不进仓库**：用 `.env` + `python-dotenv` 读取，`.env` 必须被忽略，只提交 `.env.example`（占位模板）
2. **索引数据库不进仓库**：`.code_archmage_index/` 整个目录被忽略，含代码符号和路径，间接暴露私有代码结构
3. **测试 fixtures 必须自造**：绝不拿真实工作代码当测试输入。所有 `fixtures/` 下的代码都是我们为测试专门编写的、无隐私问题的示例
4. **`.codebuddy/` 整个忽略**：含 AI 记忆和协作数据，可能记录了讨论中的私有代码
5. **提交前自查**：pre-commit 钩子里加一条检查，如果 `git diff` 里出现 `sk-`、`api_key`、`token` 等模式就阻止提交
6. **服务只绑 127.0.0.1**：防止宿舍局域网内代码被同网段访问（见阶段 3 安全硬规则）

### 5.3 .env.example 模板

```env
# LLM 配置（用户自行填写，切勿提交真实值）
LLM_API_KEY=your-api-key-here
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# 服务端口
SERVER_PORT=8765
```

---

## 六、代码质量与提交规范

### 6.1 提交规范（Conventional Commits）

```
<type>(<scope>): <subject>

type:  feat | fix | test | refactor | docs | chore | perf | ci
scope: parser | indexer | server | web | ci ...
```

示例：
- `feat(parser): 支持解析 async 函数定义`
- `test(indexer): 补充 FTS5 搜索的边界测试`
- `fix(web): 修复文件树深层嵌套时的渲染错乱`

### 6.2 提交粒度

- **一个提交 = 一个完整的红绿重构循环**（或一个逻辑完整的小改动）
- 不允许"半成品"提交（测试没过、构建失败）
- 大功能拆成多个小提交，每个都能独立通过测试

### 6.3 合并规范（单人项目减负版）

> 单人开发不需要每个改动都走 PR，但要有质量门禁：
- **合并 main 必须 CI 绿 + 有对应测试**
- 重大功能/架构改动建议开 PR（方便回溯和自我 review）
- 日常小改动可直接 push main，但 pre-commit 钩子必须过

### 6.4 代码质量门禁

| 检查项 | Python | TypeScript |
|--------|--------|------------|
| Lint | ruff（零警告） | eslint（零警告） |
| 格式 | ruff format | prettier |
| 类型 | mypy strict | tsc strict |
| 测试覆盖率 | ≥ 80%（引擎核心模块强制） | ≥ 70%（组件） |
| 提交前钩子 | pre-commit | husky + lint-staged |

---

## 七、开发注意事项

### 7.1 TDD 常见陷阱（避免）

1. **测试实现细节而非行为**：不要测私有方法、不要测函数内部调用了几次某依赖。测"给定输入，产出什么"
2. **测试粒度过大**：一个测试只验证一件事。如果测试名里有"和"字，考虑拆分
3. **跳过红阶段**：先写实现再补测试 = 没有验证测试真的能失败。测试可能永远绿色却没在测对东西
4. **重构时新增功能**：重构阶段只动结构，加功能要开新的红绿循环
5. **为凑覆盖率写无断言测试**：覆盖率是参考指标，门禁只对引擎核心模块强制

### 7.2 全栈 TDD 的特殊考量

1. **前端测试不要过度**：UI 组件测到"行为正确"即可，不要追求 100% 覆盖率，否则维护成本爆炸。把测试精力放在数据流和交互逻辑上
2. **E2E 测试要少而精**：Playwright 测试慢且脆，只覆盖关键路径（3-5 条即可），不要用它替代单元测试
3. **Mock 边界要清晰**：
   - 引擎层测试：不 mock（测真实解析）
   - 服务层测试：mock LLM（省 token），不 mock SQLite（用 :memory:）
   - 前端单元测试：mock API（用 MSW）
   - E2E：全真实，不 mock

### 7.3 本地服务安全（隐私产品的底线）

> 这是 cc 审核指出的严重遗漏，单独成节强调。

1. **永远只绑 127.0.0.1**：uvicorn 启动参数 `host="127.0.0.1"`，不写 `0.0.0.0`，不用 `"::"`。CI 里加测试断言绑定地址。
2. **路径沙箱**：所有接受文件路径的 API，先 `Path(p).resolve()`，再校验结果在仓库根目录内。拒绝 `../` 逃逸。
3. **拒绝符号链接逃逸**：仓库内的 symlink 如果指向根目录外，拒绝访问。
4. **索引路径白名单**：`POST /api/index` 只接受首次配置的仓库根，不允许中途索引任意路径。
5. **安全测试是强制的**：阶段 3 必须写路径穿越/越权/绑定地址的红测试，不是可选项。

### 7.4 性能与可维护性

1. **测试要快**：单元测试单个 < 100ms，整个套件 < 10s。慢测试单独标记，CI 里可并行
2. **fixtures 要小**：解析测试用的代码文件控制在 20 行内，只触发目标场景
3. **SQLite 用 WAL 模式**：并发读性能好，适合"索引中也能查询"的场景
4. **tree-sitter 增量解析**：大仓库索引时利用增量能力，文件没改不重解析

### 7.5 Python 动态类型的诚实处理

- 调用图解析接受不完美：duck typing、属性调用无法精确解析
- 测试里明确标注"已知不精确场景"，断言"返回多个候选"而非"返回唯一正确答案"
- 不为了追求解析精度引入复杂的类型推断（那是二期的事）

### 7.6 LLM 相关开发的纪律

1. **测试永远 mock LLM**：单元测试不调真实 API，用固定响应 mock
2. **只在 E2E 手动验收时调真实 LLM**：且用最便宜的模型（如 deepseek-chat 而非 pro）
3. **Prompt 也是代码**：prompt 模板放 `engine/src/code_archmage/llm/prompts/`，版本化管理，改动要有测试
4. **确定性上下文组装要单独测**：给定符号 id，断言组装出的 context 包含正确的函数体/调用签名/类成员

### 7.7 文档同步

- 每个阶段完成后，更新 `README.md` 的"开发进度"小节
- 重大架构决策记录在 `plans/decisions/`（ADR 格式：决策 + 背景 + 后果）
- API 变动同步更新 OpenAPI schema 和前端 API 客户端

---

## 八、快速启动检查清单

开发前确认以下都就绪：

- [ ] 仓库已创建，`.gitignore` 已配置（尤其 `.env`、`.code_archmage_index/`、`.codebuddy/`）
- [ ] `plans/` 不被 gitignore（规划文档要进仓库）
- [ ] Python 环境：`uv sync` 能装好依赖，`pytest` 能跑通 smoke test
- [ ] 前端环境：`pnpm install` 成功，`pnpm test` 能跑通 smoke test
- [ ] pre-commit 钩子已安装：`pre-commit install`（Python）、`pnpm prepare`（前端 husky）
- [ ] CI 在 GitHub Actions 上绿色
- [ ] `.env.example` 已提交，真实 `.env` 已被忽略
- [ ] 测试 fixtures 目录结构已建好（`engine/tests/fixtures/python/`、`web/tests/e2e/fixtures/`）

---

> 下一步：确认本流程后，从阶段 0 开始执行。每个阶段完成时做一次 review。
