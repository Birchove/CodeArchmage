# 阶段 5：全局搜索 + 局部调用图 + 剥洋葱

> **状态**：草案 v2（已采纳 cc 审核反馈：S-1 至 S-4 + 6 条建议 + 4 个开放问题决策）
> **前置**：阶段 4 已完成（前端垂直切片：索引→文件树→代码视图→符号大纲→跳定义）
> **后端**：本阶段 **零引擎改动**，全部消费阶段 3 已就绪的 API

---

## 1. 概述

### 1.1 目标

为「关系探索」补齐前端闭环——让用户能：

1. **全局搜索**：按符号名快速定位（FTS5 后端已就绪）
2. **局部调用图**：选中符号后可视化其上下游 1 层调用关系
3. **剥洋葱**：把从入口到当前符号的调用链展平成线性栈，解决「封装套封装不知其用」

这三个功能构成「找到目标 → 看关系 → 理解调用链」的完整探索路径。

### 1.2 阶段拆分理由

原 dev_workflow 将「搜索 / 调用图 / LLM / 摘要 / 剥洋葱」全放在阶段 5。实际拆为：

| 阶段 | 范围 | 理由 |
|------|------|------|
| **5（本方案）** | 搜索 + 调用图 + 剥洋葱 | 后端 API 全就绪，不依赖 LLM，聚焦「关系探索」 |
| **6（下一阶段）** | LLM 对话 + 确定性上下文组装 + 惰性摘要 | 需引擎扩展 LLM 网关（key 管理 / 流式 / 多供应商），复杂度高 |
| **7** | 发布准备（原阶段 6） | Tauri 壳 / 打包 / 文档 |

拆分好处：方案可审核性高、单阶段复杂度可控、先磨「放大镜」再加「家教」。

### 1.3 核心数字

- **TDD 循环**：14 个（搜索 5 + 调用图 5 + 剥洋葱 4）
- **新增依赖**：`@xyflow/react`（react-flow 更名后的包）
- **引擎改动**：0（纯前端阶段）
- **新增前端文件**：4 组件 + 4 hooks + 2 纯函数模块 = 10 个源文件
- **新增测试文件**：8 个（放 `web/tests/unit/`，沿用阶段 4 惯例）

---

## 2. 关键技术决策

### 2.1 搜索框位置：Header 内嵌

搜索是全局操作，不属于某个文件。放在 Header 的索引按钮左侧，结果以浮层下拉展示（不占布局空间），点击跳转后自动关闭。

```
┌──────────────────────────────────────────────────────────┐
│ Code Archmage | /path/to/repo | [🔍 搜索____] [索引]    │
├──────────────────────────────────────────────────────────┤
│                |                    |                    │
│   文件树       |    代码视图        |   调用图/剥洋葱    │
│   符号大纲     |                    |                    │
│                |                    |                    │
└──────────────────────────────────────────────────────────┘
```

### 2.2 右侧面板：320px 固定宽，双标签页

新增 `app-aside`（320px），含两个标签页：

- **调用图**：react-flow 可视化，中心 = 当前符号，左列 = callers，右列 = callees
- **剥洋葱**：线性调用链栈，从入口到当前符号的所有路径

标签页切换不销毁数据（保持各组件 state）。

**折叠实现**（cc 建议 B-2）：react-flow 对容器尺寸敏感（`display:none` 后展开实例测量为 0）。采用「折叠保持挂载 + `visibility:hidden` + `width:0` + 展开时触发 `fitView`」方案，避免重新挂载。

### 2.3 调用图布局：三列手动定位（不用 dagre）

默认 1 层关系，callers 等距排在左列（x=0），当前符号居中（x=1），callees 等距排在右列（x=2）。不引入 dagre / elkjs 自动布局依赖——MVP 只做 1 层，手动定位足够清晰。

点击节点 → 跳转到该符号（**复用 `useJumpToDefinition` hook**，收掉阶段 4 留下的「多候选 → 留阶段 5 调用图细化」尾巴）。

