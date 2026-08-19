# Stage 7 — 硬伤修复（7a）与导读视图（7b）

> 依据 2026-08-18 验收评审与迭代计划：先修 Stage 1-6 的体验硬伤，
> 再落地「导读视图」（notebook × DeepWiki 的中文对照代码阅读）。
> 验收基准：用本项目 engine 自身（约 3000 行）做 dogfooding。

---

## Stage 7a：硬伤修复（已完成）

| 编号 | 问题 | 修法 |
|------|------|------|
| A-1 | 多候选跳转静默失败（`useJumpToDefinition` 同名 >1 时丢弃） | `onCandidates` 回调 + `CandidatePicker` 浮层，用户点选跳转目标 |
| A-2 | 切换符号清空对话历史 | `useChat(symbolId)` 重写为按符号维护会话 Map；流式定向写入原会话；SidePanel 不再自动 abort |
| A-3 | 中文注释行调用点点击失效（UTF-8 字节列 vs UTF-16 列） | `findCallAt` 改列容差匹配；`buildCallMarks` 用 `sliceByBytes` 做字节列→码元列校正 |
| A-4 | 密钥防护落地 | `.pre-commit-config.yaml` 新增零依赖 `secret-pattern-scan`（`sk-[A-Za-z0-9]{16,}`），与 gitleaks 互为兜底 |
| A-5 | 索引按钮语义混淆 | 已索引时按钮文案「重新索引」；`IndexStats`/`files_updated`/`files_skipped` 全链路透传，Header 显示增量统计 |

## Stage 7b：导读视图（已完成）

### 产品定位

导读是产品的「引导层」：DeepWiki 的结构化叙事 + notebook 的「讲一段、看一段」
代码对照形态，中文输出。与 explorer 模式（跳转/调用图/提问）构成
「引导层 + 深挖层」的完整阅读闭环。

### 引擎侧

- `indexer/schema.py`：schema v2，新增 `guides` 表（scope+path 唯一，input_hash 判 stale）
- `llm/guide_blocks.py`：导读 markdown → text/code 块解析器（宽容降级：畸形围栏/越界行号/索引外文件 → 说明性 text）
- `llm/guide_context.py`：三级确定性上下文（文件：≤500 行全文否则签名清单；模块：签名+imports，≤15 文件；项目：文件清单+统计+入口启发式）
- `llm/prompts/guide.py`：三级 prompt（中文 + code 围栏格式硬约束）
- `llm/guides.py`：生成管线（**先落库再发 [DONE]**，消除客户端跳走的竞态）
- `llm/guide_store.py`：guides 读写
- `server/guide_routes.py`：`GET /api/guides/tree`（确定性）/ `GET /api/guides`（块解析+stale）/ `POST /api/guides/generate`（SSE）

### 前端侧

- Header 分段控件「阅读 | 导读」；导读模式 app-body 切单列
- `GuidePage`：左目录（none/cached/stale 状态）+ 右正文；未生成→生成按钮；stale→重新生成
- `CodeBlockView`：引擎切片渲染（CodeMirror 只读 + 真实行号），点定位头跳回阅读模式
- `useGuide`/`useGuideTree`；`sse.ts` 支持导读流的 `content` 字段
- 阅读模式右下角「📖 查看导读」反向入口（聚焦当前文件）
- code 块内容不信 LLM：永远由引擎按 file+lines 实时切片，源码变更后不可能渲染错误代码

### E2E

- `fake_openai.py` 识别导读 prompt（含「导读作者」），返回固定带 code 围栏的导读
- `guide.spec.ts`：生成→流式渲染→代码块切片→跳回阅读模式定位；「查看导读」反向入口

---

## 验收结论（2026-08-18）

- 引擎：257 单测通过（+25）；ruff + mypy 全绿
- 前端：228 单测通过（+28）；tsc 0 错误
- E2E：11/11 通过（含 2 条新增导读用例）

## 遗留（已交 Stage 8 / 9）

Stage 8（`stage8_reading_loop.md`）已做：「生成并查看导读」、全库串行生成、README。

仍留给 Stage 9：CLI `--open`、打包（PyInstaller/Tauri）、TS 语言插件、CodeMirror 原生折叠。
