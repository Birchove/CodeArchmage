# 阶段 6：LLM 对话 + 确定性上下文组装 + 惰性摘要

> **状态**：草案 v2（cc 审核后修订）
> **前置**：阶段 5 已完成（搜索 + 调用图 + 剥洋葱）
> **后端**：本阶段 **需引擎扩展**——新增 LLM 网关模块 + 4 个 API 端点
>
> **v2 修订摘要**（cc 审核反馈，5 严重 + 5 盲点）：
> - **S-1**：上下文绑定语义改为「切换符号 = 开新对话」，对话状态提升到 App 层
> - **S-2**：新增 `GET /api/llm/config` 让前端感知配置状态
> - **S-3**：`.env` 加载链路从零搭建——`load_config(env_path)` 纯函数 + `create_app(llm_config)` 参数
> - **S-4**：SSE 代理缓冲——后端三响应头 + vite proxy 配置 + E2E 验证
> - **S-5**：流式取消——AbortController + 切换时 abort
> - **盲点**：防御性 SSE 解析（厂商 fixture）/ prompt 质量手动验收 / 安全风险表 / E2E mock 供应商不 mock 内部

---

## 1. 概述

### 1.1 目标

为 Code Archmage 补齐「代码家教」能力——让用户能：

1. **LLM 对话**：选中符号后，基于自动注入的符号上下文向 LLM 提问（"这是什么写法""讲讲这个算法"）
2. **确定性上下文组装**：给定 symbol_id，用几条 SQL 拼出函数体 + 调用签名 + 类成员，作为 LLM 的上下文——**这是产品核心差异化，不是可选功能**
3. **惰性摘要**：首次请求某符号的摘要时才调 LLM，结果缓存进 `summaries` 表

> **核心理念**（来自 `plan.md`）：没有确定性上下文组装，问答就退化成"把选中代码丢给 ChatGPT"——用户自己复制粘贴也能做到，产品就没有存在理由了。

### 1.2 阶段定位

| 阶段 | 范围 | 状态 |
|------|------|------|
| 5（已完成） | 搜索 + 调用图 + 剥洋葱 | ✅ 关系探索闭环 |
| **6（本方案）** | **LLM 对话 + 上下文组装 + 惰性摘要** | **代码家教闭环** |
| 7 | 发布准备（Tauri 壳 / 打包 / 文档） | 待规划 |

### 1.3 核心数字

- **TDD 循环**：16 个（引擎 9 + 前端 7）
- **新增引擎模块**：`llm/` 下 5 个文件（config / context / gateway / summaries / prompts）
- **新增 API 端点**：4 个（llm/config 状态 + chat 流式 + summaries 生成 + summaries 读取）
- **新增前端文件**：3 组件 + 2 hooks = 5 个源文件
- **新增前端依赖**：`react-markdown` + `remark-gfm`（Markdown 渲染）
- **引擎依赖**：零新增（`httpx` >=0.27 已就绪）

---

## 2. 关键技术决策

### 2.1 LLM 网关：OpenAI 兼容协议，单 provider

不做 provider 插件化。只实现一个 **OpenAI 兼容** client，通过 `LLM_BASE_URL` 适配各家：

| 供应商 | base_url | 兼容性 |
|--------|----------|--------|
| DeepSeek | `https://api.deepseek.com/v1` | ✅ 原生兼容 |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | ✅ 兼容 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | ✅ 兼容 |
| OpenAI | `https://api.openai.com/v1` | ✅ 原生 |
| Ollama（本地） | `http://localhost:11434/v1` | ✅ 兼容（彩蛋） |

**配置来源**（`.env`）：
```env
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

> **v2 修订（S-3）**：v1 写"已有 python-dotenv 支持"是**现状失实**——`python-dotenv` 只在 `pyproject.toml` 依赖列表里，全项目无任何 `load_dotenv()` 调用。本阶段需从零搭建 `.env` 加载链路。

**`.env` 加载设计**（纯函数，不依赖 cwd）：

```python
# llm/config.py
@dataclass(frozen=True)
class LLMConfig:
    api_key: str
    base_url: str
    model: str

def load_config(env_path: Path | None = None) -> LLMConfig | None:
    """从指定路径的 .env 文件读取 LLM 配置。缺失返回 None（不崩溃）。
    env_path=None 时尝试默认路径（cwd / .env）。
    """
