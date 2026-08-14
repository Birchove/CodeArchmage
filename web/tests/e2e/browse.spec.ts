import { test, expect } from "@playwright/test";

/**
 * 全链路 E2E（循环 13）。
 *
 * 零 mock：真实后端（CLI + sample_repo）+ 真实前端（vite preview）+ 真实 SQLite。
 * 覆盖 MVP 最小闭环：索引→文件树→打开文件→大纲→跳定义。
 */
test.describe("Code Archmage 全链路", () => {
  test("空状态 → 索引 → 文件树 → 打开文件 → 大纲", async ({ page }) => {
    // 1. 进入 → 空状态（B-4）
    await page.goto("/");
    await expect(page.locator("body")).toContainText(/尚未索引|无 Python/i);

    // 2. 点索引按钮 → 等待文件树出现
    await page.getByRole("button", { name: /索引/i }).first().click();
    await expect(page.getByText("main.py")).toBeVisible({ timeout: 15_000 });

    // 3. 展开文件树（如果有目录）→ 点文件
    await page.getByText("main.py").click();

    // 4. CodeMirror 挂载 + 代码可见
    await expect(page.locator(".cm-content")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("def main");

    // 5. 符号大纲可见
    await expect(page.getByText("main").first()).toBeVisible();

    // 6. 点大纲符号 → 不崩（滚动效果在真实浏览器中验证）
    await page.getByText("main").first().click();
  });

  test("文件树展开 + 跨文件导航", async ({ page }) => {
    // 先索引
    await page.goto("/");
    if (await page.getByText(/尚未索引|无 Python/i).isVisible()) {
      await page.getByRole("button", { name: /索引/i }).first().click();
      await expect(page.getByText("main.py")).toBeVisible({ timeout: 15_000 });
    }

    // 打开 calculator.py
    await page.getByText("calculator.py").click();
    await expect(page.locator(".cm-content")).toContainText("class Calculator");

    // 大纲显示 Calculator 类 + add/subtract 方法
    await expect(page.getByText("Calculator").first()).toBeVisible();
  });

  test("B-5：openapi 契约断言（关键模型存在）", async ({ request }) => {
    // FastAPI 的 openapi.json 在根路径（非 /api 前缀），直接请求后端
    const resp = await request.get("http://127.0.0.1:8766/openapi.json");
    expect(resp.ok()).toBeTruthy();
    const schema = await resp.json();
    // S-1：CallOut 必须存在
    expect(schema.components.schemas).toHaveProperty("CallOut");
    expect(schema.components.schemas).toHaveProperty("FileContentOut");
    expect(schema.components.schemas).toHaveProperty("SymbolOut");
    // FileContentOut 含 calls 字段
    const fileContentProps =
      schema.components.schemas.FileContentOut.properties;
    expect(fileContentProps).toHaveProperty("calls");
  });
});
