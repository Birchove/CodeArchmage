import { test, expect } from "@playwright/test";

/**
 * 阶段 5 循环 5 E2E：全局搜索 → 跳转。
 *
 * 零 mock：真实后端 + 前端 + SQLite。
 * 搜索 `add` → FTS5 整词匹配 → 命中 Calculator.add → 点击 → 跳转 calculator.py。
 */
test.describe("阶段 5：全局搜索", () => {
  test("搜索 add → 浮层结果 → 点击跳转", async ({ page }) => {
    await page.goto("/");

    // 稳健索引策略：先等文件树快速出现（已索引场景），
    // 5 秒内不出现则点索引按钮（未索引场景）
    try {
      await page.getByText("main.py").first().waitFor({ timeout: 5_000 });
    } catch {
      await page.getByRole("button", { name: /索引/i }).first().click();
      await expect(page.getByText("main.py").first()).toBeVisible({
        timeout: 15_000,
      });
    }

    // 搜索框输入 add
    const searchInput = page.getByRole("combobox", { name: /搜索符号/i });
    await expect(searchInput).toBeEnabled();
    await searchInput.fill("add");

    // 浮层显示结果（FTS5 整词匹配 → Calculator.add）
    const results = page.locator(".search-results");
    await expect(results).toBeVisible({ timeout: 5_000 });
    await expect(results).toContainText("add");
    await expect(results).toContainText(/calculator\.py/i);

    // 点击第一条结果 → 跳转
    await results.locator(".search-result-item").first().click();
    await expect(page.locator(".cm-content")).toContainText("Calculator");
  });
});