**节点视觉**（cc Q3 决策）：不按符号类型着色（`SymbolKind` 只有 function / class / variable 三种，区分度低）。改为**区分边的精确性**：已解析 `callee_id` 的边用实线，按名多候选的边用虚线——直接对应引擎的诚实性原则，帮用户理解「这条边可能不准」。

### 2.4 剥洋葱实现：前端递归 callers，硬限制防爆炸

后端 callers API 只返回 1 跳。剥洋葱需要多跳（从入口到当前符号的完整链路）。决策：**前端递归调 callers API**，设三重限制：

| 限制 | 值 | 理由 |
|------|----|------|
| 最大深度 | 5 层 | 绝大多数调用链 ≤ 5 层 |
| 每层最大宽度 | 10 个 | 后端 callers 已 `ORDER BY file_path, line`，前端直接取前 10，不二次排序（cc 建议 B-5） |
| 总节点上限 | 50 个 | 超出截断并提示「链路过长，已截断」 |

纯函数 `flattenCallChain` 负责递归逻辑 + 限制，可独立单元测试。

**请求数估算**（cc 建议 B-6 修正）：最坏情况 1 + 10 + 10×10 = **111 次请求**（每个节点单独查一次 callers，总数 50 限的是节点不是请求）。本地场景可接受。已查节点缓存（按 symbol_id 索引）可大幅减少实际请求数。

### 2.5 选中符号状态：`selectedSymbol` + 统一回调

新增全局状态 `selectedSymbol: SymbolOut | null`，作为右侧面板的数据源。

**统一回调**（cc Q2 决策）：在 App 内收敛为单一 `selectSymbol(sym, { scroll })` 分发器，避免 4 个设置入口的行为漂移：

| 触发源 | 行为 |
|--------|------|
| SymbolOutline 点击符号 | `selectSymbol(sym, { scroll: true })` |
| 跳定义成功 | `selectSymbol(targetSym, { scroll: true })` |
| 搜索结果点击 | `selectSymbol(hit, { scroll: true })` |
| 调用图 / 剥洋葱节点点击 | `selectSymbol(nodeSym, { scroll: true })` |

**reindex 陈旧化策略**（cc S-3 修复）：符号 id 跨 reindex 不稳定（SQLite rowid 重排）。`useTriggerIndex.onSuccess` 改为 `queryClient.clear()`（清空全部缓存），同时 `setSelectedSymbol(null)`（清空选中）。洋葱缓存的 key 基于 symbol_id，随 clear 一起失效。

### 2.6 引擎调用关系的已知不精确性（cc S-2 修复）

> **核心认知**：阶段 3 的 callers / callees API 建立在**名字匹配**上，不是调用边精确指向。方案必须对此诚实，UI 必须标注。

| 场景 | 引擎行为 | 对功能的影响 | UI 应对 |
|------|----------|-------------|---------|
| **同名函数** | callers `WHERE callee_name = ?` → 所有同名定义的调用者合并 | 调用图 callers 串线；剥洋葱可能展平出交叉污染的假链 | 虚线边框标注「按名匹配」；剥洋葱截断提示 |
| **方法符号** | `calc.add(1,2)` 的 `callee_name` 记 `"add"`，不含类名 | 搜 `add` 命中所有类的 `add` 方法；callers 把所有调用 `add` 的位置合并 | 调用图节点显示 `类名.方法名`（从 file_path + line 反查）；剥洋葱对方法符号可能展平出宽泛链 |
| **callee_id 为 NULL** | `resolve_callees` 只在「全库唯一同名」时填 callee_id | callees 大量返回「所有同名候选」而非「实际被调用的那个」 | 虚线边框区分「精确解析」与「多候选」 |

**TDD 红测试必须覆盖**（循环 10）：
- 同名符号的 callers 合并行为
- 方法符号 callers 的按名匹配行为
- 自环跳过（A 调 A）

---

## 3. UI 布局变化

### 3.1 CSS Grid 变更

