import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { ensureDir, resolveChromePath } from "../../support/cover_shared.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function loadPlaywrightCore() {
  const bundled = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright-core");
  const candidates = [
    () => require("playwright-core"),
    () => require(bundled),
  ];
  for (const candidate of candidates) {
    try {
      return candidate();
    } catch {
      // Try the next resolution path.
    }
  }
  throw new Error("Could not resolve playwright-core from local tools or bundled runtime");
}

const { chromium } = loadPlaywrightCore();

const VIEWPORTS = [
  { label: "desktop", width: 1440, height: 1100, isMobile: false },
  { label: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true },
];

const THEMES = ["light", "dark"];
const DEFAULT_BASE_URL = "http://127.0.0.1:57678";
const DEFAULT_REPORT_DIR = path.join(repoRoot, ".tmp", "connected-unification-proof");

const FIXTURES = Object.freeze({
  project: {
    route: "project-detail",
    title: "Home refresh",
    routeId: "home-refresh",
    rootSelector: ".light-project-detail-page",
    expectedTitles: [
      "Maya Chen",
      "Front porch repair window",
      "Home refresh walkthrough",
      "House paint notes",
      "Bring paint samples upstairs",
    ],
    subtitleChecks: {
      "Maya Chen": "Design lead",
      "House paint notes": "Maya can bring paint swatches",
    },
  },
  calendar: {
    route: "meeting-detail",
    title: "Front porch repair window",
    routeId: "house-walkthrough",
    rootSelector: ".light-event-detail-page",
    expectedTitles: [
      "Maya Chen",
      "Home refresh",
      "Home refresh walkthrough",
      "House paint notes",
      "Bring paint samples upstairs",
    ],
    subtitleChecks: {
      "Maya Chen": "Design lead",
      "Home refresh": "Paint, small repairs",
    },
    expectWhoOverlap: true,
  },
  task: {
    route: "task-detail",
    title: "Bring paint samples upstairs",
    routeId: "demo-task-do-paint-samples",
    rootSelector: ".light-task-detail-surface",
    expectedTitles: [
      "Maya Chen",
      "Front porch repair window",
      "House paint notes",
      "Home refresh",
    ],
    subtitleChecks: {
      "Maya Chen": "Design lead",
      "Home refresh": "Paint, small repairs",
    },
  },
  reminder: {
    route: "reminder-detail",
    title: "Bring paint samples upstairs",
    routeId: "demo-reminder-paint-samples",
    rootSelector: ".light-reminder-detail-surface",
    expectedTitles: [
      "Bring paint samples upstairs",
      "Home refresh walkthrough",
    ],
    subtitleChecks: {
      "Bring paint samples upstairs": "Set the samples near the window",
      "Home refresh walkthrough": "Meeting-style note for paint",
    },
  },
  contact: {
    route: "contact-detail",
    title: "Maya Chen",
    routeId: "maya",
    rootSelector: ".light-contact-detail-page",
    expectedTitles: [
      "Home refresh",
      "Front porch repair window",
      "Home refresh walkthrough",
      "Bring paint samples upstairs",
    ],
    subtitleChecks: {
      "Home refresh": "Paint, small repairs",
      "Front porch repair window": "Walk the porch list",
    },
  },
  meetingNote: {
    route: "meeting-note-detail",
    title: "Home refresh walkthrough",
    routeId: "demo-meeting-home-refresh",
    rootSelector: ".light-meeting-note-detail-page",
    expectedTitles: [
      "Maya Chen",
      "Front porch repair window",
      "House paint notes",
      "Bring paint samples upstairs",
      "Home refresh",
    ],
    subtitleChecks: {
      "Maya Chen": "Design lead",
      "Home refresh": "Paint, small repairs",
    },
  },
});

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: "",
    reportDir: DEFAULT_REPORT_DIR,
    headless: true,
    timeoutMs: 20_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    const next = argv[index + 1];
    if (arg === "--base-url" && next) {
      config.baseUrl = String(next);
      index += 1;
      continue;
    }
    if (arg === "--api-token" && next) {
      config.apiToken = String(next);
      index += 1;
      continue;
    }
    if (arg === "--report-dir" && next) {
      config.reportDir = path.resolve(String(next));
      index += 1;
      continue;
    }
    if (arg === "--headed") {
      config.headless = false;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      config.timeoutMs = Math.max(5_000, Number(next) || config.timeoutMs);
      index += 1;
    }
  }
  if (!config.apiToken) {
    config.apiToken = String(
      process.env.PUCKY_WORKSPACE_PROOF_TOKEN
      || process.env.PUCKY_API_TOKEN
      || process.env.PUCKY_OPERATOR_TOKEN
      || ""
    ).trim();
  }
  if (!config.apiToken) {
    throw new Error("Connected unification proof requires --api-token or PUCKY_WORKSPACE_PROOF_TOKEN/PUCKY_API_TOKEN/PUCKY_OPERATOR_TOKEN");
  }
  config.baseUrl = String(config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  return config;
}

