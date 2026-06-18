import path from "node:path";

import { chromium } from "playwright-core";
import { ensureDir, resolveChromePath, saveScreenshot, writeJsonFile } from "./cover_shared.mjs";

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
    lastFiredDueAtMs: Number(metadata.last_fired_due_at_ms || 0)
  };
}

function reminderIsActive(reminder) {
  if (String(reminder?.status || "").trim().toLowerCase() === "done") {
    return false;
  }
  const meta = reminderMeta(reminder);
  const dueAtMs = Number(reminder?.due_at_ms || 0);
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

  const deliveryEnabled = shouldRunReminderDelivery(config);
  const manageReminderId = `browser-proof-manage-${Date.now()}`;
  const phoneReminderId = `browser-proof-phone-${Date.now()}`;
  const baselineActive = await activeReminderCount(config);

  await apiRequest(config, "POST", "/api/workspace/reminders", {
    id: manageReminderId,
    title: "Browser Proof Manage Reminder",
    summary: "Reminder detail should stay clean.",
    status: "open",
    due_at_ms: Date.now() + 30 * 60 * 1000,
    metadata: {
      recipients: [{ id: "self", kind: "self", label: "Me" }],
      destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }],
    }
  });
  let expectedActive = baselineActive + 1;
  if (deliveryEnabled) {
    await apiRequest(config, "POST", "/api/workspace/reminders", {
      id: phoneReminderId,
      title: "Browser Proof Phone Reminder",
      summary: "Reminder should disappear after successful phone delivery.",
      status: "open",
      due_at_ms: Date.now() + 5_000,
      metadata: {
        recipients: [{ id: "self", kind: "self", label: "Me" }],
        destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }],
      }
    });
    expectedActive += 1;
  }

  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: config.reportDir, size: VIEWPORT } });
  const page = await context.newPage();
  try {
    await page.goto(pageUrl(config.baseUrl, config.theme, config.apiToken), { waitUntil: "commit", timeout: config.timeoutMs });
    await waitForHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, expectedActive, config.timeoutMs);
    summary.screenshots.home = await saveScreenshot(page, config.reportDir, "home");

    await openTile(page, "Contacts", "contacts", config.timeoutMs);
    const firstContact = page.locator("button[data-contact-id]").first();
    await firstContact.waitFor({ state: "visible", timeout: config.timeoutMs });
    const firstContactId = String(await firstContact.getAttribute("data-contact-id") || "");
    assert(firstContactId === "contact-me", `Expected Me pinned first, saw ${firstContactId}`);
    summary.screenshots.contacts = await saveScreenshot(page, config.reportDir, "contacts-list");
    await page.locator('button[data-contact-id="contact-me"]').click();
    await waitForLightRoute(page, "contact-detail", config.timeoutMs);
    await page.getByText("Me").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    summary.screenshots.me_detail = await saveScreenshot(page, config.reportDir, "contacts-me-detail");
    await page.getByRole("button", { name: "Edit Me" }).click({ timeout: config.timeoutMs });
    await waitForLightRoute(page, "contact-edit", config.timeoutMs);
    await page.getByPlaceholder("Email").waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.getByPlaceholder("Phone").waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.getByPlaceholder("Preferred reminder device id").waitFor({ state: "visible", timeout: config.timeoutMs });
    summary.screenshots.me_edit = await saveScreenshot(page, config.reportDir, "contacts-me-edit");
    await backToHome(page, config.theme, config.timeoutMs);

    await waitForReminderBadge(page, expectedActive, config.timeoutMs);
    await openTile(page, "Reminders", "reminders", config.timeoutMs);
    await page.locator(`[data-reminder-id="${manageReminderId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.waitForFunction(() => {
      const text = document.body.innerText || "";
      return !text.includes("Sent") && !text.includes("Failed") && !text.includes("Done");
    }, { timeout: config.timeoutMs });
    const rowChipCount = await page.locator(`[data-reminder-id="${manageReminderId}"] .light-graph-chip-row`).count();
    assert(rowChipCount === 0, `Expected no linked chips on reminder rows, saw ${rowChipCount}`);
    summary.screenshots.reminders_list = await saveScreenshot(page, config.reportDir, "reminders-list");

    await page.locator('[data-reminder-id^="demo-reminder-"]').first().click({ force: true });
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    await page.waitForFunction(() => (document.body.innerText || "").toUpperCase().includes("LINKED RECORDS"), { timeout: config.timeoutMs });
    summary.screenshots.reminder_linked_detail = await saveScreenshot(page, config.reportDir, "reminder-linked-detail");
    await backToHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, expectedActive, config.timeoutMs);
    await openTile(page, "Reminders", "reminders", config.timeoutMs);
    await page.locator(`[data-reminder-id="${manageReminderId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });

    await page.locator(`[data-reminder-id="${manageReminderId}"]`).click({ force: true });
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    await page.waitForFunction(() => {
      const text = (document.body.innerText || "").toUpperCase();
      return text.includes("SCHEDULE")
        && text.includes("RECIPIENTS")
        && text.includes("CHANNELS")
        && text.includes("SNOOZE 10 MIN")
        && text.includes("DISMISS")
        && text.includes("ME")
        && !text.includes("SELF")
        && !text.includes("MARK DONE");
    }, { timeout: config.timeoutMs });
    await page.waitForFunction(() => !document.querySelector(".light-detail-html-body .light-html-frame"), { timeout: config.timeoutMs });
    summary.screenshots.reminder_detail = await saveScreenshot(page, config.reportDir, "reminder-detail");

    await page.getByRole("button", { name: "Snooze 10 min" }).click({ timeout: config.timeoutMs });
    await page.waitForFunction(() => (document.body.innerText || "").includes("Snoozed"), { timeout: config.timeoutMs });
    summary.screenshots.reminder_snoozed = await saveScreenshot(page, config.reportDir, "reminder-snoozed");
    await backToHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, expectedActive, config.timeoutMs);

    await openTile(page, "Reminders", "reminders", config.timeoutMs);
    await page.locator(`[data-reminder-id="${manageReminderId}"]`).click({ force: true });
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    await page.getByRole("button", { name: "Dismiss" }).click({ timeout: config.timeoutMs });
    await waitForLightRoute(page, "reminders", config.timeoutMs);
    expectedActive -= 1;
    await backToHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, expectedActive, config.timeoutMs);
    summary.screenshots.reminder_dismissed = await saveScreenshot(page, config.reportDir, "reminder-dismissed");

    if (deliveryEnabled) {
      await openTile(page, "Reminders", "reminders", config.timeoutMs);
      const sentPhone = await waitForReminderState(
        config,
        phoneReminderId,
        reminder => String(reminder?.metadata?.delivery_state || "").trim().toLowerCase() === "sent",
        "phone reminder should send",
        45_000
      );
      expectedActive -= 1;
      await page.waitForFunction((targetId) => !document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`), phoneReminderId, { timeout: config.timeoutMs });
      summary.screenshots.reminder_phone_sent = await saveScreenshot(page, config.reportDir, "reminder-phone-sent");
      await backToHome(page, config.theme, config.timeoutMs);
      await waitForReminderBadge(page, expectedActive, config.timeoutMs);
      summary.phone_delivery = sentPhone?.metadata?.last_delivery_results || [];
    }

    summary.assertions.push("Me is pinned first in Contacts and exposes editable reminder delivery fields");
    summary.assertions.push("Reminders stay active-only, hide row chips, and keep schedule/recipients/channels/linked-records on detail only");
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  } finally {
    try {
      await browser.close();
    } catch {}
    for (const reminderId of [manageReminderId, phoneReminderId]) {
      if (!reminderId) {
        continue;
      }
      try {
        await apiRequest(config, "DELETE", `/api/workspace/reminders/${reminderId}`, undefined);
      } catch {}
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