```css
/* 阶段 4 */
.app-body { grid-template-columns: 280px 1fr; }

/* 阶段 5 */
.app-body { grid-template-columns: 280px 1fr 320px; }
/* 折叠时 */
.app-body.aside-collapsed { grid-template-columns: 280px 1fr; }
```

### 3.2 搜索浮层

```
┌─────────────────────┐
│ 🔍 add_________  ↓  │  ← Header 内搜索框
├─────────────────────┤
│ func add()          │  ← 浮层结果（absolute 定位）
│   calculator.py:9   │
└─────────────────────┘
```

**搜索语义**（cc S-1 修复）：后端 FTS5 用 `unicode61` tokenizer 做 **phrase 匹配**（整词），同时搜索 `name` + `file_path` 两列。这意味着：

- 搜 `add` → 命中符号名 token 为 `add` 的符号（如 `Calculator.add`），**不**命中 `add_numbers`（不同 token）
- 搜 `Calculator` → 命中 `Calculator` 类 + `calculator.py` 文件内的所有符号（file_path 也参与匹配）
- **不是子串搜索**。用户需输入完整符号名或文件名的一部分（整词）

交互细节：
- 防抖 300ms 后触发搜索
- 显式传 `limit=20`（cc 建议 B-1，后端默认 200）
- 最多显示 20 条
- 键盘导航：↑↓ 选择，Enter 跳转，Esc 关闭
- 点击外部关闭
- **空索引时禁用**（cc Q4 决策）：复用 `isIndexed`（`file_count > 0`），tooltip「请先索引」

### 3.3 调用图面板

```
┌──── 调用图 / 剥洋葱 ────┐
│  [调用图] [剥洋葱]     │  ← 标签页
├────────────────────────┤
│                        │
│  ┌─────┐   ┌─────┐    │
│  │call │   │ main│    │  ← callers (左列)
│  │er_1 │──→│     │    │  实线 = 精确解析
│  └─────┘   └──┬──┘    │
│               │        │
│  ┌─────┐     │        │
│  │call │···→┤process├──→ validate │  ← 虚线 = 按名多候选
│  │er_2 │     │     │   └──────┘    │
│  └─────┘     └─────┘               │
│                                    │
│  ⚠ 部分调用关系按名匹配，可能不准  │  ← 诚实提示
└────────────────────────────────────┘
```

### 3.4 剥洋葱面板

```
┌──── 调用图 / 剥洋葱 ────┐
│  [调用图] [剥洋葱]     │
├────────────────────────┤
│  路径 1（5 层）:       │
│  main()                │
│    ↓                   │
│  handle_request()      │
│    ↓                   │
│  process_data()        │
│    ↓                   │
│  validate()            │
│    ↓                   │
│  ● check_type()  ← 当前│
│                        │
│  路径 2（3 层）:       │
│  cli_run()             │
│    ↓                   │
│  ...                   │
│                        │
│  ⚠ 按名匹配，同名符号  │
│    可能交叉            │  ← 诚实提示
└────────────────────────┘
```

---

## 4. 模块结构

### 4.1 新增文件

```
web/src/
├── components/
│   ├── SearchBar.tsx          # 搜索框 + 浮层结果
│   ├── CallGraph.tsx          # react-flow 调用图
│   ├── OnionView.tsx          # 剥洋葱线性栈
│   └── SidePanel.tsx          # 右侧面板（标签页容器）
├── hooks/
│   ├── useSearch.ts           # 搜索（防抖 + TanStack Query）
│   ├── useCallers.ts          # 查 callers
│   ├── useCallees.ts          # 查 callees
│   └── useCallChain.ts        # 剥洋葱递归查调用链
├── lib/
│   ├── callgraph.ts           # buildCallGraph 纯函数（节点+边）
│   └── onion.ts               # flattenCallChain 纯函数（递归+限制）

web/tests/unit/                 # ← 沿用阶段 4 惯例（cc S-4 修复）
├── SearchBar.test.tsx
├── CallGraph.test.tsx
├── OnionView.test.tsx
├── SidePanel.test.tsx
├── useSearch.test.ts
├── useCallChain.test.ts
├── callgraph.test.ts
└── onion.test.ts
```

