import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";
import { ensureDir, resolveChromePath, saveScreenshot, writeJsonFile } from "../../support/cover_shared.mjs";

const VIEWPORT = { width: 430, height: 932 };
const LIVE_TO_SNOOZE_DELAY_MS = 4_000;
const UPCOMING_COMPARISON_DELAY_MS = 30 * 60 * 1000;
const LIST_ICON_SAMPLE_INTERVAL_MS = 250;
const LIST_ICON_SAMPLE_DURATION_MS = 8_000;
const LIST_ICON_SCREENSHOT_AT_MS = [0, 2_000, 4_000, 6_000];
const COUNTDOWN_SAMPLE_INTERVAL_MS = 1_000;
const COUNTDOWN_SAMPLE_DURATION_MS = 12_000;
const COUNTDOWN_SCREENSHOT_AT_MS = [0, 4_000, 8_000, 12_000];

function parseArgs(argv) {
  const config = {
    baseUrl: process.env.PUCKY_WORKSPACE_PROOF_BASE_URL || "http://127.0.0.1:8771",
    apiToken: resolveApiToken(),
    reportDir: path.resolve("artifacts", "reminders-v3-browser", new Date().toISOString().replace(/[:.]/g, "-")),
    timeoutMs: 30_000,
    theme: "light",
    reminderDeliveryMode: process.env.PUCKY_REMINDER_DELIVERY_MODE || "auto",
    expectedSha: String(process.env.PUCKY_EXPECTED_SHA || "").trim()
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
    } else if (arg === "--expected-sha" && argv[index + 1]) {
      config.expectedSha = String(argv[++index] || config.expectedSha).trim();
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

async function fetchManifest(config) {
  const url = new URL("/ui/pucky/latest/manifest.json", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  assert(response.ok, `Could not load manifest from ${url.toString()} (${response.status})`);
  return {
    manifestUrl: url.toString(),
    manifest: payload
  };
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
  const selector = `.light-app-tile[data-app-label="${label}"]`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await page.waitForFunction((targetSelector) => {
        const button = document.querySelector(targetSelector);
        return button instanceof HTMLButtonElement && !button.disabled;
      }, selector, { timeout: 5_000 });
      await page.evaluate((targetSelector) => {
        const button = document.querySelector(targetSelector);
        if (!(button instanceof HTMLButtonElement)) {
          throw new Error(`Missing tile ${targetSelector}`);
        }
        button.click();
      }, selector);
      await waitForLightRoute(page, route, 5_000);
      return;
    } catch (error) {
      if (Date.now() - startedAt >= timeoutMs) {
        throw error;
      }
      await page.waitForTimeout(250);
    }
  }
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

async function pressTopBack(page) {
  await page.locator(".light-back-button").click();
  await page.waitForTimeout(250);
}

async function pressAndroidBack(page) {
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.waitForTimeout(250);
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
      const bell = row?.querySelector("[data-reminder-bell-state]");
      result[id] = row ? {
        state: row.getAttribute("data-reminder-state") || "",
        bellState: bell?.getAttribute("data-reminder-bell-state") || "",
        bellRole: bell?.getAttribute("data-reminder-bell-role") || "",
        readToggleCount: row.querySelectorAll(".light-feed-read-toggle").length || 0,
        text: String(row.textContent || "").trim()
      } : null;
      return result;
    }, {});
    return { sectionTitles: titles, rows };
  }, { ids: reminderIds });
}

async function readLightHistoryState(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("pucky.cover.nav_state.v1");
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      route: String(parsed?.route || "").trim(),
      light_history: Array.isArray(parsed?.light_history) ? parsed.light_history : []
    };
  });
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
      cssProgress: String(countdown?.style?.getPropertyValue("--progress") || "").trim(),
    };
  }, reminderId);
}