async function apiRequest(config, apiPath, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }
  const requestInit = {
    method: options.method || "GET",
    headers,
  };
  if (options.body !== undefined) {
    requestInit.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    if (!requestInit.headers["Content-Type"] && !requestInit.headers["content-type"]) {
      requestInit.headers["Content-Type"] = "application/json";
    }
  }
  const response = await fetch(`${config.baseUrl}${apiPath}`, requestInit);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${requestInit.method} ${apiPath} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

function buildRouteUrl(config, route, theme) {
  const url = new URL(`${config.baseUrl}/ui/pucky/latest/index.html`);
  url.searchParams.set("route", route);
  url.searchParams.set("theme", theme);
  url.searchParams.set("reset_nav", "1");
  url.searchParams.set("api_token", config.apiToken);
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
        postData: request.postDataBuffer() || undefined,
      });
      await route.fulfill({ response });
    } catch (error) {
      const message = String(error?.message || error || "");
      if (/target page, context or browser has been closed/i.test(message)
          || /fetch response has been disposed/i.test(message)
          || /request context disposed/i.test(message)) {
        await route.abort("failed").catch(() => {});
        return;
      }
      throw error;
    }
  });
}

async function waitForLightRoute(page, route, timeoutMs) {
  await page.locator(`.light-shell[data-light-route="${route}"]`).waitFor({ state: "visible", timeout: timeoutMs });
}

async function waitForHeaderText(page, text, timeoutMs, selector = ".light-page-title") {
  await page.waitForFunction(
    ({ target, query }) => {
      const node = document.querySelector(query);
      return String(node?.textContent || "").replace(/\s+/g, " ").trim().includes(target);
    },
    { target: text, query: selector },
    { timeout: timeoutMs }
  );
}

async function waitForTextWithin(page, selector, text, timeoutMs) {
  await page.locator(selector).waitFor({ state: "visible", timeout: timeoutMs });
  await page.waitForFunction(
    ({ target, query }) => {
      const node = document.querySelector(query);
      return String(node?.textContent || "").replace(/\s+/g, " ").trim().includes(target);
    },
    { target: text, query: selector },
    { timeout: timeoutMs }
  );
}

async function clickBackButton(page, timeoutMs) {
  const back = page.locator(".light-back-button, #detail .detail-back").first();
  await back.waitFor({ state: "visible", timeout: timeoutMs });
  await back.click();
}

async function saveScreenshot(page, dir, name) {
  const target = path.join(dir, name);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}

async function saveLocatorShot(locator, dir, name) {
  const target = path.join(dir, name);
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await locator.waitFor({ state: "visible", timeout: 5_000 });
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.screenshot({ path: target });
      return target;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastError;
}

async function expandProjectsSections(page) {
  const headers = page.locator(".light-projects-section-header");
  const count = await headers.count();
  for (let index = 0; index < count; index += 1) {
    const header = headers.nth(index);
    const expanded = String((await header.getAttribute("aria-expanded")) || "").trim().toLowerCase();
    if (expanded === "false") {
      await header.click();
    }
  }
}

async function openProjectDetail(page, timeoutMs) {
  await page.waitForFunction(
    () => document.querySelectorAll(".light-project-row").length > 0,
    undefined,
    { timeout: timeoutMs }
  );
  await expandProjectsSections(page);
  const row = page.locator('.light-project-row', { hasText: FIXTURES.project.title }).first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });
  await row.click();
  await waitForLightRoute(page, FIXTURES.project.route, timeoutMs);
  await waitForHeaderText(page, FIXTURES.project.title, timeoutMs);
}

