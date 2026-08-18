import { test, expect } from "@playwright/test";

/**
 * Stage 7b E2E：导读链路。
 *
 * 零 mock 内部：真实后端 + fake OpenAI（按 prompt 内容返回固定导读，
 * 含 code 围栏）→ 验证「生成 → 流式渲染 → 代码块切片 → 跳回阅读模式定位」。
 */
test.describe("Stage 7b：导读", () => {
  test("生成文件导读 → 代码块渲染 → 跳回阅读模式", async ({ page }) => {
    await page.goto("/");
    if (await page.getByText(/尚未索引|无 Python/i).isVisible()) {
      await page.getByRole("button", { name: /索引/i }).first().click();
      await expect(page.getByText("main.py")).toBeVisible({ timeout: 15_000 });
    }

    // 切到导读模式
    await page.getByRole("button", { name: "导读" }).click();
    await expect(page.getByText("导读目录")).toBeVisible();

    // 选中 operations.py 条目 → 未生成 → 点「生成导读」
    await page
      .locator(".guide-tree-item", { hasText: "operations.py" })
      .click();
    await page.getByRole("button", { name: /生成导读/ }).click();

    // 流式完成 → fake 固定导读内容 + code 块定位头
    await expect(page.getByText("E2E 测试导读")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/operations.py:4-6/)).toBeVisible();

    // 代码块渲染真实源码切片
    await expect(page.locator(".guide-code-view .cm-content")).toContainText(
      "add_numbers",
    );

    // 点代码块定位头 → 跳回阅读模式并打开 operations.py
    await page.getByText(/operations.py:4-6/).click();
    await expect(page.locator(".guide-page")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toContainText("def add_numbers");
  });

  test("阅读模式有导读的文件显示「查看导读」入口", async ({ page }) => {
    await page.goto("/");
    if (await page.getByText(/尚未索引|无 Python/i).isVisible()) {
      await page.getByRole("button", { name: /索引/i }).first().click();
      await expect(page.getByText("main.py")).toBeVisible({ timeout: 15_000 });
    }

    // 先在导读模式为 operations.py 生成（幂等：上一条已生成则直接用缓存）
    await page.getByRole("button", { name: "导读" }).click();
    await page
      .locator(".guide-tree-item", { hasText: "operations.py" })
      .click();
    if (await page.getByRole("button", { name: /生成导读/ }).isVisible()) {
      await page.getByRole("button", { name: /生成导读/ }).click();
      await expect(page.getByText("E2E 测试导读")).toBeVisible({
        timeout: 15_000,
      });
    }

    // 回到阅读模式打开 operations.py → 右下角出现入口
    await page.getByRole("button", { name: "阅读" }).click();
    await page
      .locator(".file-tree .tree-item", { hasText: "operations.py" })
      .click();
    await expect(page.locator(".cm-content")).toBeVisible();

    const entry = page.getByRole("button", { name: /查看导读/ });
    await expect(entry).toBeVisible();

    // 点入口 → 进入导读模式并聚焦该文件
    await entry.click();
    await expect(page.getByText("导读目录")).toBeVisible();
    await expect(page.getByText("E2E 测试导读")).toBeVisible();
  });
});