```

**接线点**：`create_app(llm_config: LLMConfig | None = None)` 接受可选参数。CLI（`cli.py`）负责调 `load_config()` 加载后传入。TestClient 测试可直接传 `LLMConfig(...)` 或 `None`，不依赖文件系统。

**key 安全**：key 只在后端进程，前端永远不接触。前端调 `/api/chat`，后端注入 key 调 LLM——这同时解决了 CORS + key 暴露 + 多供应商适配三个问题（`plan.md` §四 论证）。

### 2.2 确定性上下文组装：纯 SQL + 文件读取

给定 `symbol_id`，`build_context(conn, symbol_id)` 组装以下结构化上下文：

| 符号类型 | 组装内容 | 数据来源 |
|----------|----------|----------|
| **function** | ① 函数签名 + 源码 ② 直接 callers（名字+位置） ③ 直接 callees（名字+签名） | `symbols` 表 + 文件读取 + `calls` 表 |
| **class** | ① 类签名 + 源码 ② 基类列表 ③ 成员方法列表（名字+签名） | `symbols` 表 + `bases` 字段 + 同文件同类符号 |
| **variable** | ① 变量源码行 | `symbols` 表 + 文件读取 |

**不是向量检索**。这是对符号表的确定性 SQL 查询（`plan.md` §四 论证："有了符号表、调用边、类成员表，一次 JOIN 就拼出上下文了"）。

**纯函数设计**：`build_context(conn: sqlite3.Connection, symbol_id: int) -> str`，输入 db 连接 + 符号 id，输出组装好的字符串。可独立单元测试（内存 SQLite + fixtures）。

**上下文分隔符**：用 XML 标签（`<source_code>...</source_code>`）而非 Markdown 标题分隔各段——抗 LLM 注入歧义更强（cc 盲点 2 建议）。

### 2.3 流式传输：SSE（Server-Sent Events）

| 层 | 方案 | 理由 |
|----|------|------|
| 后端 | FastAPI `StreamingResponse` + `text/event-stream` | 原生支持，无需额外库 |
| 前端 | `fetch` + `ReadableStream` 手动解析 SSE | `EventSource` 不支持 POST（chat 需发 body） |

> **v2 修订（Q5）**：选 SSE 的真正理由是"单向流足够 + 复用现有 HTTP 代理/错误处理链路 + 客户端解析简单"，不是"WebSocket 过重"（FastAPI 的 WebSocket 是一等公民）。

**SSE 格式**：
```
data: {"delta": "这是"}\n\n
data: {"delta": "一个"}\n\n
data: {"delta": "代码家教"}\n\n
data: [DONE]\n\n
```

错误情况：
```
data: {"error": "LLM 调用失败：超时"}\n\n
data: [DONE]\n\n
```

**v2 修订（S-4）：SSE 代理缓冲缓解**

真实链路有三层代理可能缓冲 SSE：

| 链路 | 缓冲风险 | 缓解 |
|------|----------|------|
| vite dev proxy（`vite.config.ts` `/api` 代理） | http-proxy 对 streaming 默认不缓冲，但需确认 | 后端响应头 + vite proxy 无特殊配置即可 |
| vite preview proxy（E2E 走它） | 同上 | E2E 循环 16 验证流式真实到达 |
| 生产（Tauri 直连后端） | 无代理 | 无风险 |

**后端响应头**（`StreamingResponse` 的 `headers` 参数）：
```python
headers={
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # nginx 兜底（虽不经 nginx，加上无害）
}
```

**v2 修订（盲点 1）：防御性 SSE 解析**

不同 OpenAI 兼容厂商的 `stream=true` 行为有差异：

| 厂商 | 已知差异 |
|------|----------|
| DeepSeek | 偶发空 `choices` 帧 |
| 智谱 GLM | 错误走 HTTP 4xx body 而非 SSE 事件 |
| Ollama | `finish_reason` 行为不一 |
| 通用 | 中途超时后无任何帧 |

前端 `sse.ts` 必须有防御性行为：
- 跳过非 JSON 行（如厂商的心跳/注释行）
- 忽略空 `delta`（`choices: []` 或 `delta.content == ""`）
- 流级超时兜底（N 秒无新数据 → 视为断流）
- `[DONE]` 信号识别（部分厂商用 `data: [DONE]`，部分用 HTTP 关闭）

### 2.4 对话面板位置：右侧 SidePanel 第三个标签页

当前 SidePanel 已有双标签（调用图 / 剥洋葱）。新增第三个标签「对话」：

```
┌──── 右侧面板（320px → 对话时 400px）────┐
│  [调用图] [剥洋葱] [对话]              │  ← 三个标签
├────────────────────────────────────────┤
│                                        │
│  🧑 add_numbers 是什么写法？           │  ← 消息历史
│                                        │
│  🤖 这是一个递归求和函数...             │
│  （Markdown 渲染：代码块、列表、加粗）  │
│                                        │
│  🧑 那它的调用者是谁？                  │
│                                        │
│  🤖 根据上下文，main() 调用了它...      │
│                                        │
├────────────────────────────────────────┤
│  [输入框____________________] [发送]   │  ← 输入区
│  📎 已附加：add_numbers 的上下文        │  ← 上下文提示
└────────────────────────────────────────┘
```

**v2 修订（Q2）：面板加宽实现方式**

不加宽 `grid-template-columns`（与布局强耦合）。改为 `.app-aside` 自身宽度切换（与现有 `aside-collapsed` 先例一致）：

```css
/* 阶段 5 已有 */
.app-aside { width: 320px; }
.app-aside.aside-collapsed { width: 0; }

