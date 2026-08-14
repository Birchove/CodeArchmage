# 阶段 4：前端垂直切片执行方案 v2（React + CodeMirror）

> 把"打开仓库 → 索引 → 文件树 → 点开文件 → 看代码 → 符号大纲 → 跳定义"这条最小闭环跑通。
> 前置：阶段 1（解析器）+ 阶段 2（索引器）+ 阶段 3（服务层 11 个 API 端点）已完成。
> 依据：`plans/dev_workflow.md` 阶段 4 + `plans/plan.md` MVP 闭环（索引→文件树→折叠阅读→跳转）。
>
> **v2 修订**：吸收 cc 第二意见审核（task `7b7e0673e102`）全部 4 严重 + 7 建议 + 6 遗漏。审核对照表见文末附录。

---

## 一、阶段目标与范围

### 做（阶段 4）

- **三区布局**：左侧（文件树 + 符号大纲）+ 中间（只读代码视图）+ 顶部状态栏。右侧（LLM + 调用图）和顶部搜索栏留给阶段 5。
- **API 客户端层**：手写 TypeScript 类型（对齐阶段 3 的 Pydantic 模型）+ 轻量 typed fetch 封装。
- **服务器状态管理**：TanStack Query（React Query）封装 API 调用，处理加载/错误/缓存。
- **核心组件**：FileTree、CodeView（CodeMirror 6 只读）、SymbolOutline、Header、EmptyState、ErrorState。
- **核心交互**：点文件 → 加载代码 + 大纲 + 调用点；点大纲符号 → 代码滚动到行；点代码内调用点 → 跳定义（跨文件，含名称匹配降级）。
- **索引触发**：首次进入若库为空，显示 EmptyState + "索引"按钮；点击触发 `POST /api/index`，pending 期间禁用按钮 + "索引中…"提示。
- **引擎侧小扩展（S-1）**：`FileContentOut` 增 `calls` 字段 + 新增 `CallOut` 模型，让前端能取到调用点（resolver 已填 `callee_id`）。属阶段 4 需求驱动的阶段 3 契约向后兼容扩展。
- **最小 CLI 雏形（S-3）**：重写 `cli.py` 占位 + 新增 `__main__.py`，`python -m code_archmage <path>` 起 uvicorn（不开浏览器、不打包——那些是阶段 6）。
- **E2E（Playwright）**：自造小型 Python fixtures 仓库，真实启动后端（CLI 雏形）+ 前端（vite preview + proxy 同源），跑全链路。

### 不做（推迟到阶段 5+）

- **全局搜索栏**（FTS5 后端已就绪，前端搜索 UI 阶段 5）
- **局部调用图**（react-flow，阶段 5）
- **LLM 对话面板 + 确定性上下文组装**（阶段 5）
- **惰性摘要**（阶段 5）
- **剥洋葱调用链展平**（阶段 5）
- **引用/调用者/被调用者面板**（阶段 5 调用图一起做）
- **属性调用 `obj.method()` 的精确跳转**（callee_name 只记 "method"，多候选；阶段 4 走名称匹配降级，精确解析留阶段 5 调用图）
- **一键启动开浏览器 + 打包**（阶段 6；阶段 4 只做 CLI 雏形起服务）
- **文件监听自动重索引**（未来优化）
- **大仓库虚拟滚动**（阶段 6 性能调优；阶段 4 加最低护栏，见决策 9）
- **主题切换、字体设置等偏好**（二期）

> **理由**：MVP 最小闭环是"索引→文件树→折叠阅读→跳转"。阶段 4 精确覆盖这条链路的前端部分 + 一个让"跳转"真正可用的引擎端点扩展，把三区布局骨架和 API 数据流打通。调用图/LLM/搜索是"加厚"，依赖骨架先立住。

---

## 二、关键技术决策

### 决策 1：API 类型——手写对齐 Pydantic，不引入代码生成

**选择**：手写 `web/src/api/types.ts`，逐字段对齐 `engine/src/code_archmage/server/models.py` 的模型（v2 含新增 `CallOut`）。

**否决方案**：openapi-typescript / openapi-fetch / orval 自动生成。

