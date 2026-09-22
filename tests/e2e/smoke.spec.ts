import { test, expect, type Page } from "@playwright/test";

async function mockGuestShell(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Not signed in." }),
    });
  });
  await page.route("**/api/sessions**", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Not signed in." }),
    });
  });
  await page.route("**/api/workspaces**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspaces: [{ id: "agent", label: "Agent" }] }),
    });
  });
  await page.route("**/api/documents", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        documents: [
          {
            id: "doc-test-1",
            name: "notes.txt",
            mimeType: "text/plain",
            size: 5,
            text: "[notes.txt — Lines 1-1]\nhello",
            sources: [{ locator: "L1-L1", label: "Lines 1-1", text: "hello" }],
          },
        ],
        errors: [],
      }),
    });
  });
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      body: "\u2400MODEL:deepseek-v4-flash\u2400Hello from the browser test.",
    });
  });
}

async function mockAuthenticatedShell(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          _id: "507f1f77bcf86cd799439011",
          username: "alice",
          displayName: "Alice",
        },
      }),
    });
  });
  await page.route("**/api/workspaces**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workspaces: [{ id: "agent", label: "Agent" }],
      }),
    });
  });
  await page.route("**/api/sessions**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessions: [
            {
              _id: "session-1",
              title: "Existing session",
              workspaceId: "agent",
              updatedAt: "2026-09-22T00:00:00.000Z",
              pinned: false,
            },
          ],
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/auth/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          _id: "507f1f77bcf86cd799439011",
          username: "alice",
          displayName: "Updated Alice",
        },
      }),
    });
  });
  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

test.describe("guest chat shell", () => {
  test.beforeEach(async ({ page }) => {
    await mockGuestShell(page);
    await page.goto("/");
    await expect(page.locator("textarea[aria-label]")).toBeVisible();
  });

  test("sends a message and renders the streamed reply", async ({ page }) => {
    const input = page.locator("textarea[aria-label]");
    await input.fill("hello from Playwright");
    await page.locator("button.send-button").click();

    await expect(page.locator(".message.user")).toContainText("hello from Playwright");
    await expect(page.locator(".message.model")).toContainText("Hello from the browser test.");
  });

  test("guest build mode stays locked", async ({ page }) => {
    const buildButton = page.locator(".composer-mode-btn-build");
    await expect(buildButton).toBeDisabled();
    await expect(buildButton).toHaveAttribute("aria-disabled", "true");
  });

  test("auth modal switches between sign-in and registration", async ({ page }) => {
    await page.locator(".login-circle").click();
    await expect(page.locator(".auth-modal")).toBeVisible();
    await page.locator(".auth-toggle").click();
    await expect(page.locator(".auth-modal h2")).toContainText(/创建|Create|注册/);
  });

  test("opens the model picker and uploads a document attachment", async ({ page }) => {
    await page.locator(".composer-model-pill").click();
    await expect(page.locator(".composer-model-menu")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await expect(page.locator(".document-chip")).toContainText("notes.txt");
  });

  test("opens system settings from the guest sidebar", async ({ page }) => {
    await page.locator(".settings-button").click();
    const dialog = page.locator(".settings-modal").last();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/系统设置|System settings/);
    await expect(dialog).toContainText(/语言|Language/);
  });
});

test("mobile sidebar opens from the menu button", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockGuestShell(page);
  await page.goto("/");
  await page.locator(".menu-button").click();

  await expect(page.locator("aside.sidebar.open")).toBeVisible();
  await expect(page.locator(".sidebar-backdrop")).toBeVisible();
});

test("authenticated users can update their display name", async ({ page }) => {
  await mockAuthenticatedShell(page);
  await page.goto("/");
  await expect(page.locator(".account-identity")).toContainText("Alice");
  await page.locator(".account-identity").click();
  await expect(page.locator(".settings-modal").last()).toContainText("Alice");
  await page.locator(".account-display-trigger").click();
  await page.locator("#account-display-name").fill("Updated Alice");
  await page.locator("#account-display-name").press("Enter");
  await expect(page.locator(".account-identity")).toContainText("Updated Alice");
});