/* 阶段 6 新增 */
.app-aside.aside-chat { width: 400px; }

/* 折叠优先于 chat 加宽 */
.app-aside.aside-collapsed.aside-chat { width: 0; }
```

**v2 修订（S-1）：上下文绑定语义——切换符号 = 开新对话**

> v1 的"切换符号不清空历史，但新消息用新上下文"会自相矛盾：history 里的 assistant 消息是针对**旧符号**的回答，而新 system prompt 注入的是**新符号**上下文——LLM 会拿旧上下文回答新问题。

采用**方案 A**（cc 推荐）：
- **对话会话绑定 `selectedSymbol`**——切换符号即开新对话（旧的清空）
- 同一会话内，system prompt 注入一次（会话开头），history 全程同一符号
- 这同时解决了盲点 3 的重复计费问题（不会把旧符号上下文发给新会话）

**对话状态提升到 App 层**（cc Q1/Q4 建议）：
- 消息列表 + 输入框草稿状态存放在 `App.tsx`（或 `useChat` hook 在 App 层调用）
- 通过 props 传给 `ChatPanel`（纯展示 + 回调）
- 这样配合 SidePanel 的 keep-mounted 模式（visibility 控制），切换标签不丢失状态
- 切换 `selectedSymbol` 时，App 层清空对话状态

### 2.5 惰性摘要：首次请求才生成，缓存进 SQLite

**v2 修订（Q3）：摘要按钮位置**

| 位置 | 放不放 | 理由 |
|------|--------|------|
| 符号大纲 | ✅ 放 | 行下方展开，最自然 |
| 剥洋葱 | ✅ 放 | 线性阅读场景，节点旁一句话最自然 |
| 调用图 | ❌ 不放 hover | hover tooltip 与节点拖拽/画布平移冲突；生成中 tooltip 没法保持打开 |

> 调用图若要摘要，放节点点击后的详情区（二期），不做 hover。

**流程**：
```
用户点击摘要按钮
    ↓
GET /api/summaries/{symbol_id}
    ↓
查 summaries 表 → 有缓存？
    ├─ 是 → 返回 { summary_text, model, cached: true }
    └─ 否 → POST /api/summaries { symbol_id }
            ↓
            build_context() → 调 LLM（摘要 prompt）→ 存入 summaries 表
            ↓
            返回 { summary_text, model, cached: false }