async function readReminderIconStates(page, reminderIds = []) {
  return page.evaluate((targetIds) => {
    return targetIds.reduce((result, targetId) => {
      const row = document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`);
      const bell = row?.querySelector("[data-reminder-bell-state]");
      const icon = bell?.querySelector(".material-icon");
      const style = icon ? window.getComputedStyle(icon) : null;
      const bellStyle = bell ? window.getComputedStyle(bell) : null;
      result[targetId] = {
        exists: Boolean(bell),
        rowState: row?.getAttribute("data-reminder-state") || "",
        bellState: bell?.getAttribute("data-reminder-bell-state") || "",
        bellRole: bell?.getAttribute("data-reminder-bell-role") || "",
        readToggleCount: row?.querySelectorAll(".light-feed-read-toggle").length || 0,
        className: bell?.className || "",
        fill: style?.fill || "",
        stroke: style?.stroke || "",
        color: bellStyle?.color || "",
        transform: style?.transform || "none",
        animationName: style?.animationName || "none",
        animationPlayState: style?.animationPlayState || "",
      };
      return result;
    }, {});
  }, reminderIds);
}

async function sampleReminderIconTimeline(page, reportDir, reminderIds, options = {}) {
  const durationMs = Math.max(250, Number(options.durationMs || LIST_ICON_SAMPLE_DURATION_MS));
  const stepMs = Math.max(100, Number(options.stepMs || LIST_ICON_SAMPLE_INTERVAL_MS));
  const screenshotAtMs = Array.isArray(options.screenshotAtMs) ? options.screenshotAtMs.slice().sort((left, right) => left - right) : [];
  const screenshotNamePrefix = String(options.screenshotNamePrefix || "icon-timeline").trim();
  const sampleLabel = String(options.sampleLabel || "icon").trim();
  const samples = [];
  const screenshots = [];
  const startedAt = Date.now();
  let screenshotIndex = 0;
  while (true) {
    const elapsedMs = Date.now() - startedAt;
    while (screenshotIndex < screenshotAtMs.length && elapsedMs >= screenshotAtMs[screenshotIndex]) {
      const name = `${screenshotNamePrefix}-t${Math.round(screenshotAtMs[screenshotIndex] / 1000)}s`;
      screenshots.push({
        label: `${sampleLabel}_t${Math.round(screenshotAtMs[screenshotIndex] / 1000)}s`,
        elapsedMs,
        path: await saveScreenshot(page, reportDir, name)
      });
      screenshotIndex += 1;
    }
    samples.push({
      elapsedMs,
      icons: await readReminderIconStates(page, reminderIds)
    });
    if (elapsedMs >= durationMs) {
      break;
    }
    await page.waitForTimeout(Math.min(stepMs, durationMs - elapsedMs));
  }
  while (screenshotIndex < screenshotAtMs.length) {
    const targetMs = screenshotAtMs[screenshotIndex];
    const name = `${screenshotNamePrefix}-t${Math.round(targetMs / 1000)}s`;
    screenshots.push({
      label: `${sampleLabel}_t${Math.round(targetMs / 1000)}s`,
      elapsedMs: Date.now() - startedAt,
      path: await saveScreenshot(page, reportDir, name)
    });
    screenshotIndex += 1;
  }
  return { samples, screenshots };
}

async function sampleReminderCountdownTimeline(page, reportDir, reminderId, options = {}) {
  const durationMs = Math.max(1_000, Number(options.durationMs || COUNTDOWN_SAMPLE_DURATION_MS));
  const stepMs = Math.max(250, Number(options.stepMs || COUNTDOWN_SAMPLE_INTERVAL_MS));
  const screenshotAtMs = Array.isArray(options.screenshotAtMs) ? options.screenshotAtMs.slice().sort((left, right) => left - right) : [];
  const screenshotNamePrefix = String(options.screenshotNamePrefix || "countdown-timeline").trim();
  const sampleLabel = String(options.sampleLabel || "countdown").trim();
  const samples = [];
  const screenshots = [];
  const startedAt = Date.now();
  let screenshotIndex = 0;
  while (true) {
    const elapsedMs = Date.now() - startedAt;
    while (screenshotIndex < screenshotAtMs.length && elapsedMs >= screenshotAtMs[screenshotIndex]) {
      const name = `${screenshotNamePrefix}-t${Math.round(screenshotAtMs[screenshotIndex] / 1000)}s`;
      screenshots.push({
        label: `${sampleLabel}_t${Math.round(screenshotAtMs[screenshotIndex] / 1000)}s`,
        elapsedMs,
        path: await saveScreenshot(page, reportDir, name)
      });
      screenshotIndex += 1;
    }
    const previous = samples.length ? samples[samples.length - 1].countdown : null;
    let countdown = await readReminderCountdownState(page, reminderId);
    if (previous?.exists && countdown?.exists) {
      let retryCount = 0;
      while (retryCount < 4 && Number(countdown.progress || 0) <= Number(previous.progress || 0)) {
        await page.waitForTimeout(150);
        countdown = await readReminderCountdownState(page, reminderId);
        retryCount += 1;
      }
    }
    samples.push({
      elapsedMs: Date.now() - startedAt,
      countdown
    });
    if (elapsedMs >= durationMs) {
      break;
    }
    await page.waitForTimeout(Math.min(stepMs, durationMs - elapsedMs));
  }
  while (screenshotIndex < screenshotAtMs.length) {
    const targetMs = screenshotAtMs[screenshotIndex];
    const name = `${screenshotNamePrefix}-t${Math.round(targetMs / 1000)}s`;
    screenshots.push({
      label: `${sampleLabel}_t${Math.round(targetMs / 1000)}s`,
      elapsedMs: Date.now() - startedAt,
      path: await saveScreenshot(page, reportDir, name)
    });
    screenshotIndex += 1;
  }
  return { samples, screenshots };
}

function identityTransform(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized
    || normalized === "none"
    || normalized === "matrix(1, 0, 0, 1, 0, 0)"
    || normalized === "matrix(1,0,0,1,0,0)";
}

function countdownProgressValues(samples) {
  return samples.map(sample => Number(sample?.countdown?.progress || 0));
}

function countdownRemainingValues(samples) {
  return samples.map(sample => Number(sample?.countdown?.remainingMs || 0));
}

function valuesStrictlyIncrease(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (!(values[index] > values[index - 1])) {
      return false;
    }
  }
  return true;
}

function valuesStrictlyDecrease(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (!(values[index] < values[index - 1])) {
      return false;
    }
  }
  return true;
}

function writeReminderProofSummary(reportDir, summary) {
  const iconTimeline = summary.motion?.list_icon_stability || {};
  const countdownTimeline = summary.motion?.snooze_countdown || {};
  const manifest = summary.remote_manifest?.manifest || {};
  const lines = [
    "# Reminder Hosted Proof",
    "",
    `- Base URL: ${summary.base_url}`,
    `- Theme: ${summary.theme}`,
    `- Manifest URL: ${summary.remote_manifest?.manifestUrl || ""}`,
    `- Manifest commit: ${manifest.source_commit_full || ""}`,
    `- Manifest ui_version: ${manifest.ui_version || ""}`,
    "",
    "## List Icon Stability",
    "",
    `- Verdict: ${iconTimeline.verdict || "unknown"}`,
    `- Live icon stayed still: ${String(Boolean(iconTimeline.live_stayed_still))}`,
    `- Comparison row stayed still: ${String(Boolean(iconTimeline.comparison_stayed_still))}`,
    "",
    "| Sample | Elapsed ms | Transform | Animation | State |",
    "| --- | ---: | --- | --- | --- |",
    ...(Array.isArray(iconTimeline.samples) ? iconTimeline.samples : []).map((sample, index) => {
      const live = sample?.icons?.live || {};
      return `| ${index + 1} | ${Number(sample?.elapsedMs || 0)} | ${String(live.transform || "")} | ${String(live.animationName || "")} | ${String(live.rowState || "")} |`;
    }),
    "",
    "## Snooze Countdown",
    "",
    `- Verdict: ${countdownTimeline.verdict || "unknown"}`,
    `- Distinct progress values: ${Number(countdownTimeline.distinct_progress_values || 0)}`,
    "",
    "| Sample | Elapsed ms | Progress | Remaining ms | Label | State |",
    "| --- | ---: | ---: | ---: | --- | --- |",
    ...(Array.isArray(countdownTimeline.samples) ? countdownTimeline.samples : []).map((sample, index) => {
      const countdown = sample?.countdown || {};
      return `| ${index + 1} | ${Number(sample?.elapsedMs || 0)} | ${Number(countdown.progress || 0).toFixed(3)} | ${Number(countdown.remainingMs || 0)} | ${String(countdown.label || "")} | ${String(countdown.rowState || "")} |`;
    }),
    "",
    "## Screenshots",
    "",
    ...(Object.entries(summary.screenshots || {})).map(([key, target]) => `- ${key}: ${target}`),
    "",
  ];
  fs.writeFileSync(path.join(reportDir, "summary.md"), lines.join("\n"), "utf8");
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

async function runReminderDismissHistoryLane(page, config, summary, options) {
  const reminderIds = Array.isArray(options?.reminderIds) ? options.reminderIds : [];
  const routeBack = typeof options?.back === "function" ? options.back : pressTopBack;
  const screenshotPrefix = String(options?.screenshotPrefix || "history").trim();
  const stepPrefix = String(options?.stepPrefix || "a").trim().toLowerCase() || "a";
  const summaryKey = String(options?.summaryKey || screenshotPrefix).trim();
  const dismissedIds = reminderIds.slice(0, 2);
  const thirdReminderId = String(reminderIds[2] || "").trim();
  assert(reminderIds.length === 3 && dismissedIds.every(Boolean) && thirdReminderId, `Expected three reminder ids for ${summaryKey}`);

  await page.goto(pageUrl(config.baseUrl, config.theme, config.apiToken), { waitUntil: "commit", timeout: config.timeoutMs });
  await waitForHome(page, config.theme, config.timeoutMs);
  await openTile(page, "Reminders", "reminders", config.timeoutMs);
  for (const reminderId of reminderIds) {
    await page.locator(`.light-reminder-row[data-reminder-id="${reminderId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  }
  summary.screenshots[`${screenshotPrefix}_${stepPrefix}0_list`] = await saveScreenshot(page, config.reportDir, `${screenshotPrefix}-${stepPrefix}0-list`);

  const dismissScreens = [
    { reminderId: reminderIds[0], beforeKey: `${screenshotPrefix}_${stepPrefix}1_detail_before_first_dismiss`, afterKey: `${screenshotPrefix}_${stepPrefix}2_list_after_first_dismiss`, beforeName: `${screenshotPrefix}-${stepPrefix}1-detail-before-first-dismiss`, afterName: `${screenshotPrefix}-${stepPrefix}2-list-after-first-dismiss` },
    { reminderId: reminderIds[1], beforeKey: `${screenshotPrefix}_${stepPrefix}3_detail_before_second_dismiss`, afterKey: `${screenshotPrefix}_${stepPrefix}4_list_after_second_dismiss`, beforeName: `${screenshotPrefix}-${stepPrefix}3-detail-before-second-dismiss`, afterName: `${screenshotPrefix}-${stepPrefix}4-list-after-second-dismiss` },
  ];
  for (const lane of dismissScreens) {
    await page.locator(`.light-reminder-row[data-reminder-id="${lane.reminderId}"]`).click();
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    await assertCompactReminderDetail(page, "live", ["Dismiss", "Snooze"], { expectedConnectedLabels: [] });
    summary.screenshots[lane.beforeKey] = await saveScreenshot(page, config.reportDir, lane.beforeName);
    await page.locator('[data-reminder-action="dismiss"]').click();
    await waitForReminderRecord(
      config,
      lane.reminderId,
      reminder => reminderIsDismissed(reminder),
      `${lane.reminderId} should dismiss during ${summaryKey}`,
      config.timeoutMs
    );
    await assertNoToast(page, `${lane.reminderId} dismiss`);
    await waitForLightRoute(page, "reminders", config.timeoutMs);
    await page.waitForFunction((targetId) => !document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`), lane.reminderId, { timeout: config.timeoutMs });
    summary.screenshots[lane.afterKey] = await saveScreenshot(page, config.reportDir, lane.afterName);
  }

  await page.locator(`.light-reminder-row[data-reminder-id="${thirdReminderId}"]`).click();
  await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
  await assertCompactReminderDetail(page, "live", ["Dismiss", "Snooze"], { expectedConnectedLabels: [] });
  summary.screenshots[`${screenshotPrefix}_${stepPrefix}5_detail_before_back`] = await saveScreenshot(page, config.reportDir, `${screenshotPrefix}-${stepPrefix}5-detail-before-back`);

  await routeBack(page);
  await waitForLightRoute(page, "reminders", config.timeoutMs);
  await page.locator(`.light-reminder-row[data-reminder-id="${thirdReminderId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
  const returnedToList = await page.evaluate(() => {
    return document.querySelector(".light-shell")?.getAttribute("data-light-route") === "reminders"
      && !document.querySelector('[data-reminder-detail-card="true"]');
  });
  assert(returnedToList, "Back once should return to reminders, not a dismissed reminder detail");
  summary.screenshots[`${screenshotPrefix}_${stepPrefix}6_list_after_back_once`] = await saveScreenshot(page, config.reportDir, `${screenshotPrefix}-${stepPrefix}6-list-after-back-once`);

  await routeBack(page);
  await waitForLightRoute(page, "home", config.timeoutMs);
  const returnedHome = await page.evaluate(() => {
    return document.querySelector(".light-shell")?.getAttribute("data-light-route") === "home"
      && !document.querySelector('[data-reminder-detail-card="true"]');
  });
  assert(returnedHome, "Back twice should return to home, not a dismissed reminder detail");
  summary.screenshots[`${screenshotPrefix}_${stepPrefix}7_home`] = await saveScreenshot(page, config.reportDir, `${screenshotPrefix}-${stepPrefix}7-home`);

  const historyState = await readLightHistoryState(page);
  const historySnapshots = Array.isArray(historyState.light_history) ? historyState.light_history : [];
  assert(
    !historySnapshots.some(snapshot => snapshot?.route === "reminder-detail" && dismissedIds.includes(String(snapshot?.selectedReminderId || "").trim())),
    "Expected light_history to scrub dismissed reminder-detail snapshots"
  );
  assert(
    !historySnapshots.some(snapshot => snapshot?.route === "reminders" && dismissedIds.includes(String(snapshot?.selectedReminderId || "").trim())),
    "Expected light_history to scrub reminders snapshots that still point at dismissed reminder ids"
  );

  const thirdRecord = await apiRequest(config, "GET", `/api/workspace/reminders/${thirdReminderId}`);
  assert(String(thirdRecord?.status || "").trim().toLowerCase() === "open", `${thirdReminderId} should remain open after the back-stack lane`);
  summary.lifecycle[summaryKey] = {
    dismissed_ids: dismissedIds,
    survivor_id: thirdReminderId,
    history_state: historyState,
    survivor_status: String(thirdRecord?.status || "").trim().toLowerCase()
  };
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

  const runId = Date.now();
  const reminderAId = `browser-proof-snooze-${runId}`;
  const reminderBId = `browser-proof-dismiss-${runId}`;
  const comparisonReminderId = `browser-proof-upcoming-${runId}`;
  const orphanContactId = `browser-proof-orphan-contact-${runId}`;
  const orphanDismissReminderId = `browser-proof-orphan-dismiss-${runId}`;
  const orphanSnoozeReminderId = `browser-proof-orphan-snooze-${runId}`;
  const historyReminderOneId = `browser-proof-history-one-${runId}`;
  const historyReminderTwoId = `browser-proof-history-two-${runId}`;
  const historyReminderThreeId = `browser-proof-history-three-${runId}`;
  const androidHistoryReminderOneId = `browser-proof-history-android-one-${runId}`;
  const androidHistoryReminderTwoId = `browser-proof-history-android-two-${runId}`;
  const androidHistoryReminderThreeId = `browser-proof-history-android-three-${runId}`;
  const createdReminderIds = [
    reminderAId,
    reminderBId,
    comparisonReminderId,
    orphanDismissReminderId,
    orphanSnoozeReminderId,
    historyReminderOneId,
    historyReminderTwoId,
    historyReminderThreeId,
    androidHistoryReminderOneId,
    androidHistoryReminderTwoId,
    androidHistoryReminderThreeId,
  ];
  const baselineActive = await activeReminderCount(config);
  const reminderADueAtMs = Date.now() + LIVE_TO_SNOOZE_DELAY_MS;
  const reminderBDueAtMs = Date.now() - 60_000;
  const comparisonDueAtMs = Date.now() + UPCOMING_COMPARISON_DELAY_MS;

  summary.motion = {};
  summary.remote_manifest = await fetchManifest(config);
  summary.manifest_url = String(summary.remote_manifest?.manifestUrl || "");
  summary.source_commit_full = String(summary.remote_manifest?.manifest?.source_commit_full || "");
  summary.ui_version = String(summary.remote_manifest?.manifest?.ui_version || "");
  writeJsonFile(path.join(config.reportDir, "manifest.json"), summary.remote_manifest?.manifest || {});
  if (config.expectedSha) {
    assert(
      String(summary.remote_manifest?.manifest?.source_commit_full || "") === config.expectedSha,
      `Hosted manifest commit ${String(summary.remote_manifest?.manifest?.source_commit_full || "<empty>")} did not match expected ${config.expectedSha}`
    );
  }

  for (const payload of [
    {
      id: comparisonReminderId,
      title: "Browser Proof Upcoming Reminder",
      summary: "Upcoming reminder detail should stay action-free and bell animation should stay still.",
      status: "open",
      due_at_ms: comparisonDueAtMs,
      metadata: {
        recipients: [{ id: "self", kind: "self", label: "Me" }],
        destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }],
      }
    },
    {
      id: reminderAId,
      title: "Browser Proof Snooze Reminder",
      summary: "This reminder should move from Upcoming to Live, then snooze with a smooth countdown.",
      status: "open",
      due_at_ms: reminderADueAtMs,
      metadata: {
        recipients: [{ id: "self", kind: "self", label: "Me" }],
        destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }],
      }
    },
    {
      id: reminderBId,
      title: "Browser Proof Dismiss Reminder",
      summary: "This live reminder should stay still, dismiss cleanly, and decrement the active badge.",
      status: "open",
      due_at_ms: reminderBDueAtMs,
      metadata: {
        recipients: [{ id: "self", kind: "self", label: "Me" }],
        destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }],
      }
    }
  ]) {
    await apiRequest(config, "POST", "/api/workspace/reminders", payload);
  }
  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: config.reportDir, size: VIEWPORT } });
  const page = await context.newPage();

  try {
    const expectedInitialActive = baselineActive + 3;
    await page.goto(pageUrl(config.baseUrl, config.theme, config.apiToken), { waitUntil: "commit", timeout: config.timeoutMs });
    await waitForHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, expectedInitialActive, config.timeoutMs);
    summary.screenshots.home = await saveScreenshot(page, config.reportDir, "home");

    await openTile(page, "Reminders", "reminders", config.timeoutMs);
    await page.locator(`.light-reminder-row[data-reminder-id="${comparisonReminderId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.locator(`.light-reminder-row[data-reminder-id="${reminderAId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.locator(`.light-reminder-row[data-reminder-id="${reminderBId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    const initialList = await readReminderListState(page, [comparisonReminderId, reminderAId, reminderBId]);
    assert(initialList.sectionTitles.includes("LIVE"), `Expected Live section, saw ${JSON.stringify(initialList.sectionTitles)}`);
    assert(initialList.sectionTitles.includes("UPCOMING"), `Expected Upcoming section, saw ${JSON.stringify(initialList.sectionTitles)}`);
    assert(!initialList.sectionTitles.includes("SNOOZED"), `Expected Snoozed section to stay removed, saw ${JSON.stringify(initialList.sectionTitles)}`);
    assert(initialList.rows[comparisonReminderId]?.state === "upcoming", `Expected comparison reminder to start upcoming, saw ${initialList.rows[comparisonReminderId]?.state}`);
    assert(initialList.rows[reminderAId]?.state === "upcoming", `Expected reminder A to start upcoming, saw ${initialList.rows[reminderAId]?.state}`);
    assert(initialList.rows[reminderBId]?.state === "live", `Expected reminder B to start live, saw ${initialList.rows[reminderBId]?.state}`);
    assert(initialList.rows[comparisonReminderId]?.readToggleCount === 0 && initialList.rows[reminderAId]?.readToggleCount === 0 && initialList.rows[reminderBId]?.readToggleCount === 0, "Expected no reminder read-toggle control on reminder rows");
    assert(initialList.rows[comparisonReminderId]?.bellState === "upcoming" && !initialList.rows[comparisonReminderId]?.bellRole, "Expected upcoming reminder row bell to stay passive");
    assert(initialList.rows[reminderBId]?.bellState === "live" && initialList.rows[reminderBId]?.bellRole === "dismiss", "Expected live reminder row bell to dismiss from the list");
    summary.screenshots.reminders_list_initial = await saveScreenshot(page, config.reportDir, "reminders-list-initial");

    await page.locator(`.light-reminder-row[data-reminder-id="${comparisonReminderId}"]`).click();
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    await page.waitForFunction(() => Boolean(document.querySelector('[data-reminder-detail-card="true"]')), { timeout: config.timeoutMs });
    const comparisonUpcomingDetail = await assertCompactReminderDetail(page, "upcoming", [], { expectedConnectedLabels: [] });
    await assertNoToast(page, "Upcoming reminder detail");
    summary.lifecycle.comparison_upcoming_detail = comparisonUpcomingDetail;
    summary.screenshots.upcoming_detail = await saveScreenshot(page, config.reportDir, "upcoming-detail");
    await backToRoute(page, "reminders", config.timeoutMs);

    const iconTimeline = await sampleReminderIconTimeline(
      page,
      config.reportDir,
      [reminderBId, comparisonReminderId],
      {
        durationMs: LIST_ICON_SAMPLE_DURATION_MS,
        stepMs: LIST_ICON_SAMPLE_INTERVAL_MS,
        screenshotAtMs: LIST_ICON_SCREENSHOT_AT_MS,
        screenshotNamePrefix: "lane-a-list-icon",
        sampleLabel: "lane_a_list_icon"
      }
    );
    const liveIconStatic = iconTimeline.samples.every(sample => {
      const icon = sample?.icons?.[reminderBId] || {};
      return Boolean(icon.exists)
        && identityTransform(icon.transform)
        && String(icon.animationName || "none") === "none";
    });
    const comparisonIconStatic = iconTimeline.samples.every(sample => {
      const icon = sample?.icons?.[comparisonReminderId] || {};
      return Boolean(icon.exists)
        && identityTransform(icon.transform)
        && String(icon.animationName || "none") === "none";
    });
    assert(liveIconStatic, "Expected live reminder list icon to stay visually static with no animation");
    assert(comparisonIconStatic, "Expected upcoming comparison reminder list icon to stay visually static with no animation");
    summary.motion.list_icon_stability = {
      verdict: "pass",
      live_stayed_still: true,
      comparison_stayed_still: true,
      samples: iconTimeline.samples.map(sample => ({
        elapsedMs: sample.elapsedMs,
        icons: {
          live: sample?.icons?.[reminderBId] || {},
          comparison: sample?.icons?.[comparisonReminderId] || {}
        }
      })),
      screenshots: iconTimeline.screenshots
    };
    iconTimeline.screenshots.forEach((shot, index) => {
      summary.screenshots[`list_icon_t${index}`] = shot.path;
    });

    summary.assertions.push("opening the reminder detail without acting should not change reminder list semantics or badge behavior");
    summary.screenshots.dismiss_before = await saveScreenshot(page, config.reportDir, "dismiss-before");
    await page.locator(`.light-reminder-row[data-reminder-id="${reminderBId}"] [data-reminder-bell-role="dismiss"]`).click();
    const dismissedReminder = await waitForReminderRecord(
      config,
      reminderBId,
      reminder => reminderIsDismissed(reminder),
      "reminder B should dismiss from the live list bell",
      30_000
    );
    await assertNoToast(page, "Reminder B list bell dismiss");
    await page.waitForFunction((targetId) => !document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`), reminderBId, { timeout: config.timeoutMs });
    summary.lifecycle.reminder_b_dismiss = {
      status: String(dismissedReminder?.status || "").trim().toLowerCase()
    };
    summary.screenshots.dismiss_after = await saveScreenshot(page, config.reportDir, "dismiss-after");
    await backToHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, baselineActive + 2, config.timeoutMs);
    summary.screenshots.home_after_dismiss = await saveScreenshot(page, config.reportDir, "home-after-dismiss");

    await openTile(page, "Reminders", "reminders", config.timeoutMs);
    const aLiveObservation = await waitForReminderRowStateObserved(page, reminderAId, "live", LIVE_TO_SNOOZE_DELAY_MS + 25_000);
    assert(
      Number(aLiveObservation?.observedAtMs || 0) <= reminderADueAtMs + 20_000,
      `Reminder A should become Live within 20s of due (${reminderADueAtMs}), saw ${aLiveObservation?.observedAtMs || 0}`
    );
    await page.locator(`.light-reminder-row[data-reminder-id="${reminderAId}"]`).click();
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    const aLiveDetail = await assertCompactReminderDetail(page, "live", ["Dismiss", "Snooze"], { expectedConnectedLabels: [] });
    await assertNoToast(page, "Live snooze reminder detail");
    summary.lifecycle.reminder_a_live = {
      due_at_ms: reminderADueAtMs,
      observed_at_ms: Number(aLiveObservation?.observedAtMs || 0),
      detail: aLiveDetail
    };
    summary.screenshots.snooze_before = await saveScreenshot(page, config.reportDir, "snooze-before");
    await page.locator('[data-reminder-action="snooze"]').click();
    const aSnoozedRecord = await waitForReminderRecord(
      config,
      reminderAId,
      reminder => reminderIsSnoozed(reminder) && Number(reminder?.due_at_ms || 0) >= Date.now() + 420_000,
      "reminder A should snooze for roughly eight minutes",
      30_000
    );
    assert(
      Number(aSnoozedRecord?.metadata?.snoozed_until_ms || 0) === Number(aSnoozedRecord?.due_at_ms || 0),
      `Reminder A snooze should keep due_at_ms and snoozed_until_ms aligned, saw ${Number(aSnoozedRecord?.due_at_ms || 0)} vs ${Number(aSnoozedRecord?.metadata?.snoozed_until_ms || 0)}`
    );
    await assertNoToast(page, "Reminder A snooze");
    const aSnoozedDetail = await assertCompactReminderDetail(page, "snoozed", [], { expectedConnectedLabels: [] });
    summary.lifecycle.reminder_a_snoozed_detail = aSnoozedDetail;
    summary.screenshots.snooze_after_detail = await saveScreenshot(page, config.reportDir, "snooze-after-detail");
    await backToRoute(page, "reminders", config.timeoutMs);
    await waitForReminderRowState(page, reminderAId, "snoozed", config.timeoutMs);
    const afterSnoozeList = await readReminderListState(page, [reminderAId]);
    assert(afterSnoozeList.sectionTitles.includes("UPCOMING"), `Expected Upcoming after snooze, saw ${JSON.stringify(afterSnoozeList.sectionTitles)}`);
    assert(!afterSnoozeList.sectionTitles.includes("SNOOZED"), `Expected no Snoozed section after snooze, saw ${JSON.stringify(afterSnoozeList.sectionTitles)}`);
    assert(afterSnoozeList.rows[reminderAId]?.bellState === "upcoming" && !afterSnoozeList.rows[reminderAId]?.bellRole, "Expected upcoming reminder row bell to stay passive");
    assert(afterSnoozeList.rows[reminderAId]?.readToggleCount === 0, "Expected no reminder read-toggle control on reminder rows");
    const countdownTimeline = await sampleReminderCountdownTimeline(
      page,
      config.reportDir,
      reminderAId,
      {
        durationMs: COUNTDOWN_SAMPLE_DURATION_MS,
        stepMs: COUNTDOWN_SAMPLE_INTERVAL_MS,
        screenshotAtMs: COUNTDOWN_SCREENSHOT_AT_MS,
        screenshotNamePrefix: "lane-b-snooze-countdown",
        sampleLabel: "lane_b_snooze_countdown"
      }
    );
    const countdownProgress = countdownProgressValues(countdownTimeline.samples);
    const countdownRemaining = countdownRemainingValues(countdownTimeline.samples);
    const distinctProgressValues = new Set(countdownProgress.map(value => value.toFixed(3))).size;
    assert(countdownTimeline.samples.every(sample => Boolean(sample?.countdown?.exists)), "Expected snoozed countdown to stay visible for the full observation window");
    assert(countdownTimeline.samples.every(sample => String(sample?.countdown?.rowState || "") === "snoozed"), "Expected snoozed reminder row state to stay snoozed while observed");
    assert(valuesStrictlyIncrease(countdownProgress), `Expected countdown progress to increase every sample, saw ${countdownProgress.join(", ")}`);
    assert(valuesStrictlyDecrease(countdownRemaining), `Expected countdown remainingMs to decrease every sample, saw ${countdownRemaining.join(", ")}`);
    assert(distinctProgressValues >= 6, `Expected at least six distinct countdown progress values in twelve seconds, saw ${distinctProgressValues}`);
    summary.motion.snooze_countdown = {
      verdict: "pass",
      distinct_progress_values: distinctProgressValues,
      samples: countdownTimeline.samples,
      screenshots: countdownTimeline.screenshots,
      api_record_after_snooze: aSnoozedRecord
    };
    countdownTimeline.screenshots.forEach((shot, index) => {
      summary.screenshots[`snooze_countdown_t${index}`] = shot.path;
    });
    await backToHome(page, config.theme, config.timeoutMs);
    await waitForReminderBadge(page, baselineActive + 2, config.timeoutMs);
    summary.screenshots.home_after_snooze = await saveScreenshot(page, config.reportDir, "home-after-snooze");

    await apiRequest(config, "POST", "/api/workspace/contacts", {
      id: orphanContactId,
      title: "Browser Proof Orphan Contact",
      summary: "Temporary contact for orphaned reminder action verification.",
      metadata: {
        phone: "+14155550168",
      }
    });
    for (const [reminderId, title, summaryText] of [
      [
        orphanDismissReminderId,
        "Browser Proof Orphan Dismiss",
        "Dismiss should still work after the linked recipient contact is deleted."
      ],
      [
        orphanSnoozeReminderId,
        "Browser Proof Orphan Snooze",
        "Snooze should still work after the linked recipient contact is deleted."
      ]
    ]) {
      await apiRequest(config, "POST", "/api/workspace/reminders", {
        id: reminderId,
        title,
        summary: summaryText,
        status: "open",
        due_at_ms: Date.now() + 30 * 60 * 1000,
        metadata: {
          recipients: [
            { id: "self", kind: "self", label: "Me" },
            { id: orphanContactId, kind: "contact", contact_id: orphanContactId, label: "Browser Proof Orphan Contact" },
          ],
          destinations: [{ channel: "sms", recipient_ids: [orphanContactId] }],
        }
      });
    }
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

    await waitForReminderBadge(page, baselineActive + 4, config.timeoutMs);
    await openTile(page, "Reminders", "reminders", config.timeoutMs);
    await page.locator(`.light-reminder-row[data-reminder-id="${orphanDismissReminderId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.locator(`.light-reminder-row[data-reminder-id="${orphanSnoozeReminderId}"]`).waitFor({ state: "visible", timeout: config.timeoutMs });
    summary.screenshots.orphan_list_before_actions = await saveScreenshot(page, config.reportDir, "orphan-list-before-actions");

    await page.locator(`.light-reminder-row[data-reminder-id="${orphanDismissReminderId}"]`).click();
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    const orphanDismissDetail = await assertCompactReminderDetail(page, "live", ["Dismiss", "Snooze"], { expectedConnectedLabels: [] });
    summary.lifecycle.orphan_dismiss_before = orphanDismissDetail;
    summary.screenshots.orphan_dismiss_before = await saveScreenshot(page, config.reportDir, "orphan-dismiss-before");
    await page.locator('[data-reminder-action="dismiss"]').click();
    await waitForReminderRecord(
      config,
      orphanDismissReminderId,
      reminder => reminderIsDismissed(reminder),
      "orphan reminder should dismiss even after contact cleanup",
      30_000
    );
    await assertNoToast(page, "Orphan reminder dismiss");
    await waitForLightRoute(page, "reminders", config.timeoutMs);
    await page.waitForFunction((targetId) => !document.querySelector(`.light-reminder-row[data-reminder-id="${targetId}"]`), orphanDismissReminderId, { timeout: config.timeoutMs });
    summary.screenshots.orphan_dismiss_after = await saveScreenshot(page, config.reportDir, "orphan-dismiss-after");

    await page.locator(`.light-reminder-row[data-reminder-id="${orphanSnoozeReminderId}"]`).click();
    await waitForLightRoute(page, "reminder-detail", config.timeoutMs);
    const orphanSnoozeLive = await assertCompactReminderDetail(page, "live", ["Dismiss", "Snooze"], { expectedConnectedLabels: [] });
    summary.lifecycle.orphan_snooze_before = orphanSnoozeLive;
    summary.screenshots.orphan_snooze_before = await saveScreenshot(page, config.reportDir, "orphan-snooze-before");
    await page.locator('[data-reminder-action="snooze"]').click();
    const orphanSnoozedRecord = await waitForReminderRecord(
      config,
      orphanSnoozeReminderId,
      reminder => reminderIsSnoozed(reminder) && Number(reminder?.due_at_ms || 0) >= Date.now() + 420_000,
      "orphan reminder should snooze back into a non-live state",
      30_000
    );
    assert(
      Number(orphanSnoozedRecord?.metadata?.snoozed_until_ms || 0) === Number(orphanSnoozedRecord?.due_at_ms || 0),
      `Expected orphan snooze due_at_ms and snoozed_until_ms to stay aligned, saw ${Number(orphanSnoozedRecord?.due_at_ms || 0)} vs ${Number(orphanSnoozedRecord?.metadata?.snoozed_until_ms || 0)}`
    );
    const orphanSnoozeDetail = await assertCompactReminderDetail(page, "snoozed", [], { expectedConnectedLabels: [] });
    summary.lifecycle.orphan_snooze_after = orphanSnoozeDetail;
    await assertNoToast(page, "Orphan reminder snooze");
    summary.screenshots.orphan_snooze_after_detail = await saveScreenshot(page, config.reportDir, "orphan-snooze-after-detail");
    await backToRoute(page, "reminders", config.timeoutMs);
    await waitForReminderRowState(page, orphanSnoozeReminderId, "snoozed", config.timeoutMs);
    summary.screenshots.orphan_snooze_after_list = await saveScreenshot(page, config.reportDir, "orphan-snooze-after-list");

    for (const [reminderId, title, summaryText, dueOffsetMs] of [
      [
        historyReminderOneId,
        "Browser Proof History One",
        "First live reminder for the top-back stale history lane.",
        -90_000
      ],
      [
        historyReminderTwoId,
        "Browser Proof History Two",
        "Second live reminder for the top-back stale history lane.",
        -80_000
      ],
      [
        historyReminderThreeId,
        "Browser Proof History Three",
        "Third live reminder should survive back navigation to reminders then home.",
        -70_000
      ],
      [
        androidHistoryReminderOneId,
        "Browser Proof Android History One",
        "First live reminder for the Android back stale history lane.",
        -90_000
      ],
      [
        androidHistoryReminderTwoId,
        "Browser Proof Android History Two",
        "Second live reminder for the Android back stale history lane.",
        -80_000
      ],
      [
        androidHistoryReminderThreeId,
        "Browser Proof Android History Three",
        "Third live reminder should survive Android back navigation to reminders then home.",
        -70_000
      ],
    ]) {
      await apiRequest(config, "POST", "/api/workspace/reminders", {
        id: reminderId,
        title,
        summary: summaryText,
        status: "open",
        due_at_ms: Date.now() + dueOffsetMs,
        metadata: {
          recipients: [{ id: "self", kind: "self", label: "Me" }],
          destinations: [{ channel: "phone_notification", recipient_ids: ["self"] }],
        }
      });
    }
    await runReminderDismissHistoryLane(page, config, summary, {
      reminderIds: [historyReminderOneId, historyReminderTwoId, historyReminderThreeId],
      back: pressTopBack,
      screenshotPrefix: "history_top_back",
      stepPrefix: "a",
      summaryKey: "history_top_back"
    });
    await runReminderDismissHistoryLane(page, config, summary, {
      reminderIds: [androidHistoryReminderOneId, androidHistoryReminderTwoId, androidHistoryReminderThreeId],
      back: pressAndroidBack,
      screenshotPrefix: "history_android_back",
      stepPrefix: "b",
      summaryKey: "history_android_back"
    });

    summary.assertions.push("Reminder list icons stay visually static for live and upcoming rows on the hosted list.");
    summary.assertions.push("Dismiss removes a live reminder from the active set, routes back to reminders, and decrements the home badge without showing a toast.");
    summary.assertions.push("Snoozed reminders remain inside Upcoming and their countdown ring advances every second without chunked 15-second plateaus.");
    summary.assertions.push("Orphaned-recipient reminders still allow Dismiss and Snooze after the linked contact record is deleted, without surfacing an error toast.");
    summary.assertions.push("Back once returns to reminders, and Back twice returns to home without resurrecting dismissed reminder details.");

    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    writeReminderProofSummary(config.reportDir, summary);
  } finally {
    try {
      await browser.close();
    } catch {}
    for (const reminderId of createdReminderIds) {
      try {
        await apiRequest(config, "DELETE", `/api/workspace/reminders/${reminderId}`);
      } catch {}
    }
    try {
      await apiRequest(config, "DELETE", `/api/workspace/contacts/${orphanContactId}`);
    } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