### 4.2 修改文件

| 文件 | 改动 |
|------|------|
| `App.tsx` | 新增 selectedSymbol 状态 + selectSymbol 统一回调；右侧面板；搜索框；布局三列 |
| `Header.tsx` | 嵌入 SearchBar |
| `SymbolOutline.tsx` | 点击符号时额外回调 onSelectSymbol |
| `index.css` | 三列布局、搜索浮层、调用图、剥洋葱样式 |
| `api/endpoints.ts` | 新增 searchSymbols(limit=20) / fetchCallers / fetchCallees 封装 |
| `useTriggerIndex.ts` | onSuccess 改为 `queryClient.clear()`（cc S-3 修复） |
| `useJumpToDefinition.ts` | 多候选时触发 selectSymbol 展示调用图（收掉尾巴） |

### 4.3 删除文件

| 文件 | 理由 |
|------|------|
| `web/src/context/`（空目录） | 阶段 4 遗留死目录（cc Q2 指出），本阶段不引入 Context，删除避免误导 |

---

## 5. API 契约（全部已就绪）

| 端点 | 用途 | 阶段 5 消费方 | 备注 |
|------|------|---------------|------|
| `GET /api/search?q=&limit=20` | FTS5 整词搜索 | SearchBar | **显式传 limit=20**（cc B-1） |
| `GET /api/symbols/{id}/callers` | 直接调用者（按名匹配） | CallGraph + OnionView | 语义见 §2.6 |
| `GET /api/symbols/{id}/callees` | 直接被调用者（含多候选） | CallGraph | 语义见 §2.6 |
| `GET /api/symbols?name=` | 按名称查符号 | OnionView 降级 / 跳定义多候选 | — |

**零引擎改动**。所有端点在阶段 3 已实现并有测试覆盖。

---

## 6. TDD 循环清单（14 个）

### 搜索（循环 1-5）

| # | 红 | 绿 | 重构 |
|---|----|----|------|
| 1 | `useSearch` 输入关键词 → 返回 SearchHit[]；空输入不查 | TanStack Query + 防抖 300ms + MSW mock | — |
| 2 | `SearchBar` 渲染输入框，输入后触发 onSearch；空索引时禁用 | 受控输入 + 防抖 + 浮层定位 + disabled 状态 | — |
| 3 | `SearchBar` 键盘导航 ↑↓ Enter Esc + 点击外部关闭 | keydown 处理 + useRef outside click | — |
| 4 | Header 集成搜索 → App 接入 SearchBar + onResultSelect → selectSymbol | App 接线 | — |
| 5 | **E2E**：搜索 `add` → 浮层显示 `Calculator.add` → 点击 → 跳转 calculator.py + 调用图显示 | Playwright | — |

### 调用图（循环 6-10）

| # | 红 | 绿 | 重构 |
|---|----|----|------|
| 6 | `useCallers` / `useCallees` 输入 symbolId → 返回 SymbolOut[] | TanStack Query + MSW mock | — |
| 7 | `buildCallGraph(center, callers, callees)` → { nodes, edges }；边区分实线/虚线 | 纯函数：三列定位 + 边类型 | — |
| 8 | `CallGraph` 渲染 react-flow，中心高亮，虚线边标注 | @xyflow/react 集成 + 节点/边类型 | — |
| 9 | 点击节点 → 触发 onNodeSelect(symbol) → 复用 useJumpToDefinition | react-flow onNodeClick | — |
| 10 | `SidePanel` 标签页切换 + App 集成右侧面板 + reindex 清空 | 标签页 state + 三列布局 + queryClient.clear() | — |

### 剥洋葱（循环 11-14）