**理由**：
1. 模型简单（SymbolOut / CallOut / ReferenceOut / SearchHitOut / FileContentOut / FileTreeOut / IndexResultOut / IndexStatusOut），手写 < 70 行，引入生成工具链反而更重。
2. "小而美"原则：不为几个类型上代码生成流水线。
3. **契约保护靠 E2E + openapi 断言**（B-5）：Playwright 真实调 API 跑全链路；另在 E2E 里请求 `/openapi.json` 断言关键模型字段名存在，作为一道便宜的漂移保险。纯前端单测无法证伪手写类型与 Pydantic 的一致性，不强求。

### 决策 2：API 客户端——轻量 typed fetch，不用 axios

**选择**：手写 `web/src/api/client.ts`，约 40 行，基于原生 `fetch`，泛型包装返回类型 + `ApiError` 类（带 status）。

**理由**：端点全是 GET + 一个 POST（索引），无需 axios 的拦截器/转换器。原生 fetch 足够。

### 决策 3：状态管理——React Query（服务器状态）+ useState/Context（UI 状态）

**选择**：
- **服务器状态**（文件树、文件内容、符号、调用点、索引状态、健康）：TanStack Query。处理缓存、重试、加载态、stale-while-revalidate。
- **UI 状态**（当前选中文件、选中符号、布局折叠态）：React 内置 `useState` + 一个轻量 `AppContext`。MVP 不引入 Redux/Zustand。

**新增依赖**：`@tanstack/react-query`。

### 决策 4：代码视图——CodeMirror 6 只读 + Python 高亮

**选择**：CodeMirror 6，只读模式（`EditorState.readOnly = true`），启用 `@codemirror/state` + `@codemirror/view` + `@codemirror/lang-python` + 行号 gutter。不装编辑命令。

**符号点击实现钉死一条路（B-6）**：监听编辑器 `click` 事件 → 用 `view.coordsAtPos` / `view.posAtCoords` 反查点击位置 → 得到 `{line, col}` → 匹配 `FileContentOut.calls`（按 line+col）。**不用** ViewPlugin + Decoration 标记 token（更复杂且 jsdom 测不了）。

**新增依赖**：`@codemirror/state`、`@codemirror/view`、`@codemirror/lang-python`。

### 决策 5：文件树——自建轻量树，不用 react-arborist

**选择**：后端返回扁平路径数组（`FileTreeOut.paths`），前端 `buildTree(paths)` 构建嵌套结构，自写 `<FileTree>` 递归渲染 + 折叠/展开。

**理由**：MVP 文件树需求简单，react-arborist 过重。自写约 80 行。大仓库虚拟滚动推迟（阶段 6 性能调优）。

### 决策 6：开发期前后端联调——Vite proxy 同源为主路径（S-2 修正）

**选择**：`vite.config.ts` 加 `server.proxy` + `preview.proxy`，把 `/api` 代理到 `http://127.0.0.1:8765`（或 E2E 用的 8766）。

**S-2 修正**：原方案称"后端 dev_mode CORS 是兜底"是**错误的**——`run_server`（`app.py:77`）从不传 `dev_mode=True`，CORS 中间件永不注册；即使注册，`_DEV_ORIGINS` 只含 5173，不含 preview 的 4173。因此 **proxy 同源是唯一可靠路径**，不依赖 CORS。开发（5173）和 E2E（4173 preview）都走 proxy。

**理由**：
- 开发时前端 5173、后端 8765，proxy 让 `/api/*` 同源转发，绕过 CORS。
- E2E 用 `vite preview`（4173），其 `preview.proxy` 默认继承 `server.proxy`（已向 Vite 官方文档确认），同样同源。
- 生产时（阶段 6）FastAPI 托管前端静态文件，天然同源。

### 决策 7：索引触发时机——手动按钮 + pending 状态机（S-4 修正）

**选择**：前端进入后先查 `GET /api/index/status`，若 `file_count === 0` 显示 EmptyState + 索引按钮；用户点击 → `POST /api/index`。

