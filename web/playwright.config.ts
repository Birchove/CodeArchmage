import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 配置（循环 13）。
 *
 * - 后端：CLI 雏形 + sample_repo，端口 8766（S-4：非默认避免撞）
 * - 前端：vite preview + proxy 同源（S-2：不依赖 CORS）
 * - B-2：后端启动命令前置 rm -rf 保证空态（globalSetup 在 webServer 之后跑会删掉正在用的库）
 * - B-1：cd ../engine && uv run 不依赖 cwd
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: [
    {
      // 循环 16：假 OpenAI SSE 服务器（E2E mock 供应商，不 mock 内部）
      command: "python3 tests/e2e/fixtures/fake_openai.py --port 8767",
      url: "http://127.0.0.1:8767",
      timeout: 10_000,
      reuseExistingServer: false,
    },
    {
      // B-2：前置 rm -rf 保证从空态开始（在 webServer 启动前执行）
      command:
        "rm -rf ../web/tests/e2e/fixtures/sample_repo/.code_archmage_index && cd ../engine && uv run python -m code_archmage ../web/tests/e2e/fixtures/sample_repo --port 8766",
      url: "http://127.0.0.1:8766/api/health",
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm build && CODE_ARCHMAGE_API_TARGET=http://127.0.0.1:8766 pnpm preview --port 4173",
      url: "http://127.0.0.1:4173",
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
