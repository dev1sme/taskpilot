import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { FIXTURE_REPO, openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("a built-in mode is read only until the repo creates an override", async ({ page }) => {
  await page.goto("/#/config/workflow?mode=default");
  await expect(page.getByText("Mặc định của TaskPilot · chỉ xem")).toBeVisible();
  await expect(page.getByText("Các bước")).toBeVisible();

  await page.getByRole("tab", { name: "Raw" }).click();
  await expect(page.getByText(/chỉ xem; tạo override để sửa/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu…" })).toHaveCount(0);

  await page.getByRole("button", { name: "Tạo override để sửa" }).click();
  await expect(page.getByText(/Override của repo/)).toBeVisible();
  expect(existsSync(path.join(FIXTURE_REPO, ".taskpilot/workflow.yml"))).toBe(true);
  await expect(page.getByRole("button", { name: "Lưu…" })).toBeVisible();

  await page.getByRole("button", { name: "Xoá override" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Xoá override" }).click();
  await expect(page.getByText("Mặc định của TaskPilot · chỉ xem")).toBeVisible();
  expect(existsSync(path.join(FIXTURE_REPO, ".taskpilot/workflow.yml"))).toBe(false);
});

test("the prompt preview renders a step's prompt for a sample task", async ({ page }) => {
  await page.goto("/#/config/workflow?mode=default");
  await page.getByText("Xem trước prompt").click();
  await page.getByRole("button", { name: "Hiện prompt" }).click();
  await expect(page.getByText(/Với task mẫu/)).toBeVisible();
});