**S-4 修正**：`POST /api/index` 是**同步阻塞**的（`routes.py:101` await 到索引完成才返回）。第一次点击 pending 期间 React Query 的 `isPending` 即"索引中"——这个状态机必须有红测试：pending → 按钮 disabled + "索引中…"；409（第二次点击被互斥锁拒）→ toast 提示；成功 → `invalidateQueries(['fileTree', 'indexStatus'])` 同时失效两者。

**B-4 修正**：`file_count === 0` 不一定是"未索引"——也可能是索引完成但仓库无 .py 文件（或全被 `_SKIP_DIRS` 跳过）。EmptyState 文案兼容两种情况（"此仓库尚未索引，或索引后无 Python 文件"），按钮语义"索引 / 重新索引"，索引成功后用 `IndexResultOut.files_total` 给出结果反馈（"已索引 N 个文件"）。

**否决自动索引**：索引是 CPU 密集操作，自动触发会让用户困惑。手动触发符合用户心智。索引中互斥锁（阶段 3）防双击。

### 决策 8：最小 CLI 雏形——重写占位 + 新增 __main__.py（S-3 修正）

**选择**：**重写** `engine/src/code_archmage/cli.py`（阶段 0 占位只 print 一行）+ **新增** `engine/src/code_archmage/__main__.py`（委托 `cli.main()`），命令 `python -m code_archmage <repo_path> [--port 8765]`，只起 uvicorn 服务。

**S-3 修正**：原方案写"做最小 cli.py"会让执行者困惑（已存在占位文件，是覆盖还是新建？）；且包内无 `__main__.py`，`python -m code_archmage` 当前以 ModuleNotFoundError 失败。明确为"重写 + 新增 __main__.py"。

**端口与测试（S-4 修正）**：CLI 支持 `--port`，测试用**非默认端口**（如 8766）避免与开发者手动起的后端撞端口；测试后 teardown 关进程。

**阶段 6 完善**：加 `--open` 开浏览器、entry point 打包（`pyproject.toml` 的 `[project.scripts]` 现状留给阶段 6）。

### 决策 9：大文件最低护栏（O-4 新增）

**选择**：CodeView 挂载前检查内容大小，超阈值（**> 2 万行 或 > 1 MB**）时不挂 CodeMirror，降级为提示"文件过大（N 行），已截断显示前 2 万行"+ `<pre>` 截断文本。避免 CodeMirror 全量渲染 10 万行卡死标签页。

**理由**：学生打开真实大仓库是确定场景，廉价护栏防灾难性卡顿。完整虚拟滚动留阶段 6。

### 决策 10：跳定义——调用点匹配 + 名称匹配降级（S-1 核心修正）

**选择**：阶段 4 跳定义分两种触发：

1. **大纲符号点击**（同文件内导航）：点 SymbolOutline 项 → CodeView 滚动到 `symbol.line`。不调 API。
2. **代码内调用点点击**（跨文件跳转，核心价值）：
   - 点击位置 → `{line, col}` → 匹配 `FileContentOut.calls`（按 line+col）
   - **命中且有 `callee_id`**（resolver 已解析）→ 调 `GET /api/symbols/{id}` → 打开目标文件 + 滚动到 line（**O-1：404 则失效该文件缓存 + 重拉 symbols 重试一次，仍失败 toast**）
   - **命中但 `callee_id` 为 None**（未解析，如属性调用 `obj.method()`）→ 调 `GET /api/symbols?name={callee_name}` → 唯一候选直接跳；多候选则 toast"多个候选，留阶段 5 调用图细化"
   - **未命中任何调用点** → 忽略（纯文本点击）

**S-1 修正**：原方案假设"代码内点击符号 → id 来自当前文件大纲"只对定义成立，对调用点（`Calculator()`、`calc.add()`）无解——`Call` 模型无 id，后端无"按文件取调用点"端点。v2 通过 `FileContentOut.calls`（含 resolver 填的 `callee_id`）解决：已解析调用精确跳，未解析调用名称匹配降级，属性调用精确解析留阶段 5。

---

## 三、模块结构

