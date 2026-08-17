# Code Archmage

本地、只读的源码拆解工具。面向「刷过题、第一次面对工程代码不知道从哪读」的计算机系学生。

代码不出本机：解析和索引都在你电脑上完成，服务只监听 `127.0.0.1`。不编辑、不运行、不调试，只用来读。

当前仅支持 **Python**。

## 能做什么

打开一个本地 Python 仓库后，可以：

- 浏览文件树和当前文件的符号大纲
- 在只读代码视图里点调用，跳到定义
- 按符号名搜索整个项目
- 看当前符号的一层调用图（谁调用了它、它调用了谁）
- 「剥洋葱」：把调用链展平成从入口到当前符号的路径
- 选中符号后向 LLM 提问；引擎会自动拼上函数体、调用关系等上下文
- 按需生成一句话摘要（首次生成后缓存到本地索引库）

调用关系按函数名匹配，同名函数可能对不上，界面会标明这一点。

## 启动

需要：Python 3.11+、Node.js 22+、[uv](https://docs.astral.sh/uv/)、[pnpm](https://pnpm.io)。

### 1. 安装依赖（只需一次）

```bash
cd engine && uv sync
cd ../web && pnpm install
```

### 2. （可选）配置 LLM

对话和摘要需要 API Key。复制根目录的 `.env.example` 为 `.env` 后填写：

```env
LLM_API_KEY=your-api-key-here
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
```

任何 OpenAI 兼容接口都可以（DeepSeek、智谱、通义、OpenAI、本地 Ollama 等）。不配也能用浏览、跳转、搜索和调用图，只是右侧「对话」和摘要不可用。

引擎会依次读取：**被阅读项目根目录的 `.env`**，以及 **启动命令所在目录的 `.env`**。把 `.env` 放在本仓库根目录时，请从本仓库根目录启动引擎。

### 3. 起两个进程

终端一，启动引擎（把路径换成你要读的 Python 项目）：

```bash
cd /path/to/code_archmage
uv run --directory engine python -m code_archmage /path/to/your/python/project
```

默认端口 `8765`，可加 `--port 8765` 修改。

终端二，启动界面：

```bash
cd /path/to/code_archmage/web
pnpm dev
```

浏览器打开 [http://localhost:5173](http://localhost:5173)。前端会把 `/api` 代理到本机引擎。

### 4. 索引

页面打开后点顶部 **索引**。索引写在被阅读项目下的 `.code_archmage_index/`（已 gitignore），不上传、不进 git。

## 目录

```
code_archmage/
├── engine/     # 解析、索引、本地 API、LLM 网关
├── web/        # 阅读界面
├── plans/      # 产品规划与架构决策
└── .env.example
```

## 许可证

MIT