```

**不批量预生成**（`plan.md` §四："烧钱且大部分摘要永远不会被看到"）。`summaries` 表已建（schema.py 第 77-85 行），字段：`symbol_id`(PK) / `summary_text` / `model` / `created_at`。

### 2.6 未配置 LLM 时的降级

**v2 修订（S-2）：前端感知配置状态的通道**

新增 `GET /api/llm/config` 端点，返回：
```json
{ "configured": true, "model": "deepseek-chat" }
```
或
```json
{ "configured": false }
```

> **绝不返回 `api_key` 或 `base_url`**。只返回"是否已配置"+ 模型名（用于 UI 显示）。

前端启动时查一次（TanStack Query），据此决定：
- 对话面板：显示正常 UI 或配置引导
- 摘要按钮：显示或隐藏

**降级行为**：
- `/api/chat` → 返回 `503 { error: "LLM 未配置，请在 .env 设置 LLM_API_KEY" }`
- `/api/summaries` → 同上
- 前端对话面板显示配置引导：「未检测到 LLM 配置。请在引擎目录的 `.env` 文件中设置 `LLM_API_KEY`。」+ 文档链接
- 摘要按钮隐藏

**理由**：产品以"BYO API Key"为核心（`plan.md`），不应预置 key。但必须给用户明确的配置引导，不能静默失败。

---

## 3. UI 布局变化

### 3.1 右侧面板：三标签 + 动态宽度

> v2 修订（Q2）：不改 `grid-template-columns`，改 `.app-aside` 自身宽度（见 §2.4 CSS）。

### 3.2 对话面板交互

- **消息列表**：滚动区域，用户消息右对齐，LLM 消息左对齐
- **流式显示**：LLM 回复逐字显示（SSE delta 追加到最后一条消息）
- **输入框**：底部固定，Enter 发送，Shift+Enter 换行
- **上下文提示**：输入框上方显示「📎 已附加：{symbol_name} 的上下文」或「无上下文（未选中符号）」
- **清空对话**：顶部「清空」按钮，清空消息历史
- **错误显示**：LLM 错误以红色消息显示 + 重试按钮
- **v2 新增（S-5）：流式取消**——切换标签/符号时，通过 `AbortController` 取消进行中的流式请求，避免后台继续消耗 token

### 3.3 摘要展示

摘要以**内联展开**方式显示（不弹窗）：
- 符号大纲项：点击「📝」→ 行下方展开摘要文本
- 剥洋葱节点：节点旁显示摘要缩略（一句话）

---

## 4. 模块结构

### 4.1 新增引擎文件

```
engine/src/code_archmage/
├── llm/
│   ├── __init__.py          # 已存在（空壳）
│   ├── config.py            # load_config() 纯函数 + LLMConfig dataclass
│   ├── context.py           # build_context() 确定性上下文组装
│   ├── gateway.py           # OpenAI 兼容 client（chat + chat_stream）
│   ├── summaries.py         # get_or_create_summary() 惰性摘要
│   └── prompts/
│       ├── __init__.py
│       ├── chat_system.py   # 对话系统 prompt 模板
│       └── summary.py       # 摘要生成 prompt 模板
```

### 4.2 新增 / 修改前端文件

```
web/src/
├── components/
│   ├── ChatPanel.tsx        # 对话面板（消息列表 + 输入框）——纯展示，状态由 props 传入
│   ├── MessageBubble.tsx    # 单条消息（Markdown 渲染）
│   └── SummaryInline.tsx    # 摘要内联展示（符号大纲/剥洋葱节点旁）
├── hooks/
│   ├── useChat.ts           # 流式对话（fetch + ReadableStream + AbortController）
│   ├── useSummary.ts        # 惰性摘要（GET 缓存 / POST 生成）
│   └── useLLMConfig.ts      # v2 新增：查 GET /api/llm/config（启动时一次）
├── lib/
│   └── sse.ts               # SSE 流解析（防御性：跳过非 JSON / 忽略空 delta / 超时兜底）
├── api/
│   └── endpoints.ts         # 修改：新增 chat / summaries / llmConfig 封装
└── components/
    └── SidePanel.tsx        # 修改：三标签 + aside-chat class
```

### 4.3 修改引擎文件

| 文件 | 改动 |
|------|------|
| `server/routes.py` | 新增 `GET /api/llm/config` + `POST /api/chat`（流式）+ `GET /api/summaries/{id}` + `POST /api/summaries` |
| `server/models.py` | 新增 `ChatRequest` / `SummaryResponse` / `LLMConfigResponse` 等 Pydantic 模型 |
| `server/app.py` | **v2 修订（S-3）**：`create_app(llm_config: LLMConfig | None = None)` 接受可选参数，存入 `app.state.llm_config` |
| `cli.py` | **v2 新增（S-3）**：启动时调 `load_config()` 加载 `.env`，传入 `create_app()` |

### 4.4 修改其他文件

| 文件 | 改动 |
|------|------|
| `.env.example` | 新增 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` 模板 |
| `web/src/App.tsx` | **v2 修订（S-1）**：对话状态提升到此层；切换 `selectedSymbol` 时清空对话；SidePanel 传入 chat props + aside-chat class |
| `web/src/index.css` | 对话面板样式 + 摘要样式 + `.aside-chat` 宽度 |
| `web/src/components/SymbolOutline.tsx` | 符号项旁加摘要按钮 |
| `web/src/components/OnionView.tsx` | **v2 新增（Q3）**：剥洋葱节点旁加摘要按钮 |

