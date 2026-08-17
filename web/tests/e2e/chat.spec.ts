import { test, expect } from "@playwright/test";

/**
 * LLM 对话 E2E（循环 16）。
 *
 * cc 盲点：mock 供应商（假 OpenAI SSE 服务器），不 mock 内部 /api/chat。
 * 全链路：前端 → 后端 → 假 OpenAI → 流式回传。
 *
 * 前置条件（playwright.config.ts webServer）：
 * 1. 假 OpenAI 服务器（端口 8767）
 * 2. 后端（端口 8766，.env 指向假服务器）
 * 3. 前端（端口 4173）
 */
test.describe("LLM 对话 E2E", () => {
  test("LLM 配置状态 → 对话流式回传", async ({ page }) => {
    // 1. 索引
    await page.goto("/");
    if (await page.getByText(/尚未索引|无 Python/i).isVisible()) {
      await page.getByRole("button", { name: /索引/i }).first().click();
      await expect(page.getByText("main.py")).toBeVisible({
        timeout: 15_000,
      });
    }

    // 2. 打开文件 + 选中符号（对话需要上下文）
    await page.getByText("main.py").click();
    await expect(page.locator(".cm-content")).toBeVisible();

    // 3. 点大纲符号（选中符号 = 开对话上下文）
    await page.getByText("main").first().click();

    // 4. 切到对话标签
    await page.getByRole("tab", { name: /对话/i }).click();

    // 5. 验证 LLM 已配置（不显示警告）
    await expect(page.locator(".chat-config-warning")).not.toBeVisible({
      timeout: 5_000,
    });

    // 6. 输入消息 + 发送
    await page.locator(".chat-input").fill("这个函数做什么？");
    await page.getByRole("button", { name: /发送/i }).click();

    // 7. 验证用户消息出现
    await expect(page.locator(".chat-msg-user")).toContainText(
      "这个函数做什么？",
    );

    // 8. 验证流式回传（assistant 消息逐步出现）
    await expect(page.locator(".chat-msg-assistant")).toBeVisible({
      timeout: 10_000,
    });
    // 等待流式完成（假服务器返回固定文本）
    await expect(page.locator(".chat-msg-assistant")).toContainText(
      /测试函数/,
      { timeout: 10_000 },
    );

    // 9. 验证停止按钮变回发送按钮（流式结束）
    await expect(page.getByRole("button", { name: /发送/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("切换符号 = 开新对话（S-1）", async ({ page }) => {
    // 索引
    await page.goto("/");
    if (await page.getByText(/尚未索引|无 Python/i).isVisible()) {
      await page.getByRole("button", { name: /索引/i }).first().click();
      await expect(page.getByText("main.py")).toBeVisible({
        timeout: 15_000,
      });
    }

    // 打开 main.py + 选中 main 符号
    await page.getByText("main.py").click();
    await page.getByText("main").first().click();

    // 切到对话 + 发消息
    await page.getByRole("tab", { name: /对话/i }).click();
    await page.locator(".chat-input").fill("第一条消息");
    await page.getByRole("button", { name: /发送/i }).click();
    await expect(page.locator(".chat-msg-user")).toContainText(
      "第一条消息",
    );

    // 切换到不同符号（打开 calculator.py + 点 Calculator）
    await page.getByText("calculator.py").click();
    // 等待符号大纲加载新文件的符号
    await expect(page.locator(".symbol-name:has-text('Calculator')")).toBeVisible({
      timeout: 5_000,
    });
    await page.locator(".symbol-item:has-text('Calculator')").first().click();

    // 验证对话被清空（S-1：切换符号 = 开新对话）
    await expect(page.locator(".chat-msg-user")).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test("清空按钮清空对话", async ({ page }) => {
    // 索引
    await page.goto("/");
    if (await page.getByText(/尚未索引|无 Python/i).isVisible()) {
      await page.getByRole("button", { name: /索引/i }).first().click();
      await expect(page.getByText("main.py")).toBeVisible({
        timeout: 15_000,
      });
    }

    // 打开文件 + 选中符号 + 切到对话
    await page.getByText("main.py").click();
    await page.getByText("main").first().click();
    await page.getByRole("tab", { name: /对话/i }).click();

    // 发消息
    await page.locator(".chat-input").fill("测试消息");
    await page.getByRole("button", { name: /发送/i }).click();
    await expect(page.locator(".chat-msg-user")).toBeVisible();

    // 点清空
    await page.getByRole("button", { name: /清空/i }).click();

    // 验证对话被清空
    await expect(page.locator(".chat-empty")).toBeVisible();
  });
});