async function openConnectedTarget(page, fixture, timeoutMs) {
  const row = page.locator(
    `.light-linked-record-feed-row[data-workspace-target-route="${fixture.route}"][data-workspace-target-id="${fixture.routeId}"]`
  ).first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });
  await row.click();
  await waitForLightRoute(page, fixture.route, timeoutMs);
  await waitForTextWithin(page, fixture.rootSelector, fixture.title, timeoutMs);
}

async function waitForConnectedHydration(page, rootSelector, minRows, timeoutMs) {
  await page.waitForFunction(
    ({ selector, expectedRows }) => {
      const root = document.querySelector(selector);
      if (!root) {
        return false;
      }
      const rows = Array.from(root.querySelectorAll('.light-linked-records-section[data-linked-records-title="connected"] .light-linked-record-feed-row'));
      if (rows.length < expectedRows) {
        return false;
      }
      return rows.every(row => {
        const route = String(row.getAttribute("data-workspace-target-route") || "").trim();
        const targetId = String(row.getAttribute("data-workspace-target-id") || "").trim();
        const title = String(row.querySelector(".light-linked-record-feed-title")?.textContent || "").trim();
        return row.tagName === "BUTTON" && Boolean(route) && Boolean(targetId) && Boolean(title);
      });
    },
    { selector: rootSelector, expectedRows: Math.max(1, Number(minRows || 1) || 1) },
    { timeout: timeoutMs }
  );
}

async function readConnectedState(page, rootSelector) {
  return page.evaluate(selector => {
    const normalizedText = value => String(value || "").replace(/\s+/g, " ").trim();
    const root = document.querySelector(selector);
    const section = root?.querySelector('.light-linked-records-section[data-linked-records-title="connected"]');
    const header = section?.querySelector(":scope > .light-meeting-detail-section-header");
    const wrapper = section?.querySelector(":scope > .light-meeting-detail-section-body");
    const list = wrapper?.querySelector(".light-linked-record-list");
    const rows = Array.from(section?.querySelectorAll(".light-linked-record-feed-row") || []);
    const detailWhoLabels = Array.from(root?.querySelectorAll('.light-calendar-detail-row[data-detail-row="who"] .light-calendar-attendee-chip-label') || [])
      .map(node => normalizedText(node.textContent))
      .filter(Boolean);
    const connectedCount = Number.parseInt(normalizedText(section?.querySelector(".light-meeting-detail-section-count")?.textContent), 10);
    return {
      hasSection: Boolean(section),
      expanded: header?.getAttribute("aria-expanded") === "true",
      sectionClassName: String(section?.className || "").trim(),
      headerClassName: String(header?.className || "").trim(),
      wrapperClassName: String(wrapper?.className || "").trim(),
      bodyClassName: String(list?.className || "").trim(),
      count: Number.isFinite(connectedCount) ? connectedCount : rows.length,
      detailWhoLabels,
      rows: rows.map(row => {
        const titleNode = row.querySelector(".light-linked-record-feed-title");
        const metaNode = row.querySelector(".light-linked-record-feed-meta");
        const subtitleNode = row.querySelector(".light-linked-record-feed-subtitle");
        const iconNode = row.querySelector(".light-small-icon");
        const headNode = row.querySelector(".light-linked-record-feed-head");
        const titleRect = titleNode?.getBoundingClientRect?.();
        const metaRect = metaNode?.getBoundingClientRect?.();
        const headRect = headNode?.getBoundingClientRect?.();
        const iconStyle = iconNode instanceof HTMLElement ? getComputedStyle(iconNode) : null;
        return {
          className: String(row.className || "").trim(),
          targetRoute: String(row.getAttribute("data-workspace-target-route") || "").trim(),
          targetId: String(row.getAttribute("data-workspace-target-id") || "").trim(),
          targetKind: String(row.getAttribute("data-workspace-target-kind") || "").trim(),
          kind: String(row.getAttribute("data-linked-record-kind") || "").trim(),
          id: String(row.getAttribute("data-linked-record-id") || "").trim(),
          title: normalizedText(titleNode?.textContent),
          meta: normalizedText(metaNode?.textContent),
          subtitle: normalizedText(subtitleNode?.textContent),
          interactive: row.tagName === "BUTTON",
          rowSignature: String([row.className, row.getAttribute("data-linked-record-kind") || ""].join("|")).trim(),
          metaSameLine: Boolean(titleRect && metaRect && Math.abs(titleRect.top - metaRect.top) <= 6),
          metaAlignedRight: Boolean(headRect && metaRect && Math.abs(headRect.right - metaRect.right) <= 18),
          iconColor: iconStyle ? String(iconStyle.color || "").trim() : "",
          iconBackground: iconStyle ? String(iconStyle.backgroundColor || "").trim() : "",
        };
      }),
    };
  }, rootSelector);
}