```
web/src/
├── api/                        # API 层（契约消费）
│   ├── types.ts                # 手写 TS 类型，对齐 models.py（含 CallOut）
│   ├── client.ts               # 轻量 typed fetch + ApiError
│   └── endpoints.ts            # 各端点 typed 调用函数
├── hooks/                      # React Query hooks
│   ├── useFileTree.ts          # GET /api/files/tree
│   ├── useFileContent.ts       # GET /api/files/{path}（content + symbols + calls）
│   ├── useIndexStatus.ts       # GET /api/index/status
│   ├── useTriggerIndex.ts      # POST /api/index（mutation，含 pending/409/invalidate）
│   ├── useSymbolDefinition.ts  # GET /api/symbols/{id}（跳定义，含 404 处理）
│   ├── useSymbolCandidates.ts  # GET /api/symbols?name=（名称匹配降级）
│   └── useHealth.ts            # GET /api/health（连通性探测，O-2）
├── components/                 # UI 组件
│   ├── FileTree.tsx            # 文件树（递归 + 折叠，可点击项用 <button>，O-6）
│   ├── CodeView.tsx            # CodeMirror 6 只读 + 大文件护栏（决策 9）+ 点击反查
│   ├── SymbolOutline.tsx       # 当前文件符号大纲（可点击项用 <button>，O-6）
│   ├── Header.tsx              # 顶部状态栏（仓库名 + 索引状态 + 索引按钮 + pending 态）
│   ├── EmptyState.tsx          # 未索引/无 Python 文件空状态（B-4）
│   ├── ErrorState.tsx          # 后端不可用 / 通用错误 UI（O-2/O-3）
│   └── Spinner.tsx             # 加载指示器
├── context/
│   └── AppContext.tsx          # UI 状态：当前选中文件、选中符号
├── test/                       # 测试工具（已存在 setup.ts）
│   ├── setup.ts                # （已有）jest-dom matchers
│   ├── test-utils.tsx          # renderWithQueryClient wrapper
│   └── msw-handlers.ts         # MSW mock handlers
├── lib/
│   └── tree.ts                 # buildTree(paths) 纯函数
├── App.tsx                     # 三区布局组装 + QueryClientProvider + 错误边界
├── main.tsx                    # （已有）
└── index.css                   # 基础样式 + 三区布局 grid
```

```
web/tests/
├── unit/                       # vitest 组件测试（vite.config include）
│   ├── lib/tree.test.ts
│   ├── components/{FileTree,CodeView,SymbolOutline,Header,EmptyState,ErrorState}.test.tsx
│   ├── hooks/{useFileTree,useFileContent,useTriggerIndex,useSymbolDefinition,...}.test.tsx
│   └── App.test.tsx            # 组装测试（MSW mock 全链路）
└── e2e/                        # Playwright（独立跑）
    ├── fixtures/sample_repo/   # 自造小型 Python 项目（~8 文件）
    ├── playwright.config.ts    # webServer 启后端 CLI（uv run --directory）+ vite preview
    └── browse.spec.ts          # 全链路：健康检查→空状态→索引→文件树→打开→大纲→跳定义
```

```
engine/src/code_archmage/
├── cli.py                      # 重写（阶段 6 完善）
├── __main__.py                 # 新增（委托 cli.main）
└── server/models.py            # 加 CallOut + FileContentOut.calls（S-1）
```

---

## 四、UI 布局（阶段 4 范围）

```
┌─────────────────────────────────────────────────────────────┐
│  Header: Code Archmage | <repo_root> | 索引状态 [索引按钮]    │
├──────────────┬──────────────────────────────────────────────┤
│ ① 文件树      │                                              │
│ ② 符号大纲    │     ③ 只读代码视图（CodeMirror 6）             │
│              │       行号 + Python 高亮 + 调用点可点击          │
└──────────────┴──────────────────────────────────────────────┘
```

- **左侧栏**（固定宽，纵向滚动）：上半文件树，下半符号大纲。
- **中间**（自适应）：代码视图。未索引 → EmptyState；后端不可用 → ErrorState；文件过大 → 截断提示。
- **右侧 / 顶部搜索**：阶段 5，本阶段不渲染。

**CSS 策略**：CSS Grid 三区布局，原生 CSS + 少量 class，不引入 Tailwind/CSS-in-JS。

---

## 五、API 契约消费（对接阶段 3 + S-1 扩展）

阶段 4 前端用 7 个端点：