---

## 5. API 契约

### 5.0 GET /api/llm/config（v2 新增 S-2）

**响应**（200，已配置）：
```json
{ "configured": true, "model": "deepseek-chat" }
```

**响应**（200，未配置）：
```json
{ "configured": false }
```

> 绝不返回 `api_key` 或 `base_url`。

### 5.1 POST /api/chat（流式 SSE）

**v2 修订（S-1）**：对话会话绑定 `symbol_id`。切换符号 = 开新对话（前端清空 history）。

**请求**：
```json
{
  "message": "add_numbers 是什么写法？",
  "symbol_id": 42,
  "history": [
    { "role": "user", "content": "之前的问题" },
    { "role": "assistant", "content": "之前的回答" }
  ]
}
```

- `symbol_id` 可空（null = 无上下文增强，纯对话）
- `history` 可空（首次对话）；**语义保证**：history 内的所有消息均针对同一 `symbol_id`（前端负责清空）

**后端处理**：
1. 首次请求（history 为空）→ `build_context(conn, symbol_id)` 组装上下文
2. 构造 `messages = [system_prompt(上下文)] + history + [user(message)]`
3. 调 LLM 流式 API → SSE 返回

> **关于重复计费**（cc 盲点 3）：OpenAI chat API 每轮都需发完整 messages 数组（含 system prompt），这是协议固有行为。方案 A（切换符号开新对话）确保不会把**旧符号**的上下文发给新会话。同一符号多轮对话的 system prompt 重复发送，依赖供应商的 prompt caching 优化（DeepSeek context caching / 智谱 cache）。

**响应**：`text/event-stream`（SSE）
```
data: {"delta": "这是"}\n\n
data: {"delta": "一个"}\n\n
...
data: [DONE]\n\n
```

**错误**（SSE 内传）：
```
data: {"error": "LLM 未配置"}\n\n
data: [DONE]\n\n
```

### 5.2 GET /api/summaries/{symbol_id}

**响应**（200，已缓存）：
```json
{
  "symbol_id": 42,
  "summary_text": "对可迭代对象中的元素求和...",
  "model": "deepseek-chat",
  "cached": true
}
```

**响应**（404，未生成）：
```json
{ "detail": "摘要未生成，请 POST /api/summaries 触发生成" }
```

### 5.3 POST /api/summaries

**请求**：
```json
{ "symbol_id": 42 }
```

**响应**（200，新生成或返回缓存）：
```json
{
  "symbol_id": 42,
  "summary_text": "对可迭代对象中的元素求和...",
  "model": "deepseek-chat",
  "cached": false
}
```

---

## 6. TDD 循环清单（16 个）

### 引擎：LLM 网关 + 上下文组装（循环 1-9）

| # | 红 | 绿 | 重构 |
|---|----|----|------|
| 1 | **v2 改（S-3）**：`llm.config.load_config(env_path)` 纯函数——从指定 `.env` 路径读 KEY/BASE_URL/MODEL；缺失返回 `None`；不依赖 cwd | dataclass + 文件读取（不调 `load_dotenv()`，手动解析或用 dotenv 的 `dotenv_values`） | — |
| 2 | `llm.context.build_context(conn, symbol_id)` 函数符号 → 包含签名 + 源码 + callers + callees（XML 标签分隔） | 纯函数：SQL 查询 + 文件读取 + 字符串拼装 | — |
| 3 | `build_context` 类符号 → 包含基类 + 成员方法；变量符号 → 源码行 | 分支处理 | — |
| 4 | `build_context` 边界：symbol_id 不存在 → 空字符串；文件读取失败 → 占位提示 | 错误处理 | — |
| 5 | `llm.gateway.chat(messages, config)` 非流式：调 OpenAI 兼容 API → 返回完整响应 | httpx POST + mock | — |
| 6 | **v2 改（S-4/盲点1）**：`llm.gateway.chat_stream(messages, config)` 流式：生成器 yield delta；防御性处理空 choices / 非 JSON 行 / 中途断流 | httpx stream + mock（含厂商异常 fixture） | — |
| 7 | `llm.prompts.chat_system` 模板：输入上下文字符串 → 输出系统 prompt（XML 标签分隔上下文） | 字符串模板 | — |
| 8 | `llm.summaries.get_or_create(conn, symbol_id, config)` → 有缓存返回缓存，无则调 LLM 生成 + 存入 | 查 summaries 表 + gateway.chat + INSERT | — |
| 9 | **v2 改（S-2）**：`GET /api/llm/config` + `POST /api/chat`（流式 SSE + 缓解缓冲响应头）+ `GET/POST /api/summaries` 端点接线 + 未配置时 503 | FastAPI StreamingResponse + Pydantic 模型 + `create_app(llm_config)` | — |