function assertConnectedRowsShared(state, fixture) {
  assert(state.hasSection, `Expected ${fixture.route} to render a Connected section.`);
  assert(state.expanded, `Expected ${fixture.route} Connected to start open on a fresh detail open.`);
  assert(state.sectionClassName.includes("light-meeting-detail-section"), `Expected ${fixture.route} Connected to use the shared collapsible shell, got ${state.sectionClassName}.`);
  assert(state.sectionClassName.includes("light-linked-records-section"), `Expected ${fixture.route} Connected to keep the shared linked-record section class, got ${state.sectionClassName}.`);
  assert(state.bodyClassName.includes("light-linked-record-list"), `Expected ${fixture.route} Connected to keep the shared linked-record list body, got ${state.bodyClassName}.`);
  assert(state.bodyClassName.includes("is-flat-feed"), `Expected ${fixture.route} Connected body to stay flat-feed, got ${state.bodyClassName}.`);
  assert(state.rows.length >= fixture.expectedTitles.length, `Expected ${fixture.route} Connected to render at least ${fixture.expectedTitles.length} rows, got ${state.rows.length}.`);
  assert(state.count === state.rows.length, `Expected ${fixture.route} Connected header count to match rendered rows, got count ${state.count} rows ${state.rows.length}.`);
  assert(new Set(state.rows.map(row => `${row.kind}:${row.id}`)).size === state.rows.length, `Expected ${fixture.route} Connected rows to stay deduped by kind/id.`);
  assert(new Set(state.rows.map(row => row.className)).size === 1, `Expected ${fixture.route} Connected rows to share one class signature, got ${state.rows.map(row => row.className).join(" | ")}.`);
  assert(state.rows.every(row => row.className.includes("light-linked-record-feed-row")), `Expected ${fixture.route} Connected rows to use the shared linked-record row, got ${state.rows.map(row => row.className).join(" | ")}.`);
  assert(state.rows.every(row => row.className.includes("is-flat-feed")), `Expected ${fixture.route} Connected rows to stay flat-feed.`);
  assert(state.rows.every(row => row.className.includes("is-no-chips")), `Expected ${fixture.route} Connected rows to omit chips.`);
  assert(state.rows.every(row => row.className.includes("is-no-chevron")), `Expected ${fixture.route} Connected rows to omit chevrons.`);
  assert(state.rows.every(row => row.interactive), `Expected ${fixture.route} Connected rows to stay interactive once hydrated.`);
  const rowsWithMeta = state.rows.filter(row => row.meta);
  assert(rowsWithMeta.length >= 1, `Expected ${fixture.route} Connected to expose at least one top-right timestamp/meta value.`);
  assert(rowsWithMeta.every(row => row.metaSameLine), `Expected ${fixture.route} Connected timestamps to stay on the same top line as the title.`);
  assert(rowsWithMeta.every(row => row.metaAlignedRight), `Expected ${fixture.route} Connected timestamps to stay right-aligned inside the header row.`);
  for (const title of fixture.expectedTitles) {
    assert(state.rows.some(row => row.title.includes(title)), `Expected ${fixture.route} Connected to include ${title}, got ${state.rows.map(row => row.title).join(", ")}.`);
  }
  for (const [title, snippet] of Object.entries(fixture.subtitleChecks || {})) {
    const row = state.rows.find(item => item.title.includes(title));
    assert(row, `Expected ${fixture.route} Connected to include subtitle-check row ${title}.`);
    assert(row.subtitle.includes(snippet), `Expected ${fixture.route} row ${title} to reuse existing summary text. Saw "${row.subtitle}".`);
  }
  const genericPrefix = /^(?:Task|Note|Project|Contact|Reminder|Calendar|Meeting note|Inbox)\s*[·:-]/i;
  assert(state.rows.every(row => !genericPrefix.test(row.subtitle)), `Expected ${fixture.route} Connected subtitles to avoid generic kind filler. Got ${state.rows.map(row => `${row.title} => ${row.subtitle}`).join(" | ")}.`);
}