| 端点 | 阶段 4 用途 | 对应 hook |
|------|------------|-----------|
| `GET /api/health` | 连通性探测（O-2）；Playwright webServer 就绪探测 | `useHealth` |
| `GET /api/index/status` | 进入时查状态，决定空状态/文件树 | `useIndexStatus` |
| `POST /api/index` | 手动触发索引（pending/409/invalidate） | `useTriggerIndex` |
| `GET /api/files/tree` | 文件树数据 | `useFileTree` |
| `GET /api/files/{path}` | 打开文件：内容 + 符号大纲 + **调用点**（S-1 扩展） | `useFileContent` |
| `GET /api/symbols/{id}` | 跳定义：取目标符号位置（含 404 处理 O-1） | `useSymbolDefinition` |
| `GET /api/symbols?name=` | 名称匹配降级（未解析调用点） | `useSymbolCandidates` |

阶段 4 **不用**（留给阶段 5）：`/references`、`/callers`、`/callees`、`/search`。

> **S-1 扩展**：`FileContentOut` 增 `calls: list[CallOut]`，`CallOut = {callee_name, callee_id: int|None, line, col}`。`file_content` 路由一并查 `calls` 表（`WHERE file_path=? ORDER BY line,col`）。这是阶段 3 契约的向后兼容扩展（加字段），阶段 3 现有测试不受影响（已核实 `test_files.py` 只断言存在的字段）。

---

## 六、TDD 循环清单（13 个循环）

每个循环：🔴 写失败测试 → 🟢 最小实现通过 → 🔵 重构。

| # | 循环 | 红（失败测试） | 绿（实现） |
|---|------|----------------|------------|
| 1 | **API 类型 + 客户端骨架**（B-5） | `types.ts` 可导入（含 CallOut）；`apiGet<T>` 对 200 返回 JSON、非 200 抛 `ApiError(status)`；`apiPost` 同理。**不测字段对齐**（不可证伪，契约落 E2E + openapi 断言） | `api/{types,client,endpoints}.ts` |
| 2 | **buildTree 纯函数** | 输入 `["a/b.py","a/c.py","d.py"]` → 嵌套树；空数组 → 空树；乱序 → 有序输出 | `lib/tree.ts` |
| 3 | **FileTree 组件** | 渲染文件夹/文件图标 + 名字；点文件夹折叠/展开；点文件触发 `onSelect(path)`；空树 → "无文件"。可点击项为 `<button>`（O-6） | `components/FileTree.tsx` |
| 4 | **CodeView 组件（基础 + 滚动 + 护栏）**（B-6/B-7/O-4 合并） | 输入代码 → 渲染 CodeMirror + 显示文本 + `readOnly` 配置；`scrollToLine(n)` 通过 ref 可调；内容超阈值（>2 万行/1MB）→ 不挂 CM，显示截断提示。**jsdom 只断言文本 + readOnly + 护栏分支**，滚动/点击行为落 E2E | `components/CodeView.tsx` + 装依赖 |
| 5 | **SymbolOutline 组件** | 输入 symbols → 渲染列表（名字 + kind）；点符号触发 `onSelect(symbol)`；空 → "无符号"。可点击项为 `<button>`（O-6） | `components/SymbolOutline.tsx` |
| 6 | **React Query hooks（查询 + 错误分支）**（O-3） | `useFileTree`/`useFileContent`/`useIndexStatus`/`useHealth` mock 成功路径 → 返回数据；**补错误分支**：文件 404、后端不可用（fetch reject）、503 → error 态可断言（MSW） | `hooks/*.ts` + `test/test-utils.tsx` + MSW |
| 7 | **触发索引 mutation**（S-4） | `useTriggerIndex`：POST pending 期间 `isPending` 为 true；409 → error 态；成功 → `invalidateQueries(['fileTree','indexStatus'])` 被 spy 证实同时失效两者 | `hooks/useTriggerIndex.ts` |
| 8 | **引擎侧：FileContentOut.calls + CallOut**（S-1 新增） | `GET /api/files/a.py` 返回含 `calls`（callee_name/callee_id/line/col）；`CallOut` 模型定义；file_content 路由查 calls 表。回归阶段 3 test_files.py 全绿 | `server/models.py` + `server/routes.py` |
| 9 | **Header + EmptyState + ErrorState**（B-4/O-2） | Header 显示 repo_root + 索引状态 + 按钮；pending → disabled + "索引中…"；EmptyState 文案兼容"未索引/无 .py"；ErrorState 后端不可用时显示"无法连接后端" | `components/{Header,EmptyState,ErrorState}.tsx` |
| 10 | **App 组装 + 选文件 + 大纲滚动**（B-7 拆分 10a） | App 三区布局；选文件 → CodeView + SymbolOutline 加载；点大纲符号 → CodeView.scrollToLine(symbol.line)（MSW mock 全链路）；后端不可用 → ErrorState | `App.tsx` + `context/AppContext.tsx` |
| 11 | **跳定义交互**（B-7 拆分 10b + O-1） | 点代码内调用点（mock calls 数据）→ 命中有 callee_id → 调 symbols/{id} → 打开目标文件 + 滚动；**404 → 失效缓存 + 重试 + toast**；callee_id None → symbols?name= 降级；多候选 → toast | CodeView 点击处理 + `useSymbolDefinition`/`useSymbolCandidates` |
| 12 | **最小 CLI 雏形 + __main__.py**（S-3/S-4） | `cli.py` 接收 repo_path + `--port` → 起 uvicorn 绑 127.0.0.1；无参数 → 友好错误退出；`--help` 显示用法；`python -m code_archmage` 可跑（__main__.py）。测试用非默认端口 + teardown | `engine/src/code_archmage/{cli.py,__main__.py}` |
| 13 | **E2E 全链路**（S-2/B-1/B-2/O-2） | 真实启后端（`uv run --directory engine python -m code_archmage fixtures/sample_repo --port 8766`，webServer 用 `/api/health` 探测就绪）+ 前端（`vite preview --port 4173`，preview.proxy 继承 /api→8766）；**每次先删 `.code_archmage_index/`**（B-2）；流程：空状态→索引→文件树→打开→大纲→点调用点→跳定义。E2E 末尾请求 `/openapi.json` 断言关键模型字段（B-5 契约保险） | `tests/e2e/` 全套 + sample_repo fixtures |

