import { test, expect } from "@playwright/test";

/**
 * 阶段 5 循环 14 E2E：剥洋葱全链路。
 *
 * 零 mock：真实后端 + 前端 + SQLite。
 * 选中 add_numbers → 切换剥洋葱 → 看到调用链 → 点击跳转。
 *
 * cc S-2：callers 按名匹配。fixture 中：
 *   main() → calc.add(1,2) → add_numbers(a,b)
 */
test.describe("阶段 5：剥洋葱", () => {
  test("选中符号 → 剥洋葱显示调用链 → 点击跳转", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 稳健索引策略
    try {
      await page.getByText("main.py").first().waitFor({ timeout: 5_000 });
    } catch {
      await page.getByRole("button", { name: /索引/i }).first().click();
      await expect(page.getByText("main.py").first()).toBeVisible({
        timeout: 20_000,
      });
    }

    // 用 API 确认后端调用关系数据
    const searchResp = await page.request.get(
      "/api/search?q=add_numbers&limit=1",
    );
    const hits = await searchResp.json();
    expect(hits.length).toBeGreaterThan(0);
    const symId = hits[0].symbol_id;
    const callersResp = await page.request.get(`/api/symbols/${symId}/callers`);
    const callers = await callersResp.json();
    expect(callers.length).toBeGreaterThan(0);

    // 打开 operations.py
    await page.getByText("operations.py").click();
    await expect(page.locator(".cm-content")).toContainText("add_numbers");

    // 点击符号大纲中的 add_numbers
    const symBtn = page.locator(".symbol-outline").getByText("add_numbers");
    await symBtn.click();

    // 切换到剥洋葱标签
    await page.getByRole("tab", { name: /剥洋葱/i }).click();

    // 等待 OnionView 渲染（useCallChain 递归查询）
    await expect(page.locator(".onion-view")).toBeVisible({
      timeout: 15_000,
    });

    // 验证调用链包含 add_numbers（目标符号）
    const onionText = await page.locator(".onion-view").textContent();
    expect(onionText).toContain("add_numbers");

    // 点击链中的第一个节点 → 跳转
    const nodeButtons = page.locator(".onion-node-btn");
    const nodeCount = await nodeButtons.count();
    expect(nodeCount).toBeGreaterThan(0);

    const firstName = await nodeButtons.first().textContent();
    await nodeButtons.first().click();

    // 验证代码视图更新
    await expect(page.locator(".cm-content")).toBeVisible();
    if (firstName) {
      await expect(page.locator(".cm-content")).toContainText(firstName, {
        timeout: 5_000,
      });
    }
  });
});