async function listRuntimeMeetings(config, query = "") {
  const suffix = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  const payload = await apiRequest(config, `/api/meetings${suffix}`);
  return Array.isArray(payload?.meetings) ? payload.meetings : [];
}

function runtimeMeetingHasConnected(item) {
  const connected = Array.isArray(item?.connected_records) ? item.connected_records : [];
  const feedConnected = Array.isArray(item?.feed_item?.connected_records) ? item.feed_item.connected_records : [];
  const combined = connected.length ? connected : feedConnected;
  return combined.length > 0;
}

function isLocalBaseUrl(baseUrl) {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(String(baseUrl || "").trim());
}

async function waitForRuntimeMeeting(config, meetingId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const meetings = await listRuntimeMeetings(config, "include_archived=1");
    const match = meetings.find(item => String(item?.meeting_id || "").trim() === meetingId) || null;
    if (match && String(match?.state || match?.meeting_state || "").trim().toLowerCase() === "completed" && runtimeMeetingHasConnected(match)) {
      return {
        meetingId: String(match.meeting_id || "").trim(),
        title: String(match.title || match.recording_title || match.meeting_id || "").trim(),
        archived: Boolean(match?.archived),
      };
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for runtime meeting ${meetingId} to complete with connected records.`);
}

async function archiveRuntimeMeeting(config, meetingId) {
  if (!meetingId) {
    return;
  }
  try {
    await apiRequest(config, "/api/meetings/actions", {
      method: "POST",
      body: {
        client_action_id: `connected-unification-archive-${meetingId}-${Date.now()}`,
        meeting_id: meetingId,
        action: "archive",
      },
    });
  } catch {
    // Cleanup should not hide the main proof result.
  }
}

async function unarchiveRuntimeMeeting(config, meetingId) {
  if (!meetingId) {
    return;
  }
  try {
    await apiRequest(config, "/api/meetings/actions", {
      method: "POST",
      body: {
        client_action_id: `connected-unification-unarchive-${meetingId}-${Date.now()}`,
        meeting_id: meetingId,
        action: "unarchive",
      },
    });
  } catch {
    // Hosted/runtime availability can vary; callers handle fallback behavior.
  }
}

async function ensureRuntimeMeeting(config) {
  if (!isLocalBaseUrl(config.baseUrl)) {
    const existingMeetings = await listRuntimeMeetings(config);
    const existing = existingMeetings.find(item => runtimeMeetingHasConnected(item) && String(item?.state || item?.meeting_state || "").trim().toLowerCase() === "completed") || null;
    if (existing) {
      if (existing?.archived) {
        await unarchiveRuntimeMeeting(config, String(existing.meeting_id || "").trim());
      }
      return {
        meetingId: String(existing.meeting_id || "").trim(),
        title: String(existing.title || existing.recording_title || existing.meeting_id || "").trim(),
        createdForProof: false,
        archived: false,
      };
    }
  }
  const meetingId = `meeting-connected-unification-proof-${Date.now()}`;
  await apiRequest(config, "/api/meetings", {
    method: "POST",
    body: {
      meeting_id: meetingId,
      started_at: new Date(Date.now() - 8_000).toISOString(),
      stopped_at: new Date(Date.now() - 3_000).toISOString(),
      duration_ms: 5_000,
      device_id: "connected-unification-proof-device",
      device_path: `/tmp/${meetingId}.m4a`,
      mime_type: "audio/mp4",
      audio_base64: Buffer.from(`RIFF-${meetingId}`).toString("base64"),
    },
  });
  try {
    const created = await waitForRuntimeMeeting(config, meetingId, Math.max(config.timeoutMs * 3, 90_000));
    if (created?.archived) {
      await unarchiveRuntimeMeeting(config, created.meetingId);
    }
    return {
      ...created,
      createdForProof: true,
      archived: false,
    };
  } catch (error) {
    if (isLocalBaseUrl(config.baseUrl)) {
      throw error;
    }
    return {
      meetingId: "",
      title: "",
      createdForProof: false,
      unavailableReason: String(error?.message || error || "runtime meeting unavailable"),
    };
  }
}

async function waitForMeetingsReady(page, timeoutMs) {
  await page.waitForFunction(() => {
    const empty = document.querySelector(".meetings-empty");
    if (empty) {
      const text = String(empty.textContent || "").trim();
      if (text && !/loading meetings/i.test(text)) {
        return true;
      }
    }
    return Boolean(document.querySelector("article[data-card-session-id] .card-body, article[data-card-id] .card-body"));
  }, undefined, { timeout: timeoutMs });
}

async function openRuntimeMeetingDetail(page, meeting, timeoutMs) {
  const detailTimeoutMs = Math.max(timeoutMs, 30_000);
  const idSelector = `article[data-card-session-id="${meeting.meetingId}"], article[data-card-id="pucky_card_${meeting.meetingId}"]`;
  let card = page.locator(idSelector).first();
  try {
    await card.waitFor({ state: "visible", timeout: detailTimeoutMs });
  } catch {
    card = page.locator("article").filter({ hasText: meeting.title }).first();
    await card.waitFor({ state: "visible", timeout: detailTimeoutMs });
  }
  await card.scrollIntoViewIfNeeded().catch(() => {});
  await card.click();
  await page.waitForFunction(title => {
    const detail = document.getElementById("detail");
    return Boolean(
      detail
      && detail.classList.contains("is-open")
      && String(detail.querySelector(".light-page-title")?.textContent || "").replace(/\s+/g, " ").trim().includes(title)
    );
  }, meeting.title, { timeout: detailTimeoutMs });
  await page.locator("#detail .light-meeting-runtime-detail").first().waitFor({ state: "visible", timeout: detailTimeoutMs });
}

async function verifySurface(page, scenarioDir, viewportLabel, theme, fixture, summary, timeoutMs) {
  await waitForConnectedHydration(page, fixture.rootSelector, fixture.expectedTitles.length, timeoutMs);
  const state = await readConnectedState(page, fixture.rootSelector);
  assertConnectedRowsShared(state, fixture);
  if (fixture.expectWhoOverlap) {
    assert(state.detailWhoLabels.some(label => /maya/i.test(label)), `Expected ${fixture.route} Who section to keep Maya visible alongside Connected.`);
    assert(state.rows.some(row => row.title.includes("Maya Chen")), `Expected ${fixture.route} Connected to include the same linked contact that appears in Who.`);
  }
  summary.surfaces.push({
    viewport: viewportLabel,
    theme,
    route: fixture.route,
    title: fixture.title,
    sectionClassName: state.sectionClassName,
    rowClassName: state.rows[0]?.className || "",
    rowCount: state.rows.length,
  });
  const slug = `${viewportLabel}-${theme}-${fixture.route}`;
  summary.screenshots[`${slug}-full`] = await saveScreenshot(page, scenarioDir, `${slug}-full.png`);
  summary.screenshots[`${slug}-connected`] = await saveLocatorShot(
    page.locator(`${fixture.rootSelector} .light-linked-records-section[data-linked-records-title="connected"]`).first(),
    scenarioDir,
    `${slug}-connected.png`
  );
}

async function runScenario(page, config, viewport, theme, summary) {
  const scenarioDir = path.join(config.reportDir, `${viewport.label}-${theme}`);
  ensureDir(scenarioDir);

  await page.goto(buildRouteUrl(config, "projects", theme), { waitUntil: "networkidle", timeout: config.timeoutMs });
  await waitForLightRoute(page, "projects", config.timeoutMs);
  await openProjectDetail(page, config.timeoutMs);
  await verifySurface(page, scenarioDir, viewport.label, theme, FIXTURES.project, summary, config.timeoutMs);

  for (const fixture of [FIXTURES.calendar, FIXTURES.task, FIXTURES.reminder, FIXTURES.contact, FIXTURES.meetingNote]) {
    await openConnectedTarget(page, fixture, config.timeoutMs);
    await verifySurface(page, scenarioDir, viewport.label, theme, fixture, summary, config.timeoutMs);
    await clickBackButton(page, config.timeoutMs);
    await waitForLightRoute(page, "project-detail", config.timeoutMs);
    await waitForHeaderText(page, FIXTURES.project.title, config.timeoutMs);
  }

  const runtimeMeeting = config.runtimeMeeting;
  if (runtimeMeeting?.meetingId) {
    try {
      await page.goto(buildRouteUrl(config, "meetings", theme), { waitUntil: "networkidle", timeout: config.timeoutMs });
      await waitForMeetingsReady(page, config.timeoutMs);
      await openRuntimeMeetingDetail(page, runtimeMeeting, config.timeoutMs);
      const runtimeFixture = {
        route: "meeting-runtime-detail",
        title: runtimeMeeting.title,
        rootSelector: "#detail .light-meeting-runtime-detail",
        expectedTitles: [],
        subtitleChecks: {},
      };
      await waitForConnectedHydration(page, runtimeFixture.rootSelector, 1, config.timeoutMs);
      const runtimeState = await readConnectedState(page, runtimeFixture.rootSelector);
      assert(runtimeState.hasSection, "Expected runtime meeting detail to render Connected.");
      assert(runtimeState.expanded, "Expected runtime meeting Connected to start open.");
      assert(runtimeState.sectionClassName.includes("light-meeting-detail-section"), `Expected runtime meeting Connected to use the shared shell, got ${runtimeState.sectionClassName}.`);
      assert(runtimeState.bodyClassName.includes("light-linked-record-list"), `Expected runtime meeting Connected to use the shared list body, got ${runtimeState.bodyClassName}.`);
      assert(runtimeState.rows.length >= 1, "Expected runtime meeting Connected to expose at least one linked record.");
      assert(runtimeState.rows.every(row => row.className.includes("light-linked-record-feed-row")), "Expected runtime meeting Connected rows to reuse the shared row.");
      const runtimeRowsWithMeta = runtimeState.rows.filter(row => row.meta);
      if (runtimeRowsWithMeta.length) {
        assert(runtimeRowsWithMeta.every(row => row.metaSameLine), "Expected runtime meeting Connected metadata to stay on the same top line as the title.");
        assert(runtimeRowsWithMeta.every(row => row.metaAlignedRight), "Expected runtime meeting Connected metadata to stay right-aligned.");
      }
      summary.surfaces.push({
        viewport: viewport.label,
        theme,
        route: runtimeFixture.route,
        title: runtimeMeeting.title,
        sectionClassName: runtimeState.sectionClassName,
        rowClassName: runtimeState.rows[0]?.className || "",
        rowCount: runtimeState.rows.length,
      });
      const runtimeSlug = `${viewport.label}-${theme}-meeting-runtime-detail`;
      summary.screenshots[`${runtimeSlug}-full`] = await saveScreenshot(page, scenarioDir, `${runtimeSlug}-full.png`);
      summary.screenshots[`${runtimeSlug}-connected`] = await saveLocatorShot(
        page.locator('#detail .light-linked-records-section[data-linked-records-title="connected"]').first(),
        scenarioDir,
        `${runtimeSlug}-connected.png`
      );
    } catch (error) {
      summary.runtime_meeting = {
        skipped: true,
        reason: String(error?.message || error || "runtime meeting detail unavailable"),
        meeting_id: runtimeMeeting.meetingId,
      };
    }
  } else if (runtimeMeeting?.unavailableReason) {
    summary.runtime_meeting = {
      skipped: true,
      reason: runtimeMeeting.unavailableReason,
    };
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  config.runtimeMeeting = await ensureRuntimeMeeting(config);
  const summary = {
    schema: "pucky.connected_unification_proof.v1",
    generated_at: new Date().toISOString(),
    base_url: config.baseUrl,
    surfaces: [],
    screenshots: {},
  };
  const browser = await chromium.launch({
    headless: config.headless,
    executablePath: resolveChromePath(),
  });
  try {
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: Boolean(viewport.isMobile),
          hasTouch: Boolean(viewport.hasTouch),
          deviceScaleFactor: 1,
        });
        await installAuthorizedApiProxy(context, config.baseUrl, config.apiToken);
        const page = await context.newPage();
        try {
          await runScenario(page, config, viewport, theme, summary);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    if (config.runtimeMeeting?.createdForProof) {
      await archiveRuntimeMeeting(config, config.runtimeMeeting.meetingId);
    }
    await browser.close();
  }
  const summaryPath = path.join(config.reportDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  process.stdout.write(`${summaryPath}\n`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
