import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile,
} from "../../support/cover_shared.mjs";

const require = createRequire(import.meta.url);
const DEFAULT_BASE_URL = process.env.PUCKY_WORKSPACE_PROOF_BASE_URL || "http://127.0.0.1:8767";
const VIEWPORT = { width: 430, height: 932 };
const BADGE_CENTER_EPSILON = 3;
const BADGE_OPTICAL_INSET_PX = 3;
const INCLUDED_APPS = ["Inbox", "Meetings", "Meeting Notes", "Tasks", "Reminders"];
const EXCLUDED_APPS = ["Connect", "Calendar", "Projects", "Settings", "Contacts", "Notes"];
const MEETING_NOTES_API_PATH = "/api/workspace/meeting-notes";
const TASKS_API_PATH = "/api/workspace/tasks";
const REMINDERS_API_PATH = "/api/workspace/reminders";

function loadPlaywrightCore() {
  const bundledNodeModules = String(process.env.CODEX_NODE_MODULES || "").trim();
  const bundled = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright-core");
  const bundledPlaywright = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright");
  const candidates = [
    () => require("playwright-core"),
    () => require("playwright"),
    () => bundledNodeModules ? require(path.join(bundledNodeModules, "playwright-core")) : null,
    () => bundledNodeModules ? require(path.join(bundledNodeModules, "playwright")) : null,
    () => require(bundledPlaywright),
    () => require(bundled),
  ];
  for (const candidate of candidates) {
    try {
      const resolved = candidate();
      if (resolved) {
        return resolved;
      }
    } catch {
      // Try the next resolution path.
    }
  }
  throw new Error("Could not resolve playwright-core from local tools or bundled runtime");
}

const { chromium } = loadPlaywrightCore();