### 前端：对话面板 + 摘要（循环 10-16）

| # | 红 | 绿 | 重构 |
|---|----|----|------|
| 10 | **v2 改（盲点1）**：`lib/sse.parseSSEStream(response)` → 防御性解析 SSE 流（跳过非 JSON / 忽略空 delta / 超时兜底 / [DONE] 识别）；按厂商各造一组 fixture 帧（DeepSeek 空 choices / GLM 4xx / Ollama 不一） | ReadableStream + TextDecoder + 分割 | — |
| 11 | **v2 改（S-5）**：`useChat` hook：管理消息列表 + 发送 + 流式接收 + **AbortController 取消** + 错误处理 | fetch + sse 解析 + useState + AbortController | — |
| 12 | `MessageBubble` 组件：Markdown 渲染（代码块、列表、加粗） | react-markdown + remark-gfm | — |
| 13 | `ChatPanel` 组件：消息列表 + 输入框 + 上下文提示 + 清空 + 发送（**纯展示，状态由 props 传入**） | 组装 + 滚动 + Enter 发送 | — |
| 14 | **v2 改（S-1/Q1）**：`SidePanel` 三标签 + `App` 集成——对话状态提升到 App 层；切换符号清空对话；aside-chat class（aside 自身变宽，不动 grid）；**输入框草稿保活断言**（切换标签不丢失） | 标签页扩展 + CSS class + 状态提升 | — |
| 15 | `useSummary` hook + `SummaryInline` 组件：摘要按钮 + 内联展示（符号大纲 + 剥洋葱） | TanStack Query + 展开折叠 | — |
| 16 | **v2 改（盲点5）**：**E2E**——用假 OpenAI SSE 服务器（Playwright globalSetup 起一个几十行的 mock server，后端 `.env` 指向它），不 mock 内部 `/api/chat`。全链路：索引 → 选中符号 → 切换对话 → 面板加宽 → 输入 → 看到流式回复 → 切换符号 → 对话清空 → 摘要按钮 → 看到摘要 | Playwright + 假 OpenAI server | — |

---

## 7. 测试策略

### 7.1 引擎单元测试（pytest + mock）

| 模块 | 测试重点 |
|------|----------|
| `llm.config` | **v2 改**：指定路径读取、缺失字段返回 None、不崩溃、不依赖 cwd |
| `llm.context` | 函数/类/变量三种组装、callers/callees 拼装、文件读取失败、symbol_id 不存在、XML 标签分隔 |
| `llm.gateway` | 非流式响应解析、流式 delta 生成器、**v2 改**：厂商异常 fixture（DeepSeek 空 choices / GLM 4xx body / 超时无帧）、httpx mock |
| `llm.summaries` | 缓存命中不调 LLM、缓存未命中调 LLM + 存入、model 字段记录 |
| `llm.prompts` | 模板渲染正确（上下文注入位置、XML 标签） |
| `server/routes` | **v2 改**：`GET /api/llm/config`（configured true/false）、chat 端点流式响应 + 缓解缓冲响应头、summaries GET/POST、未配置 LLM 时 503 |

### 7.2 前端单元测试（vitest + MSW）

| 模块 | 测试重点 |
|------|----------|
| `lib/sse` | **v2 改**：SSE 流解析、delta 提取、[DONE] 处理、错误事件、**防御性行为**（非 JSON 跳过 / 空 delta 忽略 / 超时兜底）、**厂商 fixture** |
| `useChat` | 发送消息、流式接收、消息历史累积、错误处理、清空、**v2 改**：AbortController 取消 |
| `MessageBubble` | Markdown 渲染、代码块高亮、空消息 |
| `ChatPanel` | 输入发送、Enter/Shift+Enter、上下文提示、清空按钮、流式显示、**纯展示**（props 驱动） |
| `useSummary` | 缓存命中、生成中 loading、错误态 |
| `SummaryInline` | 展开/折叠、loading 态、摘要文本显示 |
| `useLLMConfig` | **v2 新增**：configured true/false、启动查一次 |