| # | 红 | 绿 | 重构 |
|---|----|----|------|
| 11 | `flattenCallChain` 纯函数：输入 callers 映射 → 输出路径[]；含深度/宽度/总数限制；**覆盖同名合并 + 方法符号 + 自环** | 递归展平 + 截断逻辑 | — |
| 12 | `useCallChain` 输入 symbolId → 递归调 callers → 返回路径[]；缓存已查节点 | 递归 fetch + 缓存 + 硬限制 | — |
| 13 | `OnionView` 渲染线性栈，当前符号高亮，截断提示，诚实文案 | 路径列表 + 缩进 + 点击跳转 | — |
| 14 | **E2E**：选中 `add_numbers` → 切换剥洋葱 → 看到调用链（main → Calculator.add → add_numbers）→ 点击节点跳转 | Playwright | — |

---

## 7. 测试策略

### 7.1 单元测试（vitest + MSW）

| 模块 | 测试重点 |
|------|----------|
| `useSearch` | 防抖触发、空输入不查、limit=20 传参、错误处理 |
| `useCallers/useCallees` | 正常返回、symbol_id 无效（404） |
| `useCallChain` | 递归正确性、深度截断、宽度截断、总数截断、循环引用防护、缓存命中 |
| `buildCallGraph` | 节点定位、边方向、空 callers/callees、**实线/虚线边区分** |
| `flattenCallChain` | 单路径、多路径、深度限制、宽度限制、总数限制、**同名合并**、**方法符号按名**、**自环跳过** |

### 7.2 组件测试（vitest + testing-library）

| 组件 | 测试重点 |
|------|----------|
| `SearchBar` | 输入触发、结果渲染、键盘导航、外部点击关闭、**空索引禁用** |
| `CallGraph` | 节点数量、中心高亮、节点点击回调、**虚线边存在** |
| `OnionView` | 路径渲染、当前符号高亮、截断提示、节点点击、**诚实文案存在** |
| `SidePanel` | 标签页切换、空状态 |

### 7.3 E2E（Playwright，真实后端 + 前端零 mock）

新增 2 条 E2E（cc S-1 修复：搜索词改为 fixture 上确定命中的）：

1. **搜索 → 跳转 → 调用图**：打开应用 → 索引 → 搜索框输入 `add` → 浮层显示 `Calculator.add`（calculator.py:9）→ 点击 → 跳转到 calculator.py + 右侧调用图显示 callers（`main`）和 callees（`add_numbers`）
2. **剥洋葱**：选中 `add_numbers` → 切换到剥洋葱标签 → 看到调用链 `main → Calculator.add → add_numbers` → 点击 `main` 节点 → 跳转到 main.py

---

## 8. 依赖变更

### 8.1 新增

```json
{
  "@xyflow/react": "^12.x"  // react-flow，调用图渲染
}
```

### 8.2 不新增

- ~~dagre / elkjs~~：手动三列定位，不需要自动布局
- ~~zustand / jotai~~：selectedSymbol 用 useState + 统一回调足够（cc Q2 决策）

---

## 9. 验收标准

### 9.1 功能验收

- [ ] Header 搜索框输入关键词（防抖 300ms）→ 浮层显示结果（整词匹配）
- [ ] 搜索显式传 limit=20，最多显示 20 条
- [ ] 空索引时搜索框禁用 + tooltip「请先索引」
- [ ] 点击搜索结果 → 打开文件 + 滚动到符号行 + 设置 selectedSymbol
- [ ] 搜索键盘导航：↑↓ Enter Esc 均生效
- [ ] 选中符号 → 右侧调用图显示 callers（左）+ 当前（中）+ callees（右）
- [ ] 调用图边区分实线（精确解析）/ 虚线（按名多候选）
- [ ] 点击调用图节点 → 跳转到该符号（复用 useJumpToDefinition）
- [ ] 切换到剥洋葱标签 → 显示从入口到当前符号的调用链
- [ ] 调用链超过限制 → 显示截断提示
- [ ] 剥洋葱/调用图显示诚实文案「按名匹配，可能不准」
- [ ] 点击剥洋葱链中节点 → 跳转
- [ ] 右侧面板可折叠（保持挂载 + visibility 控制）
- [ ] reindex 后 selectedSymbol 清空 + 全部缓存失效

