import { expect, test } from "@playwright/test";
import { openFixtureRepo } from "../fixtures/repo";

// Runs are faked at the network layer: starting a real one would launch claude.
test("a task is started in the mode picked, with no override", async ({ page }) => {
  await openFixtureRepo(page);
  await page.request.put("/api/config/workflow/mode", { data: { mode: "default" } }); // writes .taskpilot/settings.yml
  const steps = [{ id: "investigate", title: "Điều tra & lên kế hoạch", gate: "approve", doneFile: "02-plan.md", outputs: [{ id: "plan", file: "02-plan.md" }] }];
  const mode = { id: "default", name: "Mặc định", override: false };
  await page.route("**/api/tasks/PROJ-1/run", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { workflow: { source: "default", origin: "default", mode, historyFile: "00-history.md", steps, outdated: false }, run: null, questions: [] } })
      : route.fallback(),
  );
  const bodies: unknown[] = [];
  await page.route("**/api/tasks/PROJ-1/run", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 500, json: { error: "stop here" } });
  });

  await page.goto("/#/tasks/PROJ-1");
  await expect(page.getByText("Cách chạy: Mặc định")).toBeVisible();
  await page.getByRole("combobox", { name: "Cách chạy" }).selectOption({ label: "Leader" });
  await page.getByRole("button", { name: "Bắt đầu quy trình" }).click();
  await expect.poll(() => bodies).toEqual([{ mode: "leader" }]);
});
