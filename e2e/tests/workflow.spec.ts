import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { FIXTURE_REPO, openFixtureRepo } from "../fixtures/repo";

test.beforeEach(async ({ page }) => {
  await openFixtureRepo(page);
});

test("a built-in mode is read only until the repo creates an override", async ({ page }) => {
  await page.goto("/#/config/workflow?mode=solo");
  await expect(page.getByText("Workflow có sẵn · chỉ xem")).toBeVisible();
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
  await expect(page.getByText("Workflow có sẵn · chỉ xem")).toBeVisible();
  expect(existsSync(path.join(FIXTURE_REPO, ".taskpilot/workflow.yml"))).toBe(false);
});

test("the prompt preview renders a step's prompt for a sample task", async ({ page }) => {
  await page.goto("/#/config/workflow?mode=solo");
  await page.getByText("Xem trước prompt").click();
  await page.getByRole("button", { name: "Hiện prompt" }).click();
  await expect(page.getByText(/Với task mẫu/)).toBeVisible();
});

test("Solo is the built-in workflow and default is no longer a mode", async ({ page }) => {
  const modesResponse = await page.request.get("/api/config/workflow/modes");
  expect(modesResponse.ok()).toBe(true);
  const { modes, selected } = await modesResponse.json();
  expect(modes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "solo", name: "Solo" }), expect.objectContaining({ id: "leader", name: "Leader" })]));
  expect(modes.some((mode: { id: string }) => mode.id === "default")).toBe(false);
  expect(selected).toBe("solo");
  const solo = await page.request.get("/api/config/workflow?mode=solo");
  expect(solo.ok()).toBe(true);
  const view = await solo.json();
  expect(view.mode).toMatchObject({ id: "solo", name: "Solo" });
  expect(view.dir).toContain("workflows/solo");
  expect(view.def.steps.map((step: { id: string }) => step.id)).toEqual(["investigate", "implement"]);
  expect((await page.request.get("/api/config/workflow?mode=default")).status()).toBe(400);
  expect((await page.request.put("/api/config/workflow/mode", { data: { mode: "default" } })).status()).toBe(400);
  expect((await page.request.post("/api/config/workflow/override", { data: { mode: "default" } })).status()).toBe(400);

  await page.goto("/#/config/workflow?mode=solo");
  await expect(page.getByRole("combobox").filter({ hasText: "Solo" })).toBeVisible();
});
