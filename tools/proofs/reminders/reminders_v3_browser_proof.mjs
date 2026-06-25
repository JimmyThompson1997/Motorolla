import path from "node:path";

import { chromium } from "playwright-core";
import { ensureDir, resolveChromePath, saveScreenshot, writeJsonFile } from "../../support/cover_shared.mjs";

const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    baseUrl: process.env.PUCKY_WORKSPACE_PROOF_BASE_URL || "http://127.0.0.1:8771",
    apiToken: resolveApiToken(),
    reportDir: path.resolve("artifacts", "reminders-v3-browser", new Date().toISOString().replace(/[:.]/g, "-")),
    timeoutMs: 30000,
    theme: "light",
    reminderDeliveryMode: process.env.PUCKY_REMINDER_DELIVERY_MODE || "auto"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).replace(/\/+$/, "");
    } else if (arg === "--api-token" && argv[index + 1]) {
      config.apiToken = String(argv[++index] || config.apiToken);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--theme" && argv[index + 1]) {
      config.theme = String(argv[++index] || config.theme).trim().toLowerCase() || "light";
    } else if (arg === "--reminder-delivery" && argv[index + 1]) {
      config.reminderDeliveryMode = String(argv[++index] || config.reminderDeliveryMode).trim().toLowerCase() || "auto";
    }
  }
  return config;
}