---

## 七、测试策略

### 测试金字塔（阶段 4）

```
        / E2E \              1 条（全链路，Playwright，零 mock）
       /--------\
      /  集成    \           App 组装测试（MSW mock API）
     /------------\
    /   单元测试    \         组件 + hooks + 纯函数（vitest + RTL）
   /----------------\
```

### Mock 边界（遵循 dev_workflow 7.2）

- **组件单元测试**：MSW 拦截 fetch，返回固定 JSON。不真实调后端。
- **hooks 测试**：MSW 拦截，测 React Query 的 loading/success/error/缓存失效。**补错误分支**（O-3）：404/503/fetch reject。
- **App 组装测试**：MSW mock 全部端点，测组件协作 + 数据流。
- **E2E**：**零 mock**，真实后端 + 真实前端 + 真实 SQLite。

### MSW 引入

**新增 dev 依赖**：`msw`。单元/集成测试用 MSW 拦截 fetch。

### CodeMirror 测试现实（B-6）

jsdom 无布局引擎，`scrollTop`、`coordsAtPos`、行可见性断言不可靠。**循环 4 只断言**：内容文本渲染 + `readOnly` 配置 + 大文件护栏分支。**滚动 + 点击反查行为断言全部移到 E2E**（循环 13）。

### E2E fixtures：自造 sample_repo

在 `web/tests/e2e/fixtures/sample_repo/` 放**自造小型 Python 项目**（约 8 文件，无隐私问题），覆盖：函数/类/方法/继承、函数调用/方法调用/跨文件调用。候选结构（循环 13 落地）：
```
sample_repo/
├── README.md
├── main.py           # 入口：from calculator import Calculator; 调用
├── calculator.py     # Calculator 类 + add/subtract 方法
├── models.py         # 数据类（bases 继承）
├── utils.py          # 工具函数，被调用
└── operations.py     # 运算函数，被 calculator 调用
```
**绝不使用真实私有代码**（dev_workflow 5.2）。

