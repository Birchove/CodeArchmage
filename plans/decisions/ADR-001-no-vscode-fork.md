# ADR-001：不 fork VS Code 做减法

- **状态**：已采纳
- **日期**：2026-08-13
- **决策者**：CodeBuddy（主分析）+ 用户（拍板认可）

## 背景

VS Code 核心源码（`microsoft/vscode`）以 MIT 许可证开源（注意：官方发行版二进制是专有的，含品牌/市场/遥测）。市面上 VSCodium、Cursor、Windsurf 都基于此 fork。项目初期曾考虑"fork VS Code 做减法"以复用其成熟框架，省去从零搭建的功夫。

## 决策

**不 fork VS Code，坚持从零搭建轻量栈**（React + CodeMirror 6 + tree-sitter + Python + Tauri）。

## 理由

1. **fork 方向与产品形态根本矛盾**：fork VS Code 意味着产品形态被锁死为"编辑器"，与 plan.md 方案 D"localhost 应用 → Tauri 壳"的演进路径根本冲突。我们的形态决策是三层解耦（Python 引擎 + FastAPI + Web UI），VS Code 的 Electron 单体架构与此无法调和。

2. **Electron 体积/内存与"小而美"定位冲突**：Electron 应用动辄 200MB+ 安装包、吃几百 MB 内存，与"小而美、只做拆解"的定位背道而驰。Tauri 壳复用系统 WebView，体积可低至 10MB 级。

3. **做减法比做加法难**：VS Code 是几十万行 TypeScript，光构建系统、扩展宿主、调试协议就是一座山。"删掉不要的"需要先读懂它在做什么，理解成本 ≈ 重写成本。

4. **设计哲学正交**：
   - VS Code = 通用编辑器 + 海量扩展（编辑、调试、git、终端、市场……）
   - Code Archmage = 只读拆解浏览器（不编辑、不调试、不 git）
   - VS Code 的核心资产（扩展系统、LSP 客户端、调试器、终端）对我们**全是负担不是资产**。

5. **技术栈冲突**：VS Code 是 Node.js 全家桶 + Electron；我们是 Python 后端 + Web/Tauri 前端。硬把 Python 后端塞进 VS Code 的 Node.js 扩展宿主等于自找麻烦。

6. **长期维护成本**：上游每天几十个 commit，fork 后要么跟不上（技术债），要么花精力 rebase。微软的品牌/市场/遥测代码要逐个剥离，容易踩许可和隐私的雷。**且 VS Code 源码无官方稳定 API，fork 属非受支持用法**——微软不保证内部接口稳定，fork 方的每次 rebase 都可能踩到破坏性变更。

7. **CodeMirror 6 已是更优解**：对只读场景，CM6 比 Monaco（VS Code 编辑器内核）更轻量（按需加载 vs ~5MB）、模块化、移动端友好。Monaco 是为重型编辑设计的，杀鸡用牛刀。

## 可单点借鉴的组件（不引入架构）

| 组件 | 态度 | 说明 |
|------|------|------|
| Monaco Editor | ❌ 不用 | 已选 CodeMirror 6，更轻量 |
| TextMate Grammars | ⚠️ 可选 | 已用 tree-sitter（结构化、能做符号/调用图，能力上是 TextMate 超集） |
| LSP 客户端 | 🔜 二期再说 | 若接 pyright/rust-analyzer 做精确跳转，可借 `vscode-languageclient` |
| Extension Host | ❌ 不要 | 明确"不做插件市场"，零价值 |

## 后果

**正面**：
- 保持轻量栈，与"小而美"定位一致
- 无 fork 维护负担，无上游 rebase 成本
- Python 后端不受 Node.js 架构约束

**负面**：
- 不能直接复用 VS Code 的成熟实现（编辑器、设置系统、主题引擎等）
- 部分交互范式需自行研究（可参考 VS Code 源码抄思路，但不引入架构）

## 对标方向

真正值得研究的对标是 **Source Insight 的交互范式**（符号窗口、调用图、引用追踪），而非 VS Code 的代码框架。VS Code 的开源给了我们"学习"的自由，没给我们"复用"的便利。