### 9.2 质量门禁

- [ ] `pnpm test`：所有 vitest 通过，前端覆盖率 ≥ **70%**（cc B-3：与 dev_workflow §6.4 对齐）
- [ ] `pnpm test:e2e`：Playwright 全部通过（含新增 2 条）
- [ ] `pnpm build`：tsc strict 零错误
- [ ] `pnpm lint`：prettier 零格式问题
- [ ] 引擎无改动，`pytest` / `ruff` / `mypy` 保持绿

### 9.3 代码质量

- [ ] 纯函数（buildCallGraph / flattenCallChain）分支全覆盖（cc B-3：务实标准）
- [ ] 无 any 类型逃逸
- [ ] 无 console.log 残留
- [ ] `web/src/context/` 空目录已删除

---

## 10. 不做清单

- LLM 对话 / 惰性摘要（阶段 6）
- 调用图多层折叠 / 缩放 / 拖拽（MVP 只做 1 层 + 点击跳转）
- 搜索高亮匹配片段 / 正则搜索 / 模糊匹配 / **前缀匹配**（FTS5 整词匹配，不做子串/前缀）
- 搜索历史 / 书签
- 调用图导出图片
- 剥洋葱的「模块卡片」（依赖 LLM 摘要，阶段 6）
- 右侧面板拖拽调宽
- 后端多跳调用链端点（cc Q1 决策：阶段 5 前端递归；若阶段 6 LLM 组装也需多跳，再统一加 `GET /api/symbols/{id}/call-chain?depth=N`）

---

## 11. 风险与缓解

### 11.1 已识别风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| react-flow 包更名（reactflow → @xyflow/react） | 依赖安装 | 锁定 ^12.x，验证 API 兼容 |
| 剥洋葱递归请求数 | 性能（最坏 111 次） | 深度 5 / 宽度 10 / 总数 50 硬限制 + 已查节点缓存 |
| 调用图节点过多（callers + callees > 20） | UI 拥挤 | 节点超过 15 个时显示「+N more」折叠 |
| 搜索浮层 z-index 与 CodeMirror 冲突 | 视觉 | 浮层 z-index: 100，测试验证 |
| **callers/callees 按名匹配不精确**（cc S-2） | 调用图/剥洋葱展示假关系 | §2.6 详述 + 虚线边框 + 诚实文案 + TDD 红测试覆盖 |
| **reindex 后符号 id 失效**（cc S-3） | 调用图 404 / 陈旧缓存 | `queryClient.clear()` + 清空 selectedSymbol |
| **FTS5 搜索同时匹配 file_path**（cc S-1） | 搜文件名命中该文件所有符号 | 整词匹配语义已明确；UI 不额外处理（后端行为） |

### 11.2 已决策问题（cc 审核反馈归纳）

| 问题 | 决策 | 依据 |
|------|------|------|
| 剥洋葱是否需后端多跳端点？ | **阶段 5 前端递归**；阶段 6 若 LLM 组装也需，统一加后端端点 | cc Q1：避免两阶段重复实现；记入本方案 §10 |
| selectedSymbol 状态管理？ | **useState + 统一 selectSymbol 回调**；删空 context/ 目录 | cc Q2：prop drilling 可控；4 入口收敛防漂移 |
| 调用图节点视觉？ | **虚线边框区分精确/候选边**，不按类型着色 | cc Q3：SymbolKind 只有 3 种；精确性区分更有价值 |
| 空索引搜索行为？ | **禁用 + tooltip**，复用 isIndexed | cc Q4：空库搜索不返 400，禁用理由是「无数据可搜」 |

---

## 12. 执行检查清单

- [x] cc 审核完成（4 严重 + 6 建议 + 4 开放问题 → 全部修订）
- [ ] 用户批准
- [ ] 14 个 TDD 循环逐一执行（红绿重构）
- [ ] cc 验收 + 修复全部反馈
- [ ] 用户验收
- [ ] push