function resolveApiToken() {
  const webToken = String(process.env.PUCKY_WEB_UI_TOKEN || "").trim();
  if (webToken) {
    return webToken;
  }
  const proofToken = String(process.env.PUCKY_WORKSPACE_PROOF_TOKEN || "").trim();
  if (proofToken) {
    return proofToken;
  }
  return String(process.env.PUCKY_API_TOKEN || "").trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pageUrl(baseUrl, theme, apiToken = "") {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/ui/pucky/latest/index.html`);
  url.searchParams.set("theme", theme);
  url.searchParams.set("route", "home");
  url.searchParams.set("reset_nav", "1");
  if (String(apiToken || "").trim()) {
    url.searchParams.set("api_token", String(apiToken || "").trim());
  }
  return url.toString();
}

function shouldRunReminderDelivery(config) {
  const mode = String(config.reminderDeliveryMode || "auto").trim().toLowerCase();
  if (mode === "always") {
    return true;
  }
  if (mode === "never") {
    return false;
  }
  return /pucky\.fly\.dev/i.test(String(config.baseUrl || ""));
}

async function apiRequest(config, method, apiPath, body = undefined) {
  const headers = { Accept: "application/json" };
  if (config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }
  const response = await fetch(`${config.baseUrl}${apiPath}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${apiPath} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

function reminderMeta(reminder) {
  const metadata = reminder && typeof reminder === "object" && reminder.metadata && typeof reminder.metadata === "object"
    ? reminder.metadata
    : {};
  return {
    deliveryState: String(metadata.delivery_state || "").trim().toLowerCase(),
    snoozedUntilMs: Number(metadata.snoozed_until_ms || 0),
    lastFiredDueAtMs: Number(metadata.last_fired_due_at_ms || 0)
  };
}

function reminderIsSnoozed(reminder) {
  const meta = reminderMeta(reminder);
  const dueAtMs = Number(reminder?.due_at_ms || 0);
  return meta.snoozedUntilMs > Date.now() && meta.snoozedUntilMs === dueAtMs;
}

function reminderIsActive(reminder) {
  if (String(reminder?.status || "").trim().toLowerCase() === "done") {
    return false;
  }
  const meta = reminderMeta(reminder);
  const dueAtMs = Number(reminder?.due_at_ms || 0);
  if (reminderIsSnoozed(reminder)) {
    return false;
  }
  return !(meta.deliveryState === "sent" && meta.lastFiredDueAtMs > 0 && meta.lastFiredDueAtMs === dueAtMs);
}

async function activeReminderCount(config) {
  const payload = await apiRequest(config, "GET", "/api/workspace/reminders");
  return (payload?.items || []).filter(item => reminderIsActive(item)).length;
}

async function waitForHome(page, theme, timeoutMs) {
  await page.waitForFunction((expectedTheme) => {
    const shell = document.querySelector(".app-shell");
    const home = document.querySelector('.light-shell[data-light-route="home"]');
    return Boolean(shell && shell.getAttribute("data-theme") === expectedTheme && home);
  }, theme, { timeout: timeoutMs });
}

async function waitForLightRoute(page, route, timeoutMs) {
  await page.waitForFunction((targetRoute) => {
    return document.querySelector(".light-shell")?.getAttribute("data-light-route") === targetRoute;
  }, route, { timeout: timeoutMs });
}

async function waitForReminderBadge(page, count, timeoutMs) {
  await page.waitForFunction((expectedCount) => {
    const badge = document.querySelector('.light-app-tile[data-app-label="Reminders"] .light-app-badge');
    if (expectedCount <= 0) {
      return !badge;
    }
    return Boolean(badge) && String(badge.textContent || "").trim() === String(expectedCount);
  }, count, { timeout: timeoutMs });
}

async function openTile(page, label, route, timeoutMs) {
  await page.locator(`.light-app-tile[data-app-label="${label}"]`).click({ timeout: timeoutMs });
  await waitForLightRoute(page, route, timeoutMs);
}

async function backToHome(page, theme, timeoutMs) {
  for (let index = 0; index < 4; index += 1) {
    const isHome = await page.locator('.light-shell[data-light-route="home"]').count();
    if (isHome) {
      await waitForHome(page, theme, timeoutMs);
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(250);
  }
  await waitForHome(page, theme, timeoutMs);
}

async function waitForReminderState(config, reminderId, predicate, description, timeoutMs) {
  const startedAt = Date.now();
  let lastRecord = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastRecord = await apiRequest(config, "GET", `/api/workspace/reminders/${reminderId}`);
    if (predicate(lastRecord)) {
      return lastRecord;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for reminder ${reminderId}: ${description}; last record ${JSON.stringify(lastRecord)}`);
}

async function openReminderDetail(page, reminderId, timeoutMs) {
  const row = page.locator(`[data-reminder-id="${reminderId}"]`).first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });
  await row.click({ force: true });
  await waitForLightRoute(page, "reminder-detail", timeoutMs);
}

async function waitForLiveReminderActions(page, timeoutMs) {
  await page.waitForFunction(() => {
    return Boolean(document.querySelector('[data-reminder-action="dismiss"]'))
      && Boolean(document.querySelector('[data-reminder-action="snooze"]'));
  }, { timeout: timeoutMs });
}

async function assertNoReminderActionErrorToast(page) {
  const text = String(await page.evaluate(() => document.body?.innerText || ""));
  const lower = text.toLowerCase();
  assert(!lower.includes("workspace_write_failed"), "Expected reminder action success path to avoid an error toast");
  assert(!lower.includes("missing_phone_target"), "Expected reminder action success path to avoid leaking orphan target errors");
  assert(!lower.includes("unknown_reminder_recipient"), "Expected reminder action success path to avoid orphan-recipient validation errors");
}

async function backToReminders(page, timeoutMs) {
  const backButton = page.getByRole("button", { name: "Back" }).first();
  if (await backButton.count()) {
    await backButton.click({ timeout: timeoutMs });
  } else {
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  }
  await waitForLightRoute(page, "reminders", timeoutMs);
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const summary = {
    schema: "pucky.reminders_v3_browser_proof.v1",
    base_url: config.baseUrl,
    theme: config.theme,
    reminder_delivery_mode: config.reminderDeliveryMode,
    screenshots: {},
    assertions: []
  };

  const orphanContactId = `browser-proof-orphan-contact-${Date.now()}`;
  const orphanDismissReminderId = `browser-proof-orphan-dismiss-${Date.now()}`;
  const orphanSnoozeReminderId = `browser-proof-orphan-snooze-${Date.now()}`;
  const dormantDueAtMs = Date.now() + 30 * 60 * 1000;
  const baselineActive = await activeReminderCount(config);

  await apiRequest(config, "POST", "/api/workspace/contacts", {
    id: orphanContactId,
    title: "Browser Proof Orphan Contact",
    summary: "Temporary contact for orphaned reminder action verification.",
    metadata: {
      phone: "+14155550168",
    }
  });
  await apiRequest(config, "POST", "/api/workspace/reminders", {
    id: orphanDismissReminderId,
    title: "Browser Proof Orphan Dismiss",
    summary: "Dismiss should still work after the linked recipient contact is deleted.",
    status: "open",
    due_at_ms: dormantDueAtMs,
    metadata: {
      recipients: [
        { id: "self", kind: "self", label: "Me" },
        { id: orphanContactId, kind: "contact", contact_id: orphanContactId, label: "Browser Proof Orphan Contact" },
      ],
      destinations: [{ channel: "sms", recipient_ids: [orphanContactId] }],
    }
  });
  await apiRequest(config, "POST", "/api/workspace/reminders", {
    id: orphanSnoozeReminderId,
    title: "Browser Proof Orphan Snooze",
    summary: "Snooze should still work after the linked recipient contact is deleted.",
    status: "open",
    due_at_ms: dormantDueAtMs,
    metadata: {
      recipients: [
        { id: "self", kind: "self", label: "Me" },
        { id: orphanContactId, kind: "contact", contact_id: orphanContactId, label: "Browser Proof Orphan Contact" },
      ],
      destinations: [{ channel: "sms", recipient_ids: [orphanContactId] }],
    }
  });
  let expectedActive = baselineActive + 2;
  await apiRequest(config, "DELETE", `/api/workspace/contacts/${orphanContactId}`);
  for (const reminderId of [orphanDismissReminderId, orphanSnoozeReminderId]) {
    await apiRequest(config, "PATCH", `/api/workspace/reminders/${reminderId}`, {
      due_at_ms: Date.now() - 60_000,
      metadata: {
        delivery_state: "pending",
        last_fired_at_ms: 0,
        last_fired_due_at_ms: 0,
        last_delivery_error: "",
        snoozed_until_ms: 0,
      }
    });
  }

  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: config.reportDir, size: VIEWPORT } });
  const page = await context.newPage();
  try {
    await page.goto(pageUrl(config.baseUrl, config.theme, config.apiToken), { waitUntil: "commit", timeout: config.timeoutMs });
    await waitForHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, expectedActive, config.timeoutMs);
    summary.screenshots.home = await saveScreenshot(page, config.reportDir, "home");
    await openTile(page, "Reminders", "reminders", config.timeoutMs);
    await page.locator(`[data-reminder-id="${orphanDismissReminderId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.locator(`[data-reminder-id="${orphanSnoozeReminderId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    summary.screenshots.reminders_list_before_actions = await saveScreenshot(page, config.reportDir, "reminders-list-before-actions");

    await openReminderDetail(page, orphanDismissReminderId, config.timeoutMs);
    await waitForLiveReminderActions(page, config.timeoutMs);
    summary.screenshots.orphan_dismiss_before = await saveScreenshot(page, config.reportDir, "orphan-dismiss-before");
    await page.locator('[data-reminder-action="dismiss"]').click();
    await waitForReminderState(
      config,
      orphanDismissReminderId,
      reminder => String(reminder?.status || "").trim().toLowerCase() === "done",
      "orphan dismiss reminder should mark done",
      30_000
    );
    expectedActive -= 1;
    await waitForLightRoute(page, "reminders", config.timeoutMs);
    await page.waitForFunction((targetId) => !document.querySelector(`[data-reminder-id="${targetId}"]`), orphanDismissReminderId, { timeout: config.timeoutMs });
    await assertNoReminderActionErrorToast(page);
    summary.screenshots.orphan_dismiss_after = await saveScreenshot(page, config.reportDir, "orphan-dismiss-after");

    await openReminderDetail(page, orphanSnoozeReminderId, config.timeoutMs);
    await waitForLiveReminderActions(page, config.timeoutMs);
    summary.screenshots.orphan_snooze_before = await saveScreenshot(page, config.reportDir, "orphan-snooze-before");
    await page.locator('[data-reminder-action="snooze"]').click();
    const snoozed = await waitForReminderState(
      config,
      orphanSnoozeReminderId,
      reminder => reminderIsSnoozed(reminder) && Number(reminder?.due_at_ms || 0) > Date.now() + 60_000,
      "orphan snooze reminder should move back into non-live state",
      30_000
    );
    expectedActive -= 1;
    await page.waitForFunction(() => {
      const route = document.querySelector(".light-shell")?.getAttribute("data-light-route") || "";
      if (route !== "reminder-detail" && route !== "reminders") {
        return false;
      }
      return !document.querySelector('[data-reminder-action="dismiss"]')
        && !document.querySelector('[data-reminder-action="snooze"]');
    }, { timeout: config.timeoutMs });
    if (await page.locator('.light-shell[data-light-route="reminder-detail"]').count()) {
      summary.screenshots.orphan_snooze_after_detail = await saveScreenshot(page, config.reportDir, "orphan-snooze-after-detail");
      await backToReminders(page, config.timeoutMs);
    }
    await page.locator(`[data-reminder-id="${orphanSnoozeReminderId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    const rowState = String(await page.locator(`[data-reminder-id="${orphanSnoozeReminderId}"]`).getAttribute("data-reminder-state") || "").trim().toLowerCase();
    assert(rowState !== "live", `Expected snoozed orphan reminder to leave the live bucket, saw ${rowState || "(missing state)"}`);
    assert(Number(snoozed?.metadata?.snoozed_until_ms || 0) === Number(snoozed?.due_at_ms || 0), "Expected snoozed orphan reminder to keep due_at_ms and snoozed_until_ms aligned");
    await assertNoReminderActionErrorToast(page);
    summary.screenshots.orphan_snooze_after = await saveScreenshot(page, config.reportDir, "orphan-snooze-after");

    await backToHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, expectedActive, config.timeoutMs);
    summary.screenshots.home_after_actions = await saveScreenshot(page, config.reportDir, "home-after-actions");

    summary.assertions.push("Orphaned-recipient reminders still expose live reminder actions after the linked contact is deleted");
    summary.assertions.push("Dismiss returns to the reminders list, removes the reminder from the active set, and avoids an error toast");
    summary.assertions.push("Snooze updates due_at_ms plus snoozed_until_ms, removes live actions, and avoids an error toast");
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  } finally {
    try {
      await browser.close();
    } catch {}
    for (const reminderId of [orphanDismissReminderId, orphanSnoozeReminderId]) {
      if (!reminderId) {
        continue;
      }
      try {
        await apiRequest(config, "DELETE", `/api/workspace/reminders/${reminderId}`, undefined);
      } catch {}
    }
    try {
      await apiRequest(config, "DELETE", `/api/workspace/contacts/${orphanContactId}`, undefined);
    } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