### 7.3 E2E（Playwright）

**v2 修订（盲点 5）：mock 供应商，不 mock 内部**

> v1 的"Playwright 拦截 `/api/chat`"与 `dev_workflow.md` §7.2.3"E2E：全真实，不 mock"冲突，且 mock 层次错了——拦截 `/api/chat` 意味着自家后端的网关 + 上下文组装 + SSE 管线在 E2E 里全部没被测到。

**v2 策略**：在 Playwright `globalSetup` 里起一个**假 OpenAI SSE 服务器**（几十行 Python `aiohttp` 或 `http.server`），后端 `.env` 配 `LLM_BASE_URL=http://127.0.0.1:<mock端口>` 指向它。假服务器返回固定的 SSE 流。

这样除 LLM 本身外，**全链路真实**（前端 → vite preview proxy → 后端 → 上下文组装 → 网关 → SSE → 前端解析），还顺带真实验证 S-4 的代理缓冲问题。

新增 1 条 E2E：
1. **对话 + 摘要全链路**：索引 → 选中 `add_numbers` → 切换到对话标签 → 面板加宽到 400px → 输入"这是什么写法" → 看到流式回复（逐字，验证不被缓冲）→ 切换符号 → 对话清空 → 点击摘要按钮 → 看到摘要文本

---

## 8. 依赖变更

### 8.1 前端新增

```json
{
  "react-markdown": "^9.x",
  "remark-gfm": "^4.x"
}
```

### 8.2 引擎

**零新增**。`httpx` >=0.27 已在依赖中（用于 LLM API 调用），`python-dotenv` >=1.0 已在依赖中（用于 .env 解析）。

### 8.3 不新增

- ~~`openai` SDK~~：用 httpx 直接调 OpenAI 兼容 API，不引入 SDK（减依赖 + 流式控制权在自己手里）
- ~~`anthropic` SDK~~：只做 OpenAI 兼容，不做 provider 插件化
- ~~`langchain`~~：过重，确定性上下文组装不需要

---

## 9. 验收标准

### 9.1 功能验收