### E2E 启动（S-2/B-1/B-2/O-2）

`playwright.config.ts` 的两个 `webServer`：
1. **后端**：`uv run --directory engine python -m code_archmage ../web/tests/e2e/fixtures/sample_repo --port 8766`（B-1：`--directory` 不依赖 cwd；前置 `uv sync`）。`webServer` 用 `url: http://127.0.0.1:8766/api/health` 探测就绪（O-2）。
2. **前端**：`pnpm build && pnpm preview --port 4173`（preview.proxy 继承 server.proxy，/api→8766 同源，S-2）。

**状态隔离（B-2）**：`globalSetup` 或 webServer command 前置 `rm -rf web/tests/e2e/fixtures/sample_repo/.code_archmage_index/`，保证每次从空态开始（该目录已被根 .gitignore 覆盖）。

### 覆盖率目标

- 组件/hooks 单元测试覆盖率 ≥ 70%（dev_workflow 门禁）
- 不为凑覆盖率写无断言测试
- E2E 不计覆盖率，只验证关键路径

---

## 八、依赖变更

### 新增运行时依赖（web）

```json
{
  "@tanstack/react-query": "^5.x",
  "@codemirror/state": "^6.x",
  "@codemirror/view": "^6.x",
  "@codemirror/lang-python": "^6.x"
}
```

### 新增开发依赖（web）

```json
{
  "msw": "^2.x"
}
```

### 引擎无新依赖

阶段 4 不动引擎依赖。**但新增 1 个 Pydantic 模型（`CallOut`）+ `FileContentOut` 增 1 字段（`calls`）**（S-1），属阶段 3 契约的向后兼容扩展，非新依赖。

### 不引入（明确排除）

- ❌ axios（原生 fetch）
- ❌ openapi-typescript / openapi-fetch / orval（手写类型）
- ❌ react-arborist（自建文件树）
- ❌ Tailwind / styled-components / emotion（原生 CSS）
- ❌ Redux / Zustand（React Query + Context）
- ❌ react-router（单页面无路由）

---

## 九、验收标准

1. **三区布局可用**：文件树 + 符号大纲 + 代码视图正确渲染。
2. **最小闭环跑通**：进入 →（空状态）→ 索引 → 文件树 → 点文件 → 见代码 + 大纲 → 点大纲符号 → 代码滚动到行 → **点代码内调用点 → 跳到目标文件定义处**（S-1）。
3. **7 个 API 端点正确消费**（health、index/status、index POST、files/tree、files/{path} 含 calls、symbols/{id}、symbols?name=）。
4. **E2E 全链路绿**（Playwright，真实后端 + sample_repo，preview+proxy 同源）。
5. **单元/集成测试全绿**，组件/hooks 覆盖率 ≥ 70%，含错误分支（404/503/不可用）。
6. **质量门禁**：`oxlint` + `tsc --noEmit`（strict）+ `prettier --check` + `vitest run` 全绿；引擎侧 `ruff` + `mypy --strict`（CLI + CallOut）全绿 + 阶段 3 测试回归全绿。
7. **未索引/无 Python 文件空状态**：不崩溃，EmptyState 文案兼容两种情况（B-4）。
8. **索引中状态机**：pending → 按钮禁用 + "索引中…"；409 → toast；成功 → fileTree + indexStatus 同时刷新（S-4，有红测试）。
9. **只读保证**：代码视图不可编辑。
10. **大文件护栏**：>2 万行/1MB 降级截断，不卡死（O-4）。
11. **后端不可用态**：显示 ErrorState"无法连接后端"，不各组件各自崩（O-2）。
12. **安全（O-5）**：文件内容、符号名、signature 一律以文本入 DOM，**禁用 `dangerouslySetInnerHTML`**，进代码审查清单。
13. **a11y 最低线（O-6）**：文件树/大纲可点击项为 `<button>`，CodeMirror 可聚焦。
14. **隐私**：E2E fixtures 全自造，无真实代码；不引入任何上传/云端交互。

---

## 十、不做清单（阶段 4 明确排除）

