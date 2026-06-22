import path from "node:path";

import { chromium } from "playwright-core";
import { ensureDir, resolveChromePath, saveScreenshot, writeJsonFile } from "../../support/cover_shared.mjs";

const VIEWPORT = { width: 430, height: 932 };
const LIVE_A_DELAY_MS = 75_000;
const LIVE_B_DELAY_MS = 75_000;

function parseArgs(argv) {
  const config = {
    baseUrl: process.env.PUCKY_WORKSPACE_PROOF_BASE_URL || "http://127.0.0.1:8771",
    apiToken: resolveApiToken(),
    reportDir: path.resolve("artifacts", "reminders-v3-browser", new Date().toISOString().replace(/[:.]/g, "-")),
    timeoutMs: 30_000,
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
      config.timeoutMs = Math.max(1_000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--theme" && argv[index + 1]) {
      config.theme = String(argv[++index] || config.theme).trim().toLowerCase() || "light";
    } else if (arg === "--reminder-delivery" && argv[index + 1]) {
      config.reminderDeliveryMode = String(argv[++index] || config.reminderDeliveryMode).trim().toLowerCase() || "auto";
    }
  }
  return config;
}

function resolveApiToken() {
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
  void apiToken;
  return url.toString();
}

async function installAuthorizedApiProxy(context, baseUrl, apiToken) {
  const token = String(apiToken || "").trim();
  if (!token) {
    return;
  }
  const apiBase = `${String(baseUrl || "").replace(/\/+$/, "")}/api/**`;
  await context.route(apiBase, async route => {
    const request = route.request();
    const headers = { ...request.headers() };
    delete headers.origin;
    if (!headers.authorization) {
      headers.authorization = `Bearer ${token}`;
    }
    try {
      const response = await route.fetch({
        method: request.method(),
        headers,
        postData: request.postDataBuffer() || undefined
      });
      await route.fulfill({ response });
    } catch (error) {
      const detail = String(error?.message || error || "");
      if (/Request context disposed|Target page, context or browser has been closed/i.test(detail)) {
        await route.abort("failed");
        return;
      }
      throw error;
    }
  });
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

function reminderIsDismissed(reminder) {
  return String(reminder?.status || "").trim().toLowerCase() === "done";
}

function reminderIsSentHistory(reminder) {
  void reminder;
  return false;
}

function reminderIsSnoozed(reminder) {
  if (reminderIsDismissed(reminder) || reminderIsSentHistory(reminder)) {
    return false;
  }
  const meta = reminderMeta(reminder);
  const dueAtMs = Number(reminder?.due_at_ms || 0);
  return meta.snoozedUntilMs > Date.now() && meta.snoozedUntilMs === dueAtMs;
}

function reminderIsVisible(reminder) {
  return !reminderIsDismissed(reminder) && !reminderIsSentHistory(reminder);
}

function reminderIsLive(reminder) {
  if (!reminderIsVisible(reminder) || reminderIsSnoozed(reminder)) {
    return false;
  }
  const dueAtMs = Number(reminder?.due_at_ms || 0);
  return Number.isFinite(dueAtMs) && dueAtMs > 0 && dueAtMs <= Date.now();
}

async function activeReminderCount(config) {
  const payload = await apiRequest(config, "GET", "/api/workspace/reminders");
  return (payload?.items || []).filter(item => reminderIsVisible(item)).length;
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

async function backToRoute(page, route, timeoutMs) {
  for (let index = 0; index < 4; index += 1) {
    const currentRoute = await page.evaluate(() => document.querySelector(".light-shell")?.getAttribute("data-light-route") || "");
    if (currentRoute === route) {
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(250);
  }
  await waitForLightRoute(page, route, timeoutMs);
}

async function waitForReminderRecord(config, reminderId, predicate, description, timeoutMs) {
  const startedAt = Date.now();
  let lastRecord = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastRecord = await apiRequest(config, "GET", `/api/workspace/reminders/${reminderId}`);
    if (predicate(lastRecord)) {
      return lastRecord;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for reminder ${reminderId}: ${description}; last record ${JSON.stringify(lastRecord)}`);
}

async function waitForReminderRowState(page, reminderId, reminderState, timeoutMs) {
  await page.waitForFunction(({ targetId, targetState }) => {
    const row = document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`);
    return Boolean(row) && row.getAttribute("data-reminder-state") === targetState;
  }, { targetId: reminderId, targetState: reminderState }, { timeout: timeoutMs });
}

async function waitForReminderRowStateObserved(page, reminderId, reminderState, timeoutMs) {
  const handle = await page.waitForFunction(({ targetId, targetState }) => {
    const row = document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`);
    if (!row || row.getAttribute("data-reminder-state") !== targetState) {
      return null;
    }
    return {
      observedAtMs: Date.now(),
      rowText: String(row.textContent || "").trim()
    };
  }, { targetId: reminderId, targetState: reminderState }, { timeout: timeoutMs });
  const value = await handle.jsonValue();
  await handle.dispose();
  return value;
}

async function waitForReminderDetailStateObserved(page, expectedState, expectedActions, timeoutMs) {
  const handle = await page.waitForFunction(({ targetState, targetActions }) => {
    const card = document.querySelector('[data-reminder-detail-card="true"]');
    const shellText = String(document.querySelector(".light-shell")?.textContent || "");
    const actions = [...document.querySelectorAll('[data-reminder-action-row="true"] button')].map(node => String(node.textContent || "").trim());
    if (card?.getAttribute("data-reminder-state") !== targetState) {
      return null;
    }
    if (JSON.stringify(actions) !== JSON.stringify(targetActions)) {
      return null;
    }
    if (shellText.includes("Status:") || shellText.includes("Delivery:")) {
      return null;
    }
    return {
      observedAtMs: Date.now(),
      actions,
      route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || ""
    };
  }, { targetState: expectedState, targetActions: expectedActions }, { timeout: timeoutMs });
  const value = await handle.jsonValue();
  await handle.dispose();
  return value;
}

async function readReminderListState(page, reminderIds = []) {
  return page.evaluate(({ ids }) => {
    const titles = [...document.querySelectorAll(".light-section-title")].map(node => String(node.textContent || "").trim());
    const rows = ids.reduce((result, id) => {
      const row = document.querySelector(`.light-reminder-row[data-reminder-id="${id}"]`);
      result[id] = row ? {
        state: row.getAttribute("data-reminder-state") || "",
        text: String(row.textContent || "").trim()
      } : null;
      return result;
    }, {});
    return { sectionTitles: titles, rows };
  }, { ids: reminderIds });
}

async function readReminderDetailState(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-reminder-detail-card="true"]');
    const identity = card?.querySelector(".light-reminder-detail-identity");
    const icon = identity?.querySelector(".light-small-icon");
    const feed = document.querySelector('[data-reminder-detail-feed="true"]');
    const feedLabels = feed
      ? [...feed.querySelectorAll(".light-info-row .light-text-stack strong")].map(node => String(node.textContent || "").trim()).filter(Boolean)
      : [];
    const nativeTileLabels = feedLabels.filter(label => label === "When" || label === "Me");
    const actionLabels = [...document.querySelectorAll('[data-reminder-action-row="true"] button')].map(node => String(node.textContent || "").trim());
    const shellText = String(document.querySelector(".light-shell")?.textContent || "");
    const cardRect = card?.getBoundingClientRect?.() || null;
    const identityRect = identity?.getBoundingClientRect?.() || null;
    const iconRect = icon?.getBoundingClientRect?.() || null;
    return {
      route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
      reminderState: card?.getAttribute("data-reminder-state") || "",
      title: String(card?.querySelector(".light-reminder-detail-title")?.textContent || "").trim(),
      eyebrow: String(card?.querySelector(".light-reminder-detail-eyebrow")?.textContent || "").trim(),
      sectionTitles: [...document.querySelectorAll(".light-section-title")].map(node => String(node.textContent || "").trim()),
      actionLabels,
      actionRowCount: document.querySelectorAll('[data-reminder-action-row="true"]').length,
      connectedCount: document.querySelectorAll('[data-reminder-detail-feed="true"]').length,
      feedChevronCount: document.querySelectorAll(".light-reminder-detail-feed .light-chevron").length,
      feedLabels,
      nativeTileLabels,
      hasStatusText: shellText.includes("Status:"),
      hasDeliveryText: shellText.includes("Delivery:"),
      heroTopGap: cardRect && identityRect ? Math.round((identityRect.top - cardRect.top) * 10) / 10 : 0,
      heroIconTopGap: cardRect && iconRect ? Math.round((iconRect.top - cardRect.top) * 10) / 10 : 0,
    };
  });
}

async function readToastMessage(page) {
  return page.evaluate(() => String(window.PuckyUiDebug?.describe?.()?.toast?.message || "").trim());
}

async function readReminderCountdownState(page, reminderId) {
  return page.evaluate((targetId) => {
    const row = document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`);
    const countdown = row?.querySelector('[data-reminder-countdown="true"]');
    return {
      exists: Boolean(countdown),
      rowState: row?.getAttribute("data-reminder-state") || "",
      progress: Number(countdown?.getAttribute("data-reminder-progress") || 0),
      remainingMs: Number(countdown?.getAttribute("data-reminder-remaining-ms") || 0),
      label: String(countdown?.querySelector(".light-reminder-countdown-label")?.textContent || "").trim(),
    };
  }, reminderId);
}