- [ ] `.env` 配置 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` 后，对话功能可用
- [ ] 未配置 LLM 时，对话面板显示配置引导（不静默失败）
- [ ] **v2 改（S-2）**：前端启动时查 `GET /api/llm/config`，据此显隐配置引导和摘要按钮
- [ ] 选中符号 → 切换对话标签 → 面板加宽到 400px（aside 自身变宽，grid 不动）
- [ ] 输入问题 → 流式显示 LLM 回复（逐字出现，**v2 改（S-4）**：经 vite proxy 不被缓冲）
- [ ] 回复支持 Markdown 渲染（代码块、列表、加粗、行内代码）
- [ ] **v2 改（S-1）**：切换符号 → 对话清空（开新会话）；切换标签 → 对话保持（含输入框草稿）
- [ ] 输入框上方显示「📎 已附加：{symbol_name}」或「无上下文」
- [ ] Enter 发送 / Shift+Enter 换行 / 清空对话按钮
- [ ] **v2 改（S-5）**：切换标签/符号时，进行中的流式请求被取消（AbortController）
- [ ] 点击符号的「📝 摘要」按钮（符号大纲 + 剥洋葱）→ 首次生成（等待）→ 再次点击秒返（缓存）
- [ ] 摘要以一句话展示，中文，不超过 50 字
- [ ] LLM 调用失败 → 红色错误消息 + 重试按钮

### 9.2 质量门禁

- [ ] `pytest`：所有引擎测试通过，`llm/` 模块覆盖率 ≥ 80%
- [ ] `pnpm test`：所有 vitest 通过，前端覆盖率 ≥ 70%
- [ ] `pnpm test:e2e`：Playwright 全部通过（含新增 1 条，走假 OpenAI 服务器）
- [ ] `pnpm build`：tsc strict 零错误
- [ ] `ruff` + `mypy`：零警告
- [ ] `prettier` + `eslint`：零格式问题

### 9.3 代码质量

- [ ] `build_context` 是纯函数（输入 conn + symbol_id，输出字符串），分支全覆盖
- [ ] `load_config` 是纯函数（输入 env_path，输出 LLMConfig | None），不依赖 cwd
- [ ] LLM 调用全部 mock（单元测试不调真实 API）
- [ ] prompt 模板版本化管理（`llm/prompts/`），改动有测试
- [ ] 无 API key 硬编码 / 无 key 进日志 / 无 key 进 git / **key 不出现在任何 API 响应中**
- [ ] `.env.example` 已更新（含 LLM 三个字段）
- [ ] **v2 新增（盲点 2）**：prompt 质量验证只能落在**手动验收**——TDD 能保证模板不坏，但保证不了回答质量。这是诚实的预期管理（与 `plan.md` §四 对调用图精度的处理一致）

---

## 10. 不做清单

- 多 provider 插件化（MVP 只做 OpenAI 兼容）
- 对话历史持久化（MVP 对话历史仅在内存，刷新即清）
- 多轮上下文窗口管理（history 全量传给 LLM，不做 token 截断）
- ~~流式中断/重试~~ → **v2 改（S-5）**：流式取消做（AbortController），但流式中断恢复不做
- 摘要批量生成 / 预生成
- 代码生成（LLM 只解释，不写代码——`plan.md` 明确排除）
- 向量检索 / 语义搜索（二期）
- 对话导出 / 分享
- 多模型切换 UI（MVP 用 .env 配的单一模型）
- Token 用量统计 / 成本追踪

---

## 11. 风险与缓解

### 11.1 已识别风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| LLM API 不稳定 / 超时 | 对话卡住 | httpx 超时 30s + 前端错误提示 + 重试按钮 |
| **v2 改（S-4）**：SSE 经 vite dev/preview proxy 被缓冲 | 逐字变批量 | 后端三响应头（`Cache-Control: no-cache` / `Connection: keep-alive` / `X-Accel-Buffering: no`）+ E2E 循环 16 真实验证 |
| 上下文组装的源码读取跨文件失败 | 上下文不完整 | 文件读取失败时放占位提示，不崩溃 |
| 用户未配 key 就用对话 | 静默失败 | **v2 改（S-2）**：`GET /api/llm/config` + 前端启动查一次 + 配置引导 |
| Markdown 渲染 XSS | 安全 | react-markdown 默认转义 HTML（不渲染 raw HTML） |
| 对话历史过长 → LLM token 超限 | API 报错 | MVP 不做截断，依赖 LLM 自身限制；二期加滑动窗口 |
| **v2 新增（盲点 4）**：`/api/chat` 引入"把代码送出去"通道 | 本机恶意进程/网页借 key 发代码 | 127.0.0.1 绑定已是边界；**守住底线**：不再放宽 CORS origins、key 不进任何日志/错误消息。本地工具可接受此信任级别，风险表必须明示 |
| LLM 供应商行为差异（空帧/4xx/超时无帧） | SSE 解析崩溃 | **v2 改（盲点 1）**：防御性 SSE 解析 + 厂商 fixture 测试 |

### 11.2 cc 审核的开放问题（已回答）

| # | 问题 | cc 判断 | v2 采纳 |
|---|------|---------|---------|
| Q1 | 对话面板放右侧第三标签 vs 底部抽屉？ | **第三标签**，但状态提升到 App 层 + 输入框草稿保活 | ✅ 已采纳 |
| Q2 | 对话时面板加宽 320→400px？ | **400px 够**，但改 aside 自身宽度（不动 grid）；折叠优先 | ✅ 已采纳 |
| Q3 | 摘要按钮放哪？ | **符号大纲 + 剥洋葱**（反对调用图 hover——与拖拽冲突） | ✅ 已采纳 |
| Q4 | 对话历史持久化？ | **MVP 不持久化**（隐私点赞），但状态提升到 App 层 | ✅ 已采纳 |
| Q5 | SSE vs WebSocket？ | **SSE**，但修正论证（不是"WebSocket 过重"，是"单向够 + 复用 HTTP 链路"） | ✅ 已采纳 |

---

## 12. 执行检查清单

- [x] cc 审核完成（5 严重 + 5 盲点，全部修订到 v2）
- [ ] 用户批准
- [ ] 16 个 TDD 循环逐一执行（红绿重构）
- [ ] cc 验收 + 修复全部反馈
- [ ] 用户验收
- [ ] push