- 全局搜索 UI → 阶段 5
- 调用图面板（react-flow）→ 阶段 5
- LLM 对话 + 上下文组装 → 阶段 5
- 惰性摘要 → 阶段 5
- 剥洋葱 → 阶段 5
- 引用/调用者/被调用者面板 → 阶段 5
- **属性调用 `obj.method()` 精确跳转** → 阶段 5（阶段 4 名称匹配降级）
- 一键启动开浏览器 + 打包 → 阶段 6
- 文件监听自动重索引 → 未来
- **大仓库虚拟滚动** → 阶段 6（阶段 4 加 >2 万行截断护栏，O-4）
- 主题/字体偏好 → 二期
- 多标签页 / 多文件同时打开 → 二期
- 键盘快捷键（除 CodeMirror 自带）→ 二期
- 最近打开文件历史 → 二期
- 非 .py 文件支持 → MVP 仅 Python
- 移动端响应式 → 桌面优先（Tauri 壳）

---

## 附录：cc 审核反馈与修订对照表（task `7b7e0673e102`）

### 严重问题（全部采纳）

| 编号 | 问题 | 修订处置 |
|------|------|----------|
| **S-1** | 调用点跳定义在现有 API 下无解（Call 无 id，无按文件取调用点端点） | **决策 10 + 循环 8**：FileContentOut 增 calls 字段 + CallOut 模型（resolver 已填 callee_id）；已解析调用精确跳，未解析名称匹配降级，属性调用留阶段 5 |
| **S-2** | E2E CORS 前提不成立（run_server 不传 dev_mode，_DEV_ORIGINS 只 5173） | **决策 6 + 循环 13**：proxy 同源为唯一主路径；E2E 钉死 preview+proxy，删 dev server 路径；修正决策 6 错误理由 |
| **S-3** | cli.py 已是占位，无 __main__.py，python -m 跑不起来 | **决策 8 + 循环 12**：明确"重写 cli.py + 新增 __main__.py" |
| **S-4** | 验收 8 无测试证明；循环 11 撞默认端口 | **决策 7/8 + 循环 7/12**：循环 7 补 pending/409/invalidate 三条红测试；CLI/测试用非默认端口 + teardown |

### 建议（全部采纳）

| 编号 | 问题 | 修订处置 |
|------|------|----------|
| **B-1** | E2E 后端命令缺可复现前提 | 循环 13：`uv run --directory engine` + 注明 uv sync 前置 |
| **B-2** | E2E 状态隔离（二次跑库非空） | 循环 13：globalSetup 删 `.code_archmage_index/` |
| **B-3** | 端点计数错误（表 5 正文 6） | §五改为 7 端点（含 health/calls 扩展/symbols?name=），表与正文一致 |
| **B-4** | file_count===0 ≠ 未索引 | 决策 7 + 循环 9：EmptyState 文案兼容，用 files_total 反馈 |
| **B-5** | 循环 1 字段对齐不可证伪 | 循环 1：改为类型可导入 + client 行为；契约落 E2E + openapi 断言 |
| **B-6** | CodeMirror 测试不匹配 jsdom | 决策 4 + 循环 4：jsdom 只断言文本/readOnly/护栏；滚动点击落 E2E；点击钉死 coordsAtPos 反查 |
| **B-7** | 循环粒度（5 可并入 4，10 过大） | 循环 4 合并滚动；循环 10 拆 10a（组装+大纲滚动）/10b（跳定义） |

### 遗漏（全部采纳）

| 编号 | 问题 | 修订处置 |
|------|------|----------|
| **O-1** | 符号 id 跨索引不稳定，404 无处理 | 决策 10 + 循环 11：404 失效缓存 + 重拉重试 + toast |
| **O-2** | 后端未启动/未就绪态 | 决策 + 循环 6/9/13：health 移回用清单；ErrorState；webServer 用 health 探测 |
| **O-3** | 错误分支测试缺失 | 循环 6：补 404/503/fetch reject 错误态测试 |
| **O-4** | 大文件最低护栏 | 决策 9 + 循环 4：>2 万行/1MB 降级截断 |
| **O-5** | 安全声明缺失 | 验收 12：禁用 dangerouslySetInnerHTML |
| **O-6** | a11y 最低线 | 验收 13 + 循环 3/5：可点击项用 button，CM 可聚焦 |