async function assertNoToast(page, label) {
  const toastMessage = await readToastMessage(page);
  assert(!toastMessage, `${label} should not show an error toast, saw ${toastMessage || "<non-empty>"}`);
}

async function assertCompactReminderDetail(page, expectedState, expectedActions, options = {}) {
  const expectedConnectedLabels = Array.isArray(options.expectedConnectedLabels) ? options.expectedConnectedLabels : [];
  const detail = await readReminderDetailState(page);
  assert(detail.route === "reminder-detail", `Expected reminder-detail route, saw ${detail.route}`);
  assert(detail.reminderState === expectedState, `Expected reminder detail state ${expectedState}, saw ${detail.reminderState}`);
  assert(!detail.hasStatusText, "Reminder detail should not show Status text");
  assert(!detail.hasDeliveryText, "Reminder detail should not show Delivery text");
  assert(detail.nativeTileLabels.length === 0, `Expected reminder detail to omit reminder-native Connected rows, saw ${JSON.stringify(detail.nativeTileLabels)}`);
  assert(detail.heroTopGap >= 20, `Expected reminder hero top gap >= 20px, saw ${detail.heroTopGap}`);
  assert(detail.heroIconTopGap >= 20, `Expected reminder icon top gap >= 20px, saw ${detail.heroIconTopGap}`);
  if (!expectedConnectedLabels.length) {
    assert(detail.connectedCount === 0, `Expected no Connected feed when reminder has no graph links, saw ${detail.connectedCount}`);
    assert(!detail.sectionTitles.includes("Connected"), `Expected no Connected section title when reminder has no graph links, saw ${JSON.stringify(detail.sectionTitles)}`);
  } else {
    assert(detail.connectedCount === 1, `Expected one Connected feed, saw ${detail.connectedCount}`);
    assert(detail.feedChevronCount === 0, `Expected no reminder-detail chevrons, saw ${detail.feedChevronCount}`);
    assert(
      JSON.stringify(detail.feedLabels) === JSON.stringify(expectedConnectedLabels),
      `Expected Connected labels ${JSON.stringify(expectedConnectedLabels)}, saw ${JSON.stringify(detail.feedLabels)}`
    );
  }
  if (expectedActions.length === 0) {
    assert(detail.actionRowCount === 0, `Expected no reminder action row, saw ${detail.actionRowCount}`);
    return detail;
  }
  assert(detail.actionRowCount === 1, `Expected one reminder action row, saw ${detail.actionRowCount}`);
  assert(
    JSON.stringify(detail.actionLabels) === JSON.stringify(expectedActions),
    `Expected reminder actions ${JSON.stringify(expectedActions)}, saw ${JSON.stringify(detail.actionLabels)}`
  );
  return detail;
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
    assertions: [],
    lifecycle: {}
  };

  const reminderAId = `browser-proof-live-a-${Date.now()}`;
  const reminderBId = `browser-proof-live-b-${Date.now()}`;
  const createdReminderIds = [reminderAId];
  const baselineActive = await activeReminderCount(config);
  const reminderADueAtMs = Date.now() + LIVE_A_DELAY_MS;
  let reminderBDueAtMs = 0;

  await apiRequest(config, "POST", "/api/workspace/reminders", {
    id: reminderAId,
    title: "Browser Proof Live Reminder A",
    summary: "This reminder should move from Upcoming to Live, then snooze and refire.",
    status: "open",
    due_at_ms: reminderADueAtMs,
    metadata: {
      recipients: [{ id: "self", kind: "self", label: "Me" }],
      destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }],
    }
  });
  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: config.reportDir, size: VIEWPORT } });
  await installAuthorizedApiProxy(context, config.baseUrl, config.apiToken);
  const page = await context.newPage();

  try {
    const expectedInitialActive = baselineActive + 1;
    await page.goto(pageUrl(config.baseUrl, config.theme, config.apiToken), { waitUntil: "commit", timeout: config.timeoutMs });
    await waitForHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, expectedInitialActive, config.timeoutMs);
    summary.screenshots.home = await saveScreenshot(page, config.reportDir, "home");

    await openTile(page, "Reminders", "reminders", config.timeoutMs);
    await page.locator(`.light-reminder-row[data-reminder-id="${reminderAId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    const initialList = await readReminderListState(page, [reminderAId]);
    assert(initialList.sectionTitles.includes("UPCOMING"), `Expected Upcoming section, saw ${JSON.stringify(initialList.sectionTitles)}`);
    assert(!initialList.sectionTitles.includes("SNOOZED"), `Expected Snoozed section to stay removed, saw ${JSON.stringify(initialList.sectionTitles)}`);
    assert(initialList.rows[reminderAId]?.state === "upcoming", `Expected reminder A to start upcoming, saw ${initialList.rows[reminderAId]?.state}`);
    summary.screenshots.reminders_list_initial = await saveScreenshot(page, config.reportDir, "reminders-list-initial");

    await page.locator(`.light-reminder-row[data-reminder-id="${reminderAId}"]`).click();
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    await page.waitForFunction(() => Boolean(document.querySelector('[data-reminder-detail-card="true"]')), { timeout: config.timeoutMs });
    const detailUrlBeforeLive = await page.url();
    const aUpcomingDetail = await assertCompactReminderDetail(page, "upcoming", [], { expectedConnectedLabels: [] });
    await assertNoToast(page, "Upcoming reminder detail");
    summary.lifecycle.reminder_a_upcoming = aUpcomingDetail;
    summary.screenshots.a1_upcoming_detail = await saveScreenshot(page, config.reportDir, "a1-upcoming-detail");

    const aLiveObservation = await waitForReminderDetailStateObserved(
      page,
      "live",
      ["Dismiss", "Snooze"],
      LIVE_A_DELAY_MS + 90_000
    );
    assert(await page.url() === detailUrlBeforeLive, "Reminder A should become Live without a page reload");
    assert(
      Number(aLiveObservation?.observedAtMs || 0) <= reminderADueAtMs + 20_000,
      `Reminder A should become Live within 20s of due (${reminderADueAtMs}), saw ${aLiveObservation?.observedAtMs || 0}`
    );
    const aLiveDetail = await assertCompactReminderDetail(page, "live", ["Dismiss", "Snooze"], { expectedConnectedLabels: [] });
    await assertNoToast(page, "Live reminder detail");
    summary.lifecycle.reminder_a_live = {
      due_at_ms: reminderADueAtMs,
      observed_at_ms: Number(aLiveObservation?.observedAtMs || 0),
      detail: aLiveDetail
    };
    summary.screenshots.a2_live_detail = await saveScreenshot(page, config.reportDir, "a2-live-detail");

    await page.locator('[data-reminder-action="snooze"]').click();
    const aSnoozedRecord = await waitForReminderRecord(
      config,
      reminderAId,
      reminder => reminderIsSnoozed(reminder) && Number(reminder?.due_at_ms || 0) >= Date.now() + 70_000,
      "reminder A should snooze for roughly ninety seconds",
      30_000
    );
    assert(
      Number(aSnoozedRecord?.metadata?.snoozed_until_ms || 0) === Number(aSnoozedRecord?.due_at_ms || 0),
      `Reminder A snooze should keep due_at_ms and snoozed_until_ms aligned, saw ${Number(aSnoozedRecord?.due_at_ms || 0)} vs ${Number(aSnoozedRecord?.metadata?.snoozed_until_ms || 0)}`
    );
    await assertNoToast(page, "Reminder A snooze");
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-reminder-detail-card="true"]');
      return card?.getAttribute("data-reminder-state") === "snoozed"
        && !document.querySelector('[data-reminder-action-row="true"]');
    }, { timeout: config.timeoutMs });
    await backToRoute(page, "reminders", config.timeoutMs);
    await waitForReminderRowState(page, reminderAId, "snoozed", config.timeoutMs);
    const aCountdownStart = await readReminderCountdownState(page, reminderAId);
    assert(aCountdownStart.exists, "Reminder A should show a snoozed countdown in Upcoming");
    const afterSnoozeList = await readReminderListState(page, [reminderAId]);
    assert(afterSnoozeList.sectionTitles.includes("UPCOMING"), `Expected Upcoming after snooze, saw ${JSON.stringify(afterSnoozeList.sectionTitles)}`);
    assert(!afterSnoozeList.sectionTitles.includes("SNOOZED"), `Expected no Snoozed section after snooze, saw ${JSON.stringify(afterSnoozeList.sectionTitles)}`);
    summary.lifecycle.reminder_a_snoozed = {
      due_at_ms: Number(aSnoozedRecord?.due_at_ms || 0),
      countdown_start: aCountdownStart
    };
    summary.screenshots.a3_snoozed_upcoming = await saveScreenshot(page, config.reportDir, "a3-snoozed-upcoming");

    await page.waitForTimeout(30_000);
    const aCountdownMid = await readReminderCountdownState(page, reminderAId);
    assert(aCountdownMid.exists, "Reminder A countdown should still be visible after 30 seconds");
    assert(aCountdownMid.progress > aCountdownStart.progress, `Reminder A countdown progress should advance (${aCountdownStart.progress} -> ${aCountdownMid.progress})`);
    assert(aCountdownMid.remainingMs < aCountdownStart.remainingMs, `Reminder A countdown remaining time should shrink (${aCountdownStart.remainingMs} -> ${aCountdownMid.remainingMs})`);
    summary.lifecycle.reminder_a_snooze_mid = aCountdownMid;
    await page.waitForTimeout(30_000);
    const aCountdownLate = await readReminderCountdownState(page, reminderAId);
    assert(aCountdownLate.exists, "Reminder A countdown should still be visible during the second 30-second observation");
    assert(aCountdownLate.progress > aCountdownMid.progress, `Reminder A countdown should keep advancing (${aCountdownMid.progress} -> ${aCountdownLate.progress})`);
    assert(aCountdownLate.remainingMs < aCountdownMid.remainingMs, `Reminder A countdown should keep shrinking (${aCountdownMid.remainingMs} -> ${aCountdownLate.remainingMs})`);
    summary.lifecycle.reminder_a_snooze_late = aCountdownLate;

    const aRefireObservation = await waitForReminderRowStateObserved(page, reminderAId, "live", 90_000);
    assert(
      Number(aRefireObservation?.observedAtMs || 0) <= Number(aSnoozedRecord?.due_at_ms || 0) + 20_000,
      `Reminder A should refire into Live within 20s of snooze expiry (${Number(aSnoozedRecord?.due_at_ms || 0)}), saw ${aRefireObservation?.observedAtMs || 0}`
    );
    await page.locator(`.light-reminder-row[data-reminder-id="${reminderAId}"]`).click();
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    const aRefiredDetail = await assertCompactReminderDetail(page, "live", ["Dismiss", "Snooze"], { expectedConnectedLabels: [] });
    summary.lifecycle.reminder_a_refired = {
      observed_at_ms: Number(aRefireObservation?.observedAtMs || 0),
      detail: aRefiredDetail
    };
    summary.screenshots.a4_refired_live_detail = await saveScreenshot(page, config.reportDir, "a4-refired-live-detail");

    await page.locator('[data-reminder-action="dismiss"]').click();
    await waitForReminderRecord(
      config,
      reminderAId,
      reminder => reminderIsDismissed(reminder),
      "reminder A should dismiss after refiring",
      30_000
    );
    await assertNoToast(page, "Reminder A dismiss");
    await waitForLightRoute(page, "reminders", config.timeoutMs);
    await page.waitForFunction((targetId) => !document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`), reminderAId, { timeout: config.timeoutMs });
    await backToHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, baselineActive, config.timeoutMs);
    summary.screenshots.a5_home_after_final_dismiss = await saveScreenshot(page, config.reportDir, "a5-home-after-final-dismiss");

    reminderBDueAtMs = Date.now() + LIVE_B_DELAY_MS;
    await apiRequest(config, "POST", "/api/workspace/reminders", {
      id: reminderBId,
      title: "Browser Proof Live Reminder B",
      summary: "This reminder should dismiss cleanly on first fire.",
      status: "open",
      due_at_ms: reminderBDueAtMs,
      metadata: {
        recipients: [{ id: "self", kind: "self", label: "Me" }],
        destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }],
      }
    });
    createdReminderIds.push(reminderBId);
    await waitForReminderBadge(page, baselineActive + 1, config.timeoutMs);
    await openTile(page, "Reminders", "reminders", config.timeoutMs);
    await page.locator(`.light-reminder-row[data-reminder-id="${reminderBId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    const reminderBInitial = await readReminderListState(page, [reminderBId]);
    assert(reminderBInitial.rows[reminderBId]?.state === "upcoming", `Expected reminder B to start upcoming, saw ${reminderBInitial.rows[reminderBId]?.state}`);

    const bLiveObservation = await waitForReminderRowStateObserved(page, reminderBId, "live", LIVE_B_DELAY_MS + 90_000);
    assert(
      Number(bLiveObservation?.observedAtMs || 0) <= reminderBDueAtMs + 20_000,
      `Reminder B should become Live within 20s of due (${reminderBDueAtMs}), saw ${bLiveObservation?.observedAtMs || 0}`
    );
    const liveList = await readReminderListState(page, [reminderBId]);
    assert(liveList.sectionTitles.includes("LIVE"), `Expected Live section when reminder B fires, saw ${JSON.stringify(liveList.sectionTitles)}`);
    assert(liveList.rows[reminderBId]?.state === "live", `Expected reminder B to become live, saw ${liveList.rows[reminderBId]?.state}`);
    summary.lifecycle.reminder_b_live = {
      ...liveList.rows[reminderBId],
      observed_at_ms: Number(bLiveObservation?.observedAtMs || 0)
    };
    summary.screenshots.b1_live_list = await saveScreenshot(page, config.reportDir, "b1-live-list");

    await page.locator(`.light-reminder-row[data-reminder-id="${reminderBId}"]`).click();
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    await assertCompactReminderDetail(page, "live", ["Dismiss", "Snooze"], { expectedConnectedLabels: [] });
    await page.locator('[data-reminder-action="dismiss"]').click();
    await waitForReminderRecord(
      config,
      reminderBId,
      reminder => reminderIsDismissed(reminder),
      "reminder B should dismiss on first fire",
      30_000
    );
    await assertNoToast(page, "Reminder B dismiss");
    await waitForLightRoute(page, "reminders", config.timeoutMs);
    await page.waitForFunction((targetId) => !document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`), reminderBId, { timeout: config.timeoutMs });
    await backToHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, baselineActive, config.timeoutMs);
    summary.screenshots.b2_home_after_dismiss = await saveScreenshot(page, config.reportDir, "b2-home-after-dismiss");

    summary.assertions.push("Reminder detail stays compact, hides status/delivery pills, shows Dismiss and Snooze only while live, and hides Connected entirely when a proof reminder has no graph links.");
    summary.assertions.push("Live reminders expose Dismiss and Snooze only when firing, while Upcoming reminders stay action-free.");
    summary.assertions.push("Snoozed reminders remain inside Upcoming with a live countdown ring and refire into Live without manual reload.");

    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  } finally {
    try {
      await browser.close();
    } catch {}
    for (const reminderId of createdReminderIds) {
      try {
        await apiRequest(config, "DELETE", `/api/workspace/reminders/${reminderId}`);
      } catch {}
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
