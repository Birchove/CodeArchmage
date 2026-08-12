# Code Archmage

> 只读源码拆解浏览器 — 帮助初出茅庐的大学生理解大型工程化代码。

## 这是什么

Code Archmage 是一个**本地优先**的只读代码阅读工具，面向"懂算法题但没读过真实工程"的计算机系学生。它帮你拆解几万行、重封装的源码：

- **符号导航**：跳定义、查引用、查调用者（类 Source Insight）
- **调用图**：可视化函数间的调用关系
- **LLM 问答**：选中代码即可提问，自动注入符号上下文
- **只读**：不编辑、不运行、不调试 — 专心"读"代码

## 快速开始

### 前置要求

- Python 3.11+
- Node.js 22+
- [uv](https://docs.astral.sh/uv/)（Python 包管理）
- [pnpm](https://pnpm.io)（前端包管理）

### 引擎（后端）

```bash
cd engine
uv sync --extra dev       # 安装依赖
uv run pytest             # 跑测试
```

### 前端

```bash
cd web
pnpm install              # 安装依赖
pnpm test                 # 跑测试
pnpm dev                  # 开发服务器
```

### Git 钩子

```bash
pre-commit install        # 安装提交前检查钩子
```

## 项目结构

```
code_archmage/
├── engine/              # Python 引擎（tree-sitter + FastAPI + SQLite）
│   ├── src/code_archmage/
│   │   ├── parser/      # 解析（阶段 1）
│   │   ├── indexer/     # 索引（阶段 2）
│   │   ├── server/      # 服务（阶段 3）
│   │   ├── llm/         # LLM 网关（阶段 5）
│   │   └── cli.py       # 一键启动（阶段 6）
│   └── tests/
├── web/                 # React 前端（阶段 4 开始）
│   ├── src/
│   └── tests/
├── plans/               # 规划文档
│   ├── plan.md          # 产品技术规划
│   ├── dev_workflow.md  # TDD 开发流程
│   ├── reference/       # 历史输入文档
│   └── decisions/       # ADR（架构决策记录）
└── .github/workflows/   # CI
```

## 开发流程

本项目采用 **TDD（测试驱动开发）**。详见 [plans/dev_workflow.md](plans/dev_workflow.md)。

## 开发进度

- [x] 阶段 0：项目初始化
- [ ] 阶段 1：解析器（tree-sitter → 符号/调用）
- [ ] 阶段 2：索引器（SQLite + FTS5）
- [ ] 阶段 3：服务层（FastAPI + 安全硬规则）
- [ ] 阶段 4：垂直切片（前端基础阅读）
- [ ] 阶段 5：加厚迭代（调用图、LLM、剥洋葱）
- [ ] 阶段 6：发布准备

## 许可证

MIT