function resolveApiToken() {
  const proofToken = String(process.env.PUCKY_HOME_BADGES_PROOF_TOKEN || "").trim();
  if (proofToken) {
    return proofToken;
  }
  return String(process.env.PUCKY_API_TOKEN || "").trim();
}

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: resolveApiToken(),
    reportDir: path.resolve("artifacts", "cover-home-app-badges", new Date().toISOString().replace(/[:.]/g, "-")),
    timeoutMs: 30_000,
    theme: "light",
    refreshKey: String(Date.now()),
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
    } else if (arg === "--refresh-key" && argv[index + 1]) {
      config.refreshKey = String(argv[++index] || config.refreshKey).trim() || config.refreshKey;
    }
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pageUrl(config, route = "home") {
  const url = new URL(`${String(config.baseUrl || "").replace(/\/+$/, "")}/ui/pucky/latest/index.html`);
  url.searchParams.set("theme", config.theme);
  url.searchParams.set("route", route);
  url.searchParams.set("reset_nav", "1");
  if (config.refreshKey) {
    url.searchParams.set("_pucky_refresh", config.refreshKey);
  }
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
    const response = await route.fetch({
      method: request.method(),
      headers,
      postData: request.postDataBuffer() || undefined,
    });
    await route.fulfill({ response });
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
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${apiPath} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function readAppBadges(config) {
  return await apiRequest(config, "GET", "/api/app-badges");
}

function badgeDisplayCount(count) {
  const numeric = Math.max(0, Number(count || 0) || 0);
  if (!numeric) {
    return "";
  }
  return numeric > 99 ? "99+" : String(numeric);
}

function apiBadgeCount(payload, route) {
  return Math.max(0, Number(payload?.badges?.[route]?.count || 0) || 0);
}

async function waitForAppBadges(config, predicate, description, timeoutMs) {
  const startedAt = Date.now();
  let lastPayload = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastPayload = await readAppBadges(config);
    if (predicate(lastPayload)) {
      return lastPayload;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for /api/app-badges: ${description}; last payload ${JSON.stringify(lastPayload)}`);
}

async function waitForWorkspaceRecord(config, collection, recordId, predicate, description, timeoutMs) {
  const startedAt = Date.now();
  let lastRecord = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastRecord = await apiRequest(config, "GET", `/api/workspace/${collection}/${encodeURIComponent(recordId)}`);
    if (predicate(lastRecord)) {
      return lastRecord;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${collection}/${recordId}: ${description}; last record ${JSON.stringify(lastRecord)}`);
}

async function waitForMeetingRecord(config, meetingId, predicate, description, timeoutMs) {
  const startedAt = Date.now();
  let lastRecord = null;
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await apiRequest(config, "GET", "/api/meetings?compact=1");
    const meetings = Array.isArray(payload?.meetings) ? payload.meetings : [];
    lastRecord = meetings.find(item => String(item?.meeting_id || "") === meetingId) || null;
    if (predicate(lastRecord)) {
      return lastRecord;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for meeting ${meetingId}: ${description}; last record ${JSON.stringify(lastRecord)}`);
}

async function createMeeting(config, meetingId, label) {
  await apiRequest(config, "POST", "/api/meetings", {
    meeting_id: meetingId,
    started_at: new Date(Date.now() - 8_000).toISOString(),
    stopped_at: new Date(Date.now() - 3_000).toISOString(),
    duration_ms: 5_000,
    device_id: "badge-proof-device",
    device_path: `/tmp/${meetingId}.m4a`,
    mime_type: "audio/mp4",
    audio_base64: Buffer.from(`RIFF-${label}`).toString("base64"),
  });
  return await waitForMeetingRecord(
    config,
    meetingId,
    meeting => Boolean(meeting && String(meeting.card_id || "").trim()),
    "meeting card_id",
    config.timeoutMs,
  );
}

async function archiveMeeting(config, meetingId) {
  try {
    await apiRequest(config, "POST", "/api/meetings/actions", {
      client_action_id: `cover-home-badges-archive-${meetingId}-${Date.now()}`,
      meeting_id: meetingId,
      action: "archive",
    });
  } catch {
    // Cleanup should not hide the real proof result.
  }
}

async function createRecord(config, collection, payload) {
  return await apiRequest(config, "POST", `/api/workspace/${collection}`, payload);
}

async function deleteRecord(config, collection, recordId) {
  try {
    await apiRequest(config, "DELETE", `/api/workspace/${collection}/${encodeURIComponent(recordId)}`);
  } catch {
    // Cleanup is best-effort.
  }
}

async function waitForLightRoute(page, route, timeoutMs) {
  await page.waitForFunction(targetRoute => {
    return document.querySelector(".light-shell")?.getAttribute("data-light-route") === targetRoute;
  }, route, { timeout: timeoutMs });
}

async function openHome(page, config) {
  await page.goto(pageUrl(config, "home"), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForLightRoute(page, "home", config.timeoutMs);
  await page.waitForSelector(".light-app-grid", { timeout: config.timeoutMs });
  await page.waitForLoadState("networkidle", { timeout: config.timeoutMs }).catch(() => {});
}

async function openRouteFromHome(page, config, route) {
  await openHome(page, config);
  await page.evaluate(targetRoute => {
    document.querySelector(`.light-app-tile[data-route="${targetRoute}"]`)?.click();
  }, route);
  await waitForLightRoute(page, route, config.timeoutMs);
}

async function currentLightRoute(page) {
  return await page.evaluate(() => String(document.querySelector(".light-shell")?.getAttribute("data-light-route") || "").trim());
}

async function openRouteFromCurrentHome(page, route, timeoutMs) {
  await page.evaluate(targetRoute => {
    document.querySelector(`.light-app-tile[data-route="${targetRoute}"]`)?.click();
  }, route);
  await waitForLightRoute(page, route, timeoutMs);
}

async function clickTopBack(page, expectedRoute, timeoutMs) {
  await page.evaluate(() => {
    document.querySelector("#feed .light-back-button")?.click();
  });
  await waitForLightRoute(page, expectedRoute, timeoutMs);
}

async function backToHome(page, timeoutMs) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await currentLightRoute(page) === "home") {
      return;
    }
    await page.evaluate(() => {
      document.querySelector("#feed .light-back-button")?.click();
    });
    await page.waitForFunction(() => Boolean(document.querySelector(".light-shell")), null, { timeout: timeoutMs });
  }
  assert(await currentLightRoute(page) === "home", "Expected top Back to return to Home");
}

async function collectHomeBadgeMetrics(page) {
  return await page.evaluate(() => {
    function domRect(node) {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    }

    return Array.from(document.querySelectorAll(".light-app-tile")).map(tile => {
      const icon = tile.querySelector(".light-app-icon");
      const anchor = tile.querySelector(".light-app-icon-badge-anchor");
      const badge = tile.querySelector(".light-app-badge");
      const label = tile.querySelector(".light-app-label");
      return {
        route: String(tile.getAttribute("data-route") || "").trim(),
        label: String(tile.getAttribute("data-app-label") || label?.textContent || "").trim(),
        icon: icon ? domRect(icon) : null,
        anchor: anchor ? domRect(anchor) : null,
        badge: badge ? domRect(badge) : null,
        badgeCount: badge ? String(badge.textContent || "").trim() : "",
      };
    });
  });
}

function badgeCountForRoute(metrics, route) {
  const item = metrics.find(entry => entry.route === route) || null;
  return item ? String(item.badgeCount || "").trim() : "";
}

async function waitForHomeBadgeCount(page, route, expectedCount, timeoutMs) {
  const expectedText = badgeDisplayCount(expectedCount);
  await page.waitForFunction(({ routeValue, expectedTextValue }) => {
    const tile = document.querySelector(`.light-app-tile[data-route="${routeValue}"]`);
    if (!tile) {
      return false;
    }
    const badge = tile.querySelector(".light-app-badge");
    if (!expectedTextValue) {
      return !badge;
    }
    return Boolean(badge) && String(badge.textContent || "").trim() === expectedTextValue;
  }, { routeValue: route, expectedTextValue: expectedText }, { timeout: timeoutMs });
}

async function waitForElementReadState(page, selector, expectedState, timeoutMs) {
  await page.waitForFunction(({ targetSelector, targetState }) => {
    return document.querySelector(targetSelector)?.getAttribute("data-read-state") === targetState;
  }, { targetSelector: selector, targetState: expectedState }, { timeout: timeoutMs });
}

async function waitForMeetingReadState(page, cardId, expectedState, timeoutMs) {
  await page.waitForFunction(({ targetCardId, targetState }) => {
    const node = document.querySelector(`article[data-card-id="${targetCardId}"] .identity`);
    return Boolean(node) && node.classList.contains(`is-${targetState}`);
  }, { targetCardId: cardId, targetState: expectedState }, { timeout: timeoutMs });
}

function assertHomeBadgeGeometry(metrics, apiPayload) {
  const badges = apiPayload?.badges && typeof apiPayload.badges === "object" ? apiPayload.badges : {};
  for (const label of INCLUDED_APPS) {
    const item = metrics.find(entry => entry.label === label);
    assert(item, `Missing home tile for ${label}`);
    const badgeDescriptor = badges[item.route] && typeof badges[item.route] === "object" ? badges[item.route] : null;
    const expectedText = badgeDisplayCount(badgeDescriptor?.count || 0);
    if (!expectedText) {
      assert(!item.badge, `${label} unexpectedly rendered a home badge`);
      continue;
    }
    assert(item.anchor, `${label} is missing .light-app-icon-badge-anchor`);
    assert(item.icon, `${label} icon is missing for badge geometry`);
    assert(item.badge, `${label} badge is missing`);
    assert(item.badgeCount === expectedText, `${label} badge count mismatch; expected ${expectedText}, saw ${item.badgeCount}`);
    const badgeCenterX = item.badge.left + item.badge.width / 2;
    const badgeCenterY = item.badge.top + item.badge.height / 2;
    const expectedCenterX = item.icon.right - BADGE_OPTICAL_INSET_PX;
    const expectedCenterY = item.icon.top + BADGE_OPTICAL_INSET_PX;
    const driftX = Math.abs(badgeCenterX - expectedCenterX);
    const driftY = Math.abs(badgeCenterY - expectedCenterY);
    assert(driftX <= BADGE_CENTER_EPSILON, `${label} badge geometry drifted horizontally by ${driftX.toFixed(2)}px`);
    assert(driftY <= BADGE_CENTER_EPSILON, `${label} badge geometry drifted vertically by ${driftY.toFixed(2)}px`);
  }
  for (const label of EXCLUDED_APPS) {
    const item = metrics.find(entry => entry.label === label);
    assert(item, `Missing excluded home tile ${label}`);
    assert(!item.badge, `${label} should not render a badge node at all`);
  }
}

async function waitForHomeBadges(page, config, apiPayload) {
  const expected = Object.fromEntries(
    Object.entries(apiPayload?.badges && typeof apiPayload.badges === "object" ? apiPayload.badges : {}).map(([route, descriptor]) => [
      route,
      badgeDisplayCount(descriptor?.count || 0),
    ]),
  );
  await page.waitForFunction(expectedCounts => {
    return Object.entries(expectedCounts).every(([route, expectedText]) => {
      const tile = document.querySelector(`.light-app-tile[data-route="${route}"]`);
      if (!tile) {
        return false;
      }
      const badge = tile.querySelector(".light-app-badge");
      if (!expectedText) {
        return !badge;
      }
      return Boolean(badge) && String(badge.textContent || "").trim() === expectedText;
    });
  }, expected, { timeout: config.timeoutMs });
}

async function openInboxMeeting(page, cardId, meetingId, timeoutMs) {
  const locator = page.locator([
    `article[data-card-id="${cardId}"] .card-body`,
    `article[data-card-session-id="${meetingId}"] .card-body`,
    `button[data-card-id="${cardId}"].card-title-trigger`,
    `button[data-card-session-id="${meetingId}"].card-title-trigger`,
  ].join(", ")).first();
  await locator.click({ timeout: timeoutMs });
  await page.waitForFunction(targetMeetingId => {
    return document.getElementById("detail")?.getAttribute("data-detail-session-id") === targetMeetingId;
  }, meetingId, { timeout: timeoutMs });
}

async function openMeetingFromMeetings(page, meetingId, timeoutMs) {
  await page.locator(`[data-card-session-id="${meetingId}"] .card-body`).click({ timeout: timeoutMs });
  await page.waitForFunction(targetMeetingId => {
    return document.getElementById("detail")?.getAttribute("data-detail-session-id") === targetMeetingId;
  }, meetingId, { timeout: timeoutMs });
}

async function openMeetingNoteDetail(page, recordId, timeoutMs) {
  await page.locator(`.light-graph-row[data-record-id="${recordId}"] .light-text-stack`).click({ timeout: timeoutMs });
  await waitForLightRoute(page, "meeting-note-detail", timeoutMs);
  await page.waitForSelector(".light-meeting-note-detail-page", { timeout: timeoutMs });
}

async function openTaskDetail(page, recordId, timeoutMs) {
  await page.locator(`.light-task-row[data-task-id="${recordId}"] .light-task-row-main`).click({ timeout: timeoutMs });
  await waitForLightRoute(page, "task-detail", timeoutMs);
  await page.waitForSelector(".light-task-detail-page, .light-task-workspace-page", { timeout: timeoutMs });
}

async function openReminderDetail(page, recordId, timeoutMs) {
  await page.locator(`.light-reminder-row[data-reminder-id="${recordId}"] .light-reminder-row-main`).click({ timeout: timeoutMs });
  await waitForLightRoute(page, "reminder-detail", timeoutMs);
  await page.waitForSelector(".light-reminder-detail-card", { timeout: timeoutMs });
}

async function waitForReminderDismiss(page, config, reminderId, baselineCount) {
  await page.getByRole("button", { name: "Dismiss" }).click({ timeout: config.timeoutMs });
  await waitForLightRoute(page, "reminders", config.timeoutMs);
  await waitForAppBadges(
    config,
    payload => Number(payload?.badges?.reminders?.count || 0) === baselineCount,
    "reminder badge decrement after dismiss",
    config.timeoutMs,
  );
  await waitForWorkspaceRecord(
    config,
    "reminders",
    reminderId,
    record => String(record?.status || "").trim().toLowerCase() === "done",
    "reminder status done",
    config.timeoutMs,
  );
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const browser = await chromium.launch({
    executablePath: resolveChromePath(),
    headless: true,
  });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  attachPageLogging(page, path.join(config.reportDir, "console.log"));
  await installAuthorizedApiProxy(context, config.baseUrl, config.apiToken);

  const runSeed = String(Date.now());
  const runId = `cover-home-badges-${runSeed}`;
  const meetingOneId = `meeting-${runSeed}-badge-proof-a`;
  const meetingTwoId = `meeting-${runSeed}-badge-proof-b`;
  const meetingNoteId = `${runId}-meeting-note`;
  const taskId = `${runId}-task`;
  const reminderId = `${runId}-reminder`;
  const summary = {
    schema: "pucky.home_app_badges_browser_proof.v1",
    ok: true,
    baseUrl: config.baseUrl,
    theme: config.theme,
    viewport: VIEWPORT,
    routesUnderTest: INCLUDED_APPS,
    excludedApps: EXCLUDED_APPS,
    notes: [
      "This proof checks badge geometry on the icon anchor and unread semantics for Inbox, Meetings, Meeting Notes, Tasks, and Reminders.",
      "Meetings, Meeting Notes, Tasks, and Reminders each exercise manual toggle to read, manual toggle back to unread, and detail-open auto-read.",
      "Reminder exception check: read/open the reminder detail without acting, then confirm the reminder badge does not change.",
      "Meeting Notes and Tasks verify metadata.seen_at_ms persistence against content_updated_at_ms on the real workspace records.",
    ],
    screenshots: {},
    apiSnapshots: {},
    records: {},
  };

  try {
    const baselineBadges = await readAppBadges(config);
    summary.apiSnapshots.baseline = baselineBadges;

    const meetingOne = await createMeeting(config, meetingOneId, "badge-proof-a");
    const meetingTwo = await createMeeting(config, meetingTwoId, "badge-proof-b");
    const meetingNote = await apiRequest(config, "POST", MEETING_NOTES_API_PATH, {
      id: meetingNoteId,
      title: "Badge proof meeting note",
      summary: "Unread meeting note proof.",
      date: "2026-06-26",
      start_at_ms: 1782462000000,
      end_at_ms: 1782465600000,
    });
    const task = await apiRequest(config, "POST", TASKS_API_PATH, {
      id: taskId,
      title: "Badge proof task",
      summary: "Unread task proof.",
      status: "todo",
      due_at_ms: Date.now() + 30 * 60 * 1000,
    });
    const reminder = await apiRequest(config, "POST", REMINDERS_API_PATH, {
      id: reminderId,
      title: "Badge proof reminder",
      summary: "Live reminder badge proof.",
      status: "open",
      due_at_ms: Date.now() - 5_000,
    });
    summary.records.seed = {
      meetings: [meetingOne, meetingTwo],
      meetingNote,
      task,
      reminder,
    };

    const createdBadges = await waitForAppBadges(
      config,
      payload => {
        const badges = payload?.badges || {};
        return Number(badges?.meetings?.count || 0) >= Number(baselineBadges?.badges?.meetings?.count || 0) + 2
          && Number(badges?.["meeting-notes"]?.count || 0) >= Number(baselineBadges?.badges?.["meeting-notes"]?.count || 0) + 1
          && Number(badges?.tasks?.count || 0) >= Number(baselineBadges?.badges?.tasks?.count || 0) + 1
          && Number(badges?.reminders?.count || 0) >= Number(baselineBadges?.badges?.reminders?.count || 0) + 1;
      },
      "seeded app badges",
      config.timeoutMs,
    );
    summary.apiSnapshots.after_seed = createdBadges;

    await openHome(page, config);
    await waitForHomeBadges(page, config, createdBadges);
    summary.screenshots.home_seeded = await saveScreenshot(page, config.reportDir, "home-seeded");
    const seededMetrics = await collectHomeBadgeMetrics(page);
    assertHomeBadgeGeometry(seededMetrics, createdBadges);

    await openRouteFromCurrentHome(page, "inbox", config.timeoutMs);
    await openInboxMeeting(page, String(meetingOne.card_id || ""), meetingOneId, config.timeoutMs);
    summary.screenshots.inbox_meeting_open = await saveScreenshot(page, config.reportDir, "inbox-meeting-open");
    const afterInboxMeeting = await waitForAppBadges(
      config,
      payload =>
        apiBadgeCount(payload, "inbox") === apiBadgeCount(createdBadges, "inbox") - 1
        && apiBadgeCount(payload, "meetings") === apiBadgeCount(createdBadges, "meetings") - 1,
      "cross-surface meeting read after inbox open",
      config.timeoutMs,
    );
    summary.apiSnapshots.after_inbox_meeting = afterInboxMeeting;
    await backToHome(page, config.timeoutMs);
    await waitForHomeBadges(page, config, afterInboxMeeting);

    await openRouteFromCurrentHome(page, "meetings", config.timeoutMs);
    await page.waitForSelector(`article[data-card-id="${meetingTwo.card_id}"] .identity`, { timeout: config.timeoutMs });
    summary.screenshots.meetings_feed_initial = await saveScreenshot(page, config.reportDir, "meetings-feed-initial");
    await waitForMeetingReadState(page, String(meetingTwo.card_id || ""), "unread", config.timeoutMs);
    await page.locator(`article[data-card-id="${meetingTwo.card_id}"] .identity`).click({ timeout: config.timeoutMs });
    await waitForMeetingReadState(page, String(meetingTwo.card_id || ""), "read", config.timeoutMs);
    const afterMeetingToggleRead = await waitForAppBadges(
      config,
      payload =>
        apiBadgeCount(payload, "inbox") === apiBadgeCount(createdBadges, "inbox") - 2
        && apiBadgeCount(payload, "meetings") === apiBadgeCount(createdBadges, "meetings") - 2,
      "meeting toggle read decrements inbox and meetings badges",
      config.timeoutMs,
    );
    summary.apiSnapshots.after_meeting_toggle_read = afterMeetingToggleRead;
    summary.records.meeting_toggle_read = await waitForMeetingRecord(
      config,
      meetingTwoId,
      record => Boolean(record?.read) || Boolean(record?.feed_item?.read),
      "meeting toggle persisted read state",
      config.timeoutMs,
    );
    summary.screenshots.meetings_feed_after_toggle_read = await saveScreenshot(page, config.reportDir, "meetings-feed-after-toggle-read");
    await page.locator(`article[data-card-id="${meetingTwo.card_id}"] .identity`).click({ timeout: config.timeoutMs });
    await waitForMeetingReadState(page, String(meetingTwo.card_id || ""), "unread", config.timeoutMs);
    const afterMeetingToggleUnreadApi = await readAppBadges(config);
    assert(
      apiBadgeCount(afterMeetingToggleUnreadApi, "inbox") === apiBadgeCount(afterMeetingToggleRead, "inbox")
      && apiBadgeCount(afterMeetingToggleUnreadApi, "meetings") === apiBadgeCount(afterMeetingToggleRead, "meetings"),
      "Meeting unread override should stay client-local and leave /api/app-badges unchanged",
    );
    summary.apiSnapshots.after_meeting_toggle_unread_local = afterMeetingToggleUnreadApi;
    summary.screenshots.meetings_feed_after_toggle_unread = await saveScreenshot(page, config.reportDir, "meetings-feed-after-toggle-unread");
    await backToHome(page, config.timeoutMs);
    await waitForHomeBadgeCount(page, "inbox", apiBadgeCount(afterMeetingToggleRead, "inbox") + 1, config.timeoutMs);
    await waitForHomeBadgeCount(page, "meetings", apiBadgeCount(afterMeetingToggleRead, "meetings") + 1, config.timeoutMs);
    summary.screenshots.home_after_meeting_local_unread = await saveScreenshot(page, config.reportDir, "home-after-meeting-local-unread");
    const homeAfterMeetingLocalUnread = await collectHomeBadgeMetrics(page);
    assert(
      badgeCountForRoute(homeAfterMeetingLocalUnread, "inbox") === badgeDisplayCount(apiBadgeCount(afterMeetingToggleRead, "inbox") + 1)
      && badgeCountForRoute(homeAfterMeetingLocalUnread, "meetings") === badgeDisplayCount(apiBadgeCount(afterMeetingToggleRead, "meetings") + 1),
      "Expected Inbox and Meetings home badges to reflect the local unread meeting override",
    );
    await openRouteFromCurrentHome(page, "meetings", config.timeoutMs);
    await openMeetingFromMeetings(page, meetingTwoId, config.timeoutMs);
    summary.screenshots.meetings_meeting_open_after_local_unread = await saveScreenshot(page, config.reportDir, "meetings-meeting-open-after-local-unread");
    const afterMeetingsMeetingOpen = await readAppBadges(config);
    assert(
      apiBadgeCount(afterMeetingsMeetingOpen, "inbox") === apiBadgeCount(afterMeetingToggleRead, "inbox")
      && apiBadgeCount(afterMeetingsMeetingOpen, "meetings") === apiBadgeCount(afterMeetingToggleRead, "meetings"),
      "Opening a locally unread meeting from Meetings should clear the local override without changing server badge counts",
    );
    summary.apiSnapshots.after_meeting_open_auto_read = afterMeetingsMeetingOpen;
    await backToHome(page, config.timeoutMs);
    await waitForHomeBadgeCount(page, "inbox", apiBadgeCount(afterMeetingToggleRead, "inbox"), config.timeoutMs);
    await waitForHomeBadgeCount(page, "meetings", apiBadgeCount(afterMeetingToggleRead, "meetings"), config.timeoutMs);

    await openRouteFromCurrentHome(page, "meeting-notes", config.timeoutMs);
    const meetingNoteRowSelector = `.light-graph-row[data-record-id="${meetingNoteId}"]`;
    const meetingNoteToggleSelector = `${meetingNoteRowSelector} .light-feed-read-toggle`;
    await page.waitForSelector(meetingNoteToggleSelector, { timeout: config.timeoutMs });
    await waitForElementReadState(page, meetingNoteRowSelector, "unread", config.timeoutMs);
    summary.screenshots.meeting_notes_feed_initial = await saveScreenshot(page, config.reportDir, "meeting-notes-feed-initial");
    await page.locator(meetingNoteToggleSelector).click({ timeout: config.timeoutMs });
    await waitForElementReadState(page, meetingNoteRowSelector, "read", config.timeoutMs);
    const afterMeetingNoteToggleRead = await waitForAppBadges(
      config,
      payload => apiBadgeCount(payload, "meeting-notes") === apiBadgeCount(createdBadges, "meeting-notes") - 1,
      "meeting note toggle read decrements badge",
      config.timeoutMs,
    );
    summary.apiSnapshots.after_meeting_note_toggle_read = afterMeetingNoteToggleRead;
    summary.records.meeting_note_toggle_read = await waitForWorkspaceRecord(
      config,
      "meeting-notes",
      meetingNoteId,
      record => Number(record?.metadata?.seen_at_ms || 0) >= Number(record?.content_updated_at_ms || 0),
      "meeting note seen_at_ms after toggle read",
      config.timeoutMs,
    );
    await page.locator(meetingNoteToggleSelector).click({ timeout: config.timeoutMs });
    await waitForElementReadState(page, meetingNoteRowSelector, "unread", config.timeoutMs);
    const afterMeetingNoteToggleUnreadApi = await readAppBadges(config);
    assert(
      apiBadgeCount(afterMeetingNoteToggleUnreadApi, "meeting-notes") === apiBadgeCount(afterMeetingNoteToggleRead, "meeting-notes"),
      "Meeting note unread override should stay client-local and leave /api/app-badges unchanged",
    );
    summary.apiSnapshots.after_meeting_note_toggle_unread_local = afterMeetingNoteToggleUnreadApi;
    summary.screenshots.meeting_notes_feed_after_toggle_unread = await saveScreenshot(page, config.reportDir, "meeting-notes-feed-after-toggle-unread");
    await backToHome(page, config.timeoutMs);
    await waitForHomeBadgeCount(page, "meeting-notes", apiBadgeCount(afterMeetingNoteToggleRead, "meeting-notes") + 1, config.timeoutMs);
    summary.screenshots.home_after_meeting_note_local_unread = await saveScreenshot(page, config.reportDir, "home-after-meeting-note-local-unread");
    const homeAfterMeetingNoteLocalUnread = await collectHomeBadgeMetrics(page);
    assert(
      badgeCountForRoute(homeAfterMeetingNoteLocalUnread, "meeting-notes") === badgeDisplayCount(apiBadgeCount(afterMeetingNoteToggleRead, "meeting-notes") + 1),
      "Expected Meeting Notes home badge to reflect the local unread override",
    );
    await openRouteFromCurrentHome(page, "meeting-notes", config.timeoutMs);
    await openMeetingNoteDetail(page, meetingNoteId, config.timeoutMs);
    summary.screenshots.meeting_note_detail_after_local_unread = await saveScreenshot(page, config.reportDir, "meeting-note-detail-after-local-unread");
    const afterMeetingNoteOpen = await readAppBadges(config);
    assert(
      apiBadgeCount(afterMeetingNoteOpen, "meeting-notes") === apiBadgeCount(afterMeetingNoteToggleRead, "meeting-notes"),
      "Opening a locally unread meeting note should clear the local override without changing server badge counts",
    );
    summary.apiSnapshots.after_meeting_note_open_auto_read = afterMeetingNoteOpen;
    await backToHome(page, config.timeoutMs);
    await waitForHomeBadgeCount(page, "meeting-notes", apiBadgeCount(afterMeetingNoteToggleRead, "meeting-notes"), config.timeoutMs);

    await openRouteFromCurrentHome(page, "tasks", config.timeoutMs);
    const taskRowSelector = `.light-task-row[data-task-id="${taskId}"]`;
    const taskReadToggleSelector = `${taskRowSelector} .light-task-row-read-toggle`;
    const taskStatusControlSelector = `${taskRowSelector} .light-task-row-status-trigger`;
    await page.waitForSelector(taskReadToggleSelector, { timeout: config.timeoutMs });
    await page.waitForSelector(taskStatusControlSelector, { timeout: config.timeoutMs });
    const taskControls = await page.evaluate(targetTaskId => {
      const row = document.querySelector(`.light-task-row[data-task-id="${targetTaskId}"]`);
      return {
        statusControls: row?.querySelectorAll(".light-task-row-status-trigger").length || 0,
        readControls: row?.querySelectorAll(".light-task-row-read-toggle").length || 0,
      };
    }, taskId);
    assert(taskControls.statusControls === 1 && taskControls.readControls === 1, "Expected task row to keep its status control and add a separate unread control");
    await waitForElementReadState(page, taskRowSelector, "unread", config.timeoutMs);
    summary.screenshots.tasks_feed_initial = await saveScreenshot(page, config.reportDir, "tasks-feed-initial");
    await page.locator(taskReadToggleSelector).click({ timeout: config.timeoutMs });
    await waitForElementReadState(page, taskRowSelector, "read", config.timeoutMs);
    const afterTaskToggleRead = await waitForAppBadges(
      config,
      payload => apiBadgeCount(payload, "tasks") === apiBadgeCount(createdBadges, "tasks") - 1,
      "task toggle read decrements badge",
      config.timeoutMs,
    );
    summary.apiSnapshots.after_task_toggle_read = afterTaskToggleRead;
    summary.records.task_toggle_read = await waitForWorkspaceRecord(
      config,
      "tasks",
      taskId,
      record => Number(record?.metadata?.seen_at_ms || 0) >= Number(record?.content_updated_at_ms || 0),
      "task seen_at_ms after toggle read",
      config.timeoutMs,
    );
    await page.locator(taskReadToggleSelector).click({ timeout: config.timeoutMs });
    await waitForElementReadState(page, taskRowSelector, "unread", config.timeoutMs);
    const afterTaskToggleUnreadApi = await readAppBadges(config);
    assert(
      apiBadgeCount(afterTaskToggleUnreadApi, "tasks") === apiBadgeCount(afterTaskToggleRead, "tasks"),
      "Task unread override should stay client-local and leave /api/app-badges unchanged",
    );
    summary.apiSnapshots.after_task_toggle_unread_local = afterTaskToggleUnreadApi;
    summary.screenshots.tasks_feed_after_toggle_unread = await saveScreenshot(page, config.reportDir, "tasks-feed-after-toggle-unread");
    await backToHome(page, config.timeoutMs);
    await waitForHomeBadgeCount(page, "tasks", apiBadgeCount(afterTaskToggleRead, "tasks") + 1, config.timeoutMs);
    summary.screenshots.home_after_task_local_unread = await saveScreenshot(page, config.reportDir, "home-after-task-local-unread");
    const homeAfterTaskLocalUnread = await collectHomeBadgeMetrics(page);
    assert(
      badgeCountForRoute(homeAfterTaskLocalUnread, "tasks") === badgeDisplayCount(apiBadgeCount(afterTaskToggleRead, "tasks") + 1),
      "Expected Tasks home badge to reflect the local unread override",
    );
    await openRouteFromCurrentHome(page, "tasks", config.timeoutMs);
    await openTaskDetail(page, taskId, config.timeoutMs);
    summary.screenshots.task_detail_after_local_unread = await saveScreenshot(page, config.reportDir, "task-detail-after-local-unread");
    const afterTaskOpen = await readAppBadges(config);
    assert(
      apiBadgeCount(afterTaskOpen, "tasks") === apiBadgeCount(afterTaskToggleRead, "tasks"),
      "Opening a locally unread task should clear the local override without changing server badge counts",
    );
    summary.apiSnapshots.after_task_open_auto_read = afterTaskOpen;
    await backToHome(page, config.timeoutMs);
    await waitForHomeBadgeCount(page, "tasks", apiBadgeCount(afterTaskToggleRead, "tasks"), config.timeoutMs);

    const reminderBaseline = await readAppBadges(config);
    await openRouteFromCurrentHome(page, "reminders", config.timeoutMs);
    const reminderRowSelector = `.light-reminder-row[data-reminder-id="${reminderId}"]`;
    const reminderToggleSelector = `${reminderRowSelector} .light-feed-read-toggle`;
    await page.waitForSelector(reminderToggleSelector, { timeout: config.timeoutMs });
    await waitForElementReadState(page, reminderRowSelector, "unread", config.timeoutMs);
    summary.screenshots.reminders_feed_initial = await saveScreenshot(page, config.reportDir, "reminders-feed-initial");
    await page.locator(reminderToggleSelector).click({ timeout: config.timeoutMs });
    await waitForElementReadState(page, reminderRowSelector, "read", config.timeoutMs);
    summary.records.reminder_toggle_read = await waitForWorkspaceRecord(
      config,
      "reminders",
      reminderId,
      record => Number(record?.metadata?.seen_at_ms || 0) > 0,
      "reminder seen_at_ms after toggle read",
      config.timeoutMs,
    );
    const reminderAfterToggleRead = await readAppBadges(config);
    assert(
      apiBadgeCount(reminderAfterToggleRead, "reminders") === apiBadgeCount(reminderBaseline, "reminders"),
      "Reminder badge changed after manual read toggle",
    );
    summary.apiSnapshots.after_reminder_toggle_read = reminderAfterToggleRead;
    await page.locator(reminderToggleSelector).click({ timeout: config.timeoutMs });
    await waitForElementReadState(page, reminderRowSelector, "unread", config.timeoutMs);
    const reminderAfterToggleUnread = await readAppBadges(config);
    assert(
      apiBadgeCount(reminderAfterToggleUnread, "reminders") === apiBadgeCount(reminderBaseline, "reminders"),
      "Reminder badge changed after local unread override",
    );
    summary.apiSnapshots.after_reminder_toggle_unread_local = reminderAfterToggleUnread;
    summary.screenshots.reminders_feed_after_toggle_unread = await saveScreenshot(page, config.reportDir, "reminders-feed-after-toggle-unread");
    await backToHome(page, config.timeoutMs);
    await waitForHomeBadgeCount(page, "reminders", apiBadgeCount(reminderBaseline, "reminders"), config.timeoutMs);
    summary.screenshots.home_after_reminder_local_unread = await saveScreenshot(page, config.reportDir, "home-after-reminder-local-unread");
    const homeAfterReminderLocalUnread = await collectHomeBadgeMetrics(page);
    assert(
      badgeCountForRoute(homeAfterReminderLocalUnread, "reminders") === badgeDisplayCount(apiBadgeCount(reminderBaseline, "reminders")),
      "Reminder home badge should stay active-count based during local seen/unseen toggles",
    );
    await openRouteFromCurrentHome(page, "reminders", config.timeoutMs);
    await openReminderDetail(page, reminderId, config.timeoutMs);
    summary.screenshots.reminder_detail_open_only = await saveScreenshot(page, config.reportDir, "reminder-detail-open-only");
    summary.records.reminder_open_seen = await waitForWorkspaceRecord(
      config,
      "reminders",
      reminderId,
      record => Number(record?.metadata?.seen_at_ms || 0) > 0,
      "reminder seen_at_ms after detail open",
      config.timeoutMs,
    );
    const reminderAfterOpen = await readAppBadges(config);
    assert(
      apiBadgeCount(reminderAfterOpen, "reminders") === apiBadgeCount(reminderBaseline, "reminders"),
      "Reminder badge changed after read/open the reminder detail without acting",
    );
    summary.apiSnapshots.reminder_after_open_only = reminderAfterOpen;
    await backToHome(page, config.timeoutMs);
    await waitForHomeBadgeCount(page, "reminders", apiBadgeCount(reminderBaseline, "reminders"), config.timeoutMs);
    await openRouteFromCurrentHome(page, "reminders", config.timeoutMs);
    await openReminderDetail(page, reminderId, config.timeoutMs);
    summary.screenshots.reminder_detail_before_dismiss = await saveScreenshot(page, config.reportDir, "reminder-detail-before-dismiss");
    await waitForReminderDismiss(page, config, reminderId, apiBadgeCount(reminderBaseline, "reminders") - 1);
    summary.screenshots.reminder_list_after_dismiss = await saveScreenshot(page, config.reportDir, "reminder-list-after-dismiss");
    const afterReminderDismiss = await readAppBadges(config);
    summary.apiSnapshots.after_reminder_dismiss = afterReminderDismiss;

    await backToHome(page, config.timeoutMs);
    await waitForHomeBadges(page, config, afterReminderDismiss);
    summary.screenshots.home_final = await saveScreenshot(page, config.reportDir, "home-final");
    const finalMetrics = await collectHomeBadgeMetrics(page);
    assertHomeBadgeGeometry(finalMetrics, afterReminderDismiss);

    await writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    await browser.close();
  } catch (error) {
    summary.ok = false;
    summary.error = String(error?.message || error || "unknown error");
    try {
      await writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    } catch {
      // Ignore summary write failures during failure handling.
    }
    await writeAutomationError(config.reportDir, error);
    try {
      await browser.close();
    } catch {
      // Browser cleanup is best-effort during failure handling.
    }
    throw error;
  } finally {
    await archiveMeeting(config, meetingOneId);
    await archiveMeeting(config, meetingTwoId);
    await deleteRecord(config, "meeting-notes", meetingNoteId);
    await deleteRecord(config, "tasks", taskId);
    await deleteRecord(config, "reminders", reminderId);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
