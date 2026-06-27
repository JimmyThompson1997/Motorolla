import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  assert,
  cleanupTaskProofSeed,
  logStep,
  restoreTaskProofSeed,
  seedTaskProofWorkspace,
} from "../../support/task_workspace_proof_shared.mjs";
import {
  buildPageTracking,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile,
} from "../../support/cover_shared.mjs";
import {
  loadFlyEnvironment,
  loadProofRuntimeEnv,
  resolveWriteToken,
} from "../../support/proof_runtime_env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
loadProofRuntimeEnv({ rootDir: ROOT });
const DEFAULT_BASE_URL = process.env.PUCKY_LIVE_USER_SESSION_BASE_URL || "https://pucky.fly.dev";
const RESULT_SCHEMA = "pucky.live_user_session_browser_proof.v1";
const REQUIRED_HOME_ROUTES = [
  "inbox",
  "meetings",
  "meeting-notes",
  "reminders",
  "connect",
  "settings",
  "notes",
  "tasks",
  "calendar",
  "projects",
  "contacts",
];
const UNIVERSAL_FEED_TILE_ROUTES = [
  "inbox",
  "meetings",
  "meeting-notes",
  "reminders",
  "notes",
  "projects",
];
const LIVE_CONNECT_REQUIRED_SLUGS = ["gmail", "googlecalendar"];
const TASK_LINKS = [
  {
    kind: "calendar_event",
    label: "calendar event",
    route: "meeting-detail",
    idKey: "calendarEventId",
    titleKey: "calendarEventTitle",
  },
  {
    kind: "contact",
    label: "contact",
    route: "contact-detail",
    idKey: "contactId",
    titleKey: "contactTitle",
  },
  {
    kind: "project",
    label: "project",
    route: "project-detail",
    idKey: "projectId",
    titleKey: "projectTitle",
  },
  {
    kind: "note",
    label: "note",
    route: "note-detail",
    idKey: "noteId",
    titleKey: "noteTitle",
  },
];
const MEETING_RUNTIME_FIXTURE_PATH = path.join(ROOT, "pucky_vm", "ui_src", "fixtures", "artifacts", "meeting.wav");

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "proof";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isZeroishPx(value) {
  return Math.abs(Number.parseFloat(String(value || "0")) || 0) <= 0.5;
}

function isTransparentColor(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "transparent") {
    return true;
  }
  const rgba = text.match(/^rgba?\((.+)\)$/);
  if (!rgba) {
    return false;
  }
  const parts = rgba[1].split(",").map(part => part.trim());
  if (parts.length === 4) {
    return Math.abs(Number.parseFloat(parts[3]) || 0) <= 0.01;
  }
  return parts.slice(0, 3).every(part => Number.parseFloat(part) === 0);
}

function isNoShadow(value) {
  const text = String(value || "").trim().toLowerCase();
  return !text || text === "none" || text === "rgba(0, 0, 0, 0) 0px 0px 0px 0px";
}

function isHostedDeployBaseUrl(baseUrl) {
  try {
    return /(^|\.)pucky\.fly\.dev$/i.test(new URL(String(baseUrl || "")).hostname);
  } catch (_error) {
    return false;
  }
}

function resolveApiToken() {
  return resolveWriteToken({
    envKeys: ["PUCKY_LIVE_USER_SESSION_TOKEN"],
    sharedKeys: ["PUCKY_API_TOKEN", "PUCKY_OPERATOR_TOKEN"],
    rootDir: ROOT,
    remoteEnvLoader: () => loadFlyEnvironment({ app: "pucky", rootDir: ROOT }),
  });
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
      const message = String(error && error.message ? error.message : error || "");
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

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: resolveApiToken(),
    timeoutMs: 30000,
    runId: `live-user-session-${Date.now()}`,
    keepSeed: false,
    reportDir: path.resolve(".tmp", "live-user-session-proof", timestampSlug()),
    routes: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).replace(/\/+$/, "");
    } else if (arg === "--api-token" && argv[index + 1]) {
      config.apiToken = String(argv[++index] || config.apiToken);
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--run-id" && argv[index + 1]) {
      config.runId = String(argv[++index] || config.runId);
    } else if (arg === "--routes" && argv[index + 1]) {
      config.routes = String(argv[++index] || "")
        .split(",")
        .map(value => String(value || "").trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === "--keep-seed") {
      config.keepSeed = true;
    }
  }
  return config;
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function localGitState() {
  try {
    return {
      head: runGit(["rev-parse", "HEAD"]),
      headShort: runGit(["rev-parse", "--short", "HEAD"]),
    };
  } catch (_error) {
    return {
      head: "",
      headShort: "",
    };
  }
}

async function fetchRemoteManifest(baseUrl, refreshKey) {
  const url = new URL("/ui/pucky/latest/manifest.json", `${String(baseUrl || "").replace(/\/+$/, "")}/`);
  if (String(refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(refreshKey || "").trim());
  }
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`Could not load remote manifest (${response.status}) from ${url.toString()}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!payload || typeof payload !== "object") {
    throw new Error(`Remote manifest from ${url.toString()} was not valid JSON`);
  }
  return {
    manifest: payload,
    manifestUrl: url.toString(),
  };
}

async function fetchConnectMyApps(baseUrl, refreshKey) {
  const url = new URL("/api/links/composio/my-apps", `${String(baseUrl || "").replace(/\/+$/, "")}/`);
  if (String(refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(refreshKey || "").trim());
  }
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  if (!response.ok) {
    if (!isHostedDeployBaseUrl(baseUrl) && response.status >= 500) {
      return {
        myAppsUrl: url.toString(),
        payload: {},
        activeApps: [],
      };
    }
    throw new Error(`Could not load Connect my-apps (${response.status}) from ${url.toString()}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!payload || typeof payload !== "object") {
    throw new Error(`Connect my-apps from ${url.toString()} was not valid JSON`);
  }
  const activeApps = Array.isArray(payload.apps)
    ? payload.apps
        .filter(item => Number(item?.counts?.active || 0) > 0)
        .map(item => ({
          slug: String(item?.slug || "").trim().toLowerCase(),
          name: normalizeText(item?.name || item?.slug || ""),
        }))
        .filter(item => item.slug)
        .sort((left, right) => left.slug.localeCompare(right.slug))
    : [];
  return {
    myAppsUrl: url.toString(),
    payload,
    activeApps,
  };
}

async function fetchTaskRecord(baseUrl, taskId, refreshKey) {
  const url = new URL(`/api/workspace/tasks/${encodeURIComponent(String(taskId || "").trim())}`, `${String(baseUrl || "").replace(/\/+$/, "")}/`);
  if (String(refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(refreshKey || "").trim());
  }
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`Could not load task record (${response.status}) from ${url.toString()}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!payload || typeof payload !== "object") {
    throw new Error(`Task record from ${url.toString()} was not valid JSON`);
  }
  return payload;
}

async function waitForTaskRecord(baseUrl, taskId, refreshKey, predicate, timeoutMs, failureMessage) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 0) || 0);
  let lastRecord = null;
  while (Date.now() <= deadline) {
    lastRecord = await fetchTaskRecord(baseUrl, taskId, refreshKey);
    if (predicate(lastRecord)) {
      return lastRecord;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const lastSummary = lastRecord && typeof lastRecord === "object"
    ? {
        status: String(lastRecord.status || ""),
        completed_at_ms: Number(lastRecord.completed_at_ms || 0) || 0,
      }
    : lastRecord;
  throw new Error(`${failureMessage} (last task record: ${JSON.stringify(lastSummary)})`);
}

async function authorizedJsonRequest(baseUrl, apiToken, pathName, options = {}) {
  const token = String(apiToken || "").trim();
  if (!token) {
    throw new Error("Authorized request requires an API token");
  }
  const url = new URL(String(pathName || ""), `${String(baseUrl || "").replace(/\/+$/, "")}/`);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  let body = options.body;
  if (body && typeof body !== "string" && !(body instanceof Uint8Array)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    body = JSON.stringify(body);
  }
  const response = await fetch(url, {
    method: String(options.method || "GET").toUpperCase(),
    headers,
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${headers["Content-Type"] === "application/json" ? "JSON " : ""}${options.method || "GET"} ${url.toString()} failed with ${response.status}: ${String(payload?.detail || payload?.error || "")}`);
  }
  return payload;
}

async function listLiveMeetings(baseUrl, apiToken) {
  const payload = await authorizedJsonRequest(baseUrl, apiToken, "/api/meetings?compact=1");
  return Array.isArray(payload?.meetings) ? payload.meetings : [];
}

async function archiveVisibleMeetings(baseUrl, apiToken, runId) {
  const meetings = await listLiveMeetings(baseUrl, apiToken);
  const archivedIds = [];
  for (const [index, meeting] of meetings.entries()) {
    const meetingId = String(meeting?.meeting_id || "").trim();
    if (!meetingId) {
      continue;
    }
    await authorizedJsonRequest(baseUrl, apiToken, "/api/meetings/actions", {
      method: "POST",
      body: {
        client_action_id: `${slug(runId)}-archive-${index + 1}-${Date.now()}`,
        meeting_id: meetingId,
        action: "archive",
      },
    });
    archivedIds.push(meetingId);
  }
  return archivedIds;
}

async function ingestRuntimeProofMeeting(baseUrl, apiToken, runId) {
  const fixture = fs.readFileSync(MEETING_RUNTIME_FIXTURE_PATH);
  const meetingId = `meeting-${timestampSlug()}-${slug(runId)}-runtime-check`;
  const now = Date.now();
  const startedAt = new Date(now - 6000).toISOString();
  const stoppedAt = new Date(now).toISOString();
  const payload = await authorizedJsonRequest(baseUrl, apiToken, "/api/meetings", {
    method: "POST",
    body: {
      meeting_id: meetingId,
      started_at: startedAt,
      stopped_at: stoppedAt,
      duration_ms: 32044,
      device_id: "codex-live-session-proof",
      device_path: `/data/user/0/com.pucky.device.debug/files/voice/${meetingId}.wav`,
      mime_type: "audio/wav",
      audio_base64: fixture.toString("base64"),
    },
  });
  return {
    meetingId,
    ingestState: String(payload?.state || ""),
  };
}

async function waitForMeetingCompletion(baseUrl, apiToken, meetingId, timeoutMs) {
  const deadline = Date.now() + Math.max(5000, Number(timeoutMs || 0) || 0);
  let lastMeeting = null;
  while (Date.now() <= deadline) {
    const meetings = await listLiveMeetings(baseUrl, apiToken);
    lastMeeting = meetings.find(item => String(item?.meeting_id || "").trim() === String(meetingId || "").trim()) || null;
    const stateName = String(lastMeeting?.state || "").trim().toLowerCase();
    if (stateName === "completed_with_missing_result") {
      throw new Error(`Runtime meeting ${meetingId} regressed to completed_with_missing_result.`);
    }
    if (lastMeeting && ["completed", "failed"].includes(stateName)) {
      return lastMeeting;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const lastState = String(lastMeeting?.state || "").trim().toLowerCase();
  if (lastState === "processing") {
    throw new Error(`Runtime meeting ${meetingId} meeting stayed in processing past the allowed proof timeout (last state processing).`);
  }
  throw new Error(`Timed out waiting for runtime meeting ${meetingId} to complete (last state ${String(lastMeeting?.state || "")})`);
}

async function prepareRuntimeMeeting(baseUrl, apiToken, runId, timeoutMs) {
  const archivedMeetingIds = await archiveVisibleMeetings(baseUrl, apiToken, runId);
  const ingested = await ingestRuntimeProofMeeting(baseUrl, apiToken, runId);
  return {
    archivedMeetingIds,
    meetingId: String(ingested.meetingId || ""),
    title: normalizeText(ingested.meetingId),
    state: String(ingested.ingestState || "processing"),
    transcriptStatus: "",
    summary: "",
    ingestState: String(ingested.ingestState || ""),
  };
}

async function finalizeRuntimeMeeting(baseUrl, apiToken, runtimeMeeting, timeoutMs) {
  const completed = await waitForMeetingCompletion(baseUrl, apiToken, runtimeMeeting?.meetingId, timeoutMs);
  return {
    ...(runtimeMeeting && typeof runtimeMeeting === "object" ? runtimeMeeting : {}),
    meetingId: String(completed?.meeting_id || runtimeMeeting?.meetingId || ""),
    title: normalizeText(completed?.title || completed?.recording_title || runtimeMeeting?.meetingId || ""),
    state: String(completed?.state || ""),
    transcriptStatus: String(completed?.transcript_status || ""),
    summary: normalizeText(completed?.summary || completed?.failure_reason || completed?.transcript_error || ""),
    failureReason: normalizeText(completed?.failure_reason || completed?.transcript_error || ""),
  };
}

async function loadChromium() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  if (process.env.CODEX_NODE_MODULES) {
    candidates.push(process.env.CODEX_NODE_MODULES);
  }
  if (process.env.USERPROFILE) {
    candidates.push(path.join(
      process.env.USERPROFILE,
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "node_modules"
    ));
  }
  candidates.push(path.join(ROOT, "tools", "node_modules"));
  candidates.push(path.join(ROOT, "node_modules"));
  for (const candidate of candidates) {
    for (const packageName of ["playwright", "playwright-core"]) {
      try {
        const resolved = require.resolve(packageName, { paths: [candidate] });
        const mod = require(resolved);
        const chromium = mod?.chromium || mod?.default?.chromium;
        if (chromium) {
          return chromium;
        }
      } catch (_error) {
        // Try next candidate or package.
      }
    }
  }
  throw new Error("Could not resolve playwright-core or playwright from bundled or local node_modules");
}

function buildRouteUrl(config, route, theme = "light") {
  const url = new URL("/ui/pucky/latest/index.html", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  url.searchParams.set("theme", String(theme || "light"));
  url.searchParams.set("route", String(route || "home"));
  url.searchParams.set("reset_nav", "1");
  if (String(config.refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(config.refreshKey || "").trim());
  }
  return url.toString();
}

function seriousConsoleErrors(messages) {
  const patterns = [
    /\b401\b/i,
    /forbidden/i,
    /cannot read/i,
    /ERR_HTTP2_PROTOCOL_ERROR/i,
    /is not a function/i,
    /referenceerror/i,
    /syntaxerror/i,
    /typeerror/i,
    /undefined/i,
    /unhandled/i,
  ];
  return messages.filter(message => patterns.some(pattern => pattern.test(String(message || ""))));
}

function sameOriginUrl(baseUrl, value) {
  try {
    const candidate = new URL(String(value || ""), String(baseUrl || ""));
    const expected = new URL(String(baseUrl || ""));
    return candidate.origin === expected.origin;
  } catch (_error) {
    return false;
  }
}

function seriousFailedRequests(failures, baseUrl) {
  return (Array.isArray(failures) ? failures : []).filter(entry => {
    if (!sameOriginUrl(baseUrl, entry?.url)) {
      return false;
    }
    const failure = String(entry?.failure || "");
    return !/err_aborted/i.test(failure);
  });
}

function seriousHttpErrorResponses(responses, baseUrl) {
  return (Array.isArray(responses) ? responses : []).filter(entry => sameOriginUrl(baseUrl, entry?.url));
}

function shouldRunRoute(config, route) {
  const requested = Array.isArray(config?.routes) ? config.routes : [];
  if (!requested.length) {
    return true;
  }
  return requested.includes(String(route || "").trim().toLowerCase());
}

async function waitForRoute(page, route, timeoutMs) {
  await page.waitForFunction(
    expectedRoute => document.querySelector(".light-shell")?.getAttribute("data-light-route") === expectedRoute,
    route,
    { timeout: timeoutMs }
  );
}

async function currentRoute(page) {
  return page.evaluate(() => document.querySelector(".light-shell")?.getAttribute("data-light-route") || "");
}

async function waitForTextInBody(page, text, timeoutMs) {
  await page.waitForFunction(
    expectedText => String(document.body?.textContent || "").includes(expectedText),
    text,
    { timeout: timeoutMs }
  );
}

async function waitForHomeReady(page, timeoutMs) {
  await waitForRoute(page, "home", timeoutMs);
  await page.waitForFunction(
    requiredRoutes => {
      const routes = Array.from(document.querySelectorAll(".light-app-tile[data-light-app-route]"))
        .map(node => String(node.getAttribute("data-light-app-route") || "").trim())
        .filter(Boolean);
      return requiredRoutes.every(route => routes.includes(route));
    },
    REQUIRED_HOME_ROUTES,
    { timeout: timeoutMs }
  );
}

async function waitForDetailOpen(page, timeoutMs) {
  await page.waitForFunction(() => {
    const detail = document.getElementById("detail");
    return Boolean(detail && detail.getAttribute("aria-hidden") === "false" && detail.classList.contains("is-open"));
  }, undefined, { timeout: timeoutMs });
}

async function waitForDetailClosed(page, timeoutMs) {
  await page.waitForFunction(() => {
    const detail = document.getElementById("detail");
    return Boolean(detail && detail.getAttribute("aria-hidden") === "true" && !detail.classList.contains("is-open"));
  }, undefined, { timeout: timeoutMs });
}

async function clickBack(page, timeoutMs) {
  const button = page.locator(".light-back-button").last();
  await button.waitFor({ state: "visible", timeout: timeoutMs });
  await button.click();
}

async function closeDetailPanel(page, timeoutMs) {
  await clickBack(page, timeoutMs);
  await waitForDetailClosed(page, timeoutMs);
}

async function goHome(page, config) {
  const homeUrl = buildRouteUrl(config, "home");
  logStep(config, `opening home route ${homeUrl}`);
  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForHomeReady(page, config.timeoutMs);
}

async function openRouteFromHome(page, route, timeoutMs) {
  const tile = page.locator(`.light-app-tile[data-light-app-route="${route}"]`).first();
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await tile.waitFor({ state: "visible", timeout: timeoutMs });
    await tile.click();
    try {
      await waitForRoute(page, route, timeoutMs);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= 2) {
        throw error;
      }
      await page.waitForTimeout(300);
    }
  }
  throw lastError || new Error(`Unable to open route ${route} from home`);
}

async function gotoAndWaitForRoute(page, url, route, timeoutMs) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    try {
      await waitForRoute(page, route, timeoutMs);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= 2) {
        throw error;
      }
      await page.waitForTimeout(300);
    }
  }
  throw lastError || new Error(`Unable to load route ${route}`);
}

async function readHomeTiles(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll(".light-app-tile[data-light-app-route]"))
      .map(node => String(node.getAttribute("data-light-app-route") || "").trim())
      .filter(Boolean);
  });
}

async function waitForInboxReady(page, timeoutMs) {
  await page.waitForFunction(() => {
    if (document.querySelector(".feed-load-error")) {
      return true;
    }
    if (document.querySelector("article[data-card-id] .card-body")) {
      return true;
    }
    return Array.from(document.querySelectorAll(".empty")).some(node => {
      const text = String(node.textContent || "").trim();
      return Boolean(text) && !/loading inbox/i.test(text);
    });
  }, undefined, { timeout: timeoutMs });
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
    if (document.querySelector(".meetings-empty.is-error")) {
      return true;
    }
    return Boolean(document.querySelector("article[data-card-session-id] .card-body"));
  }, undefined, { timeout: timeoutMs });
}

async function readInboxConnectedDetailState(page) {
  return page.evaluate(() => ({
    detailTitle: String(document.querySelector("#detail .light-page-title")?.textContent || "").replace(/\s+/g, " ").trim(),
    pageActionCount: document.querySelectorAll('.light-shell[data-light-route="inbox"] [data-card-action="page"], .light-shell[data-light-route="inbox"] [data-card-action="attachment"]').length,
    connectedChipLabels: Array.from(document.querySelectorAll("#detail .bubble-connected-record-row .light-record-chip"))
      .map(node => String(node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
    legacyArtifactLabels: Array.from(document.querySelectorAll("#detail .bubble-attachment-chip"))
      .map(node => String(node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(label => /meeting summary|meeting transcript html|transcript \(plain text\)|meeting transcript|^transcript$/i.test(label)),
  }));
}

async function readMeetingRuntimeDetailState(page) {
  return page.evaluate(() => {
    const detail = document.getElementById("detail");
    const connected = detail?.querySelector('.light-linked-records-section[data-linked-records-title="connected"]');
    const list = connected?.querySelector(".light-linked-record-list");
    const rows = Array.from(connected?.querySelectorAll(".light-linked-record-feed-row") || []);
    const detailRows = Array.from(detail?.querySelectorAll(".light-meeting-runtime-details-section .light-calendar-detail-row-label") || [])
      .map(node => String(node.textContent || "").trim())
      .filter(Boolean);
    return {
      title: String(detail?.querySelector(".light-page-title")?.textContent || "").replace(/\s+/g, " ").trim(),
      summary: String(detail?.querySelector(".light-meeting-runtime-summary")?.textContent || "").replace(/\s+/g, " ").trim(),
      detailRows,
      connectedSectionCount: connected ? 1 : 0,
      connectedIsFlat: Boolean(list?.classList.contains("is-flat-feed")),
      connectedRowCount: rows.length,
      connectedChevronCount: connected?.querySelectorAll(".light-chevron").length || 0,
      connectedChipCount: connected?.querySelectorAll(".light-graph-chip, .light-graph-chip-row").length || 0,
      connectedRoutes: rows.map(row => String(row.getAttribute("data-workspace-target-route") || "").trim()),
      connectedIds: rows.map(row => String(row.getAttribute("data-workspace-target-id") || "").trim()),
      connectedTitles: rows
        .map(row => String(row.querySelector(".light-text-stack strong")?.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
      noteRowCount: connected?.querySelectorAll('[data-workspace-target-route="note-detail"]').length || 0,
    };
  });
}

async function waitForNotesListReady(page, timeoutMs) {
  await page.waitForFunction(() => {
    return Boolean(document.querySelector(".light-note-row")) || Boolean(document.querySelector(".light-empty-state"));
  }, undefined, { timeout: timeoutMs });
}

async function waitForMeetingNotesListReady(page, timeoutMs) {
  await page.waitForFunction(() => {
    return Boolean(document.querySelector(".light-graph-row")) || Boolean(document.querySelector(".light-empty-state"));
  }, undefined, { timeout: timeoutMs });
}

async function waitForConnectReady(page, timeoutMs) {
  await page.waitForFunction(() => {
    return Boolean(
      document.querySelector(".links-app-row")
      || document.querySelector(".links-empty")
      || document.querySelector(".links-connected-chip")
    );
  }, undefined, { timeout: timeoutMs });
}

async function waitForConnectChips(page, expectedApps, timeoutMs) {
  const expectedSlugs = Array.isArray(expectedApps)
    ? expectedApps
        .map(app => String(app?.slug || "").trim().toLowerCase())
        .filter(Boolean)
        .sort()
    : [];
  if (!expectedSlugs.length) {
    return;
  }
  await page.waitForFunction(
    slugs => {
      const rendered = Array.from(document.querySelectorAll(".links-connected-chip"))
        .map(node => String(node.getAttribute("data-links-connected-slug") || "").trim().toLowerCase())
        .filter(Boolean)
        .sort();
      return JSON.stringify(rendered) === JSON.stringify(slugs);
    },
    expectedSlugs,
    { timeout: timeoutMs }
  );
}

async function readConnectState(page) {
  return page.evaluate(() => {
    const connectedApps = Array.from(document.querySelectorAll(".links-connected-chip"))
      .map(node => ({
        slug: String(node.getAttribute("data-links-connected-slug") || "").trim().toLowerCase(),
        name: String(node.textContent || "").replace(/\s+/g, " ").trim(),
      }))
      .filter(item => item.slug || item.name);
    return {
      rendered_row_count: document.querySelectorAll(".links-app-row").length,
      connected_count: connectedApps.length,
      connected_apps: connectedApps,
      empty_message: String(document.querySelector(".links-empty")?.textContent || "").trim(),
      connect_cta_clicked: false,
    };
  });
}

function assertConnectMatchesBackend(mode, connectState, backendConnect, baseUrl) {
  const backendApps = Array.isArray(backendConnect?.activeApps) ? backendConnect.activeApps : [];
  const uiApps = Array.isArray(connectState?.connected_apps) ? connectState.connected_apps : [];
  const backendSlugs = backendApps.map(app => String(app.slug || "").trim().toLowerCase()).sort();
  const uiSlugs = uiApps.map(app => String(app.slug || "").trim().toLowerCase()).sort();
  assert(
    JSON.stringify(uiSlugs) === JSON.stringify(backendSlugs),
    `${mode}: Connect chips ${JSON.stringify(uiSlugs)} did not match backend active apps ${JSON.stringify(backendSlugs)}`
  );
  backendApps.forEach(app => {
    const uiApp = uiApps.find(item => String(item.slug || "").trim().toLowerCase() === app.slug);
    assert(uiApp, `${mode}: Connect chip missing slug ${app.slug}`);
    assert(
      normalizeText(uiApp.name) === normalizeText(app.name),
      `${mode}: Connect chip label ${uiApp.name} did not match backend label ${app.name} for ${app.slug}`
    );
  });
  if (!isHostedDeployBaseUrl(baseUrl)) {
    return;
  }
  assert(backendApps.length > 0, `${mode}: hosted Connect backend returned no active connected apps`);
  LIVE_CONNECT_REQUIRED_SLUGS.forEach(slug => {
    assert(backendSlugs.includes(slug), `${mode}: hosted Connect backend missing expected live app ${slug}`);
    assert(uiSlugs.includes(slug), `${mode}: hosted Connect UI missing expected live app ${slug}`);
  });
}

async function waitForSeededNote(page, seed, timeoutMs) {
  await page.waitForFunction(
    expectedTitle => {
      return Array.from(document.querySelectorAll(".light-note-row"))
        .some(node => String(node.textContent || "").includes(expectedTitle));
    },
    String(seed.noteTitle || ""),
    { timeout: timeoutMs }
  );
}

async function waitForSeededTask(page, seed, timeoutMs) {
  const selector = `.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-main`;
  await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function waitForSeededMeetingNote(page, seed, timeoutMs) {
  await page.locator(`.light-graph-row[data-record-id="${seed.meetingNoteId}"]`).first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function waitForSeededReminder(page, seed, timeoutMs) {
  await page.locator(`.light-reminder-row[data-reminder-id="${seed.reminderId}"]`).first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function waitForTaskDetail(page, taskId, timeoutMs) {
  await page.waitForFunction(
    expectedTaskId => document.querySelector(".light-task-detail-surface")?.getAttribute("data-task-detail-id") === expectedTaskId,
    String(taskId || ""),
    { timeout: timeoutMs }
  );
}

async function waitForTaskRowStatus(page, taskId, status, timeoutMs) {
  await page.waitForFunction(
    ([expectedTaskId, expectedStatus]) => {
      return document.querySelector(`.light-task-row[data-task-id="${expectedTaskId}"]`)?.getAttribute("data-task-status") === expectedStatus;
    },
    [String(taskId || ""), String(status || "")],
    { timeout: timeoutMs }
  );
}

async function waitForTaskDetailStatus(page, status, timeoutMs) {
  await page.waitForFunction(
    expectedStatus => {
      const detail = document.querySelector(".light-task-detail-surface");
      const card = document.querySelector(".light-task-detail-card");
      return Boolean(
        detail
        && detail.getAttribute("data-task-status") === expectedStatus
        && card
        && card.getAttribute("data-task-status") === expectedStatus
      );
    },
    String(status || ""),
    { timeout: timeoutMs }
  );
}

async function readTaskRowFocusState(page, taskId) {
  return page.evaluate(expectedTaskId => {
    const row = document.querySelector(`.light-task-row[data-task-id="${expectedTaskId}"]`);
    const statusTrigger = row?.querySelector(".light-task-row-status-trigger");
    const mainButton = row?.querySelector(".light-task-row-main");
    const rowStyle = row ? getComputedStyle(row) : null;
    const statusStyle = statusTrigger ? getComputedStyle(statusTrigger) : null;
    const mainStyle = mainButton ? getComputedStyle(mainButton) : null;
    const active = document.activeElement;
    return {
      active_tag: String(active?.tagName || ""),
      active_class: active instanceof Element ? String(active.className || "") : "",
      task_row_outline_style: String(rowStyle?.outlineStyle || ""),
      task_row_outline_width: String(rowStyle?.outlineWidth || ""),
      task_row_outline_offset: String(rowStyle?.outlineOffset || ""),
      task_row_box_shadow: String(rowStyle?.boxShadow || ""),
      row_status_outline_style: String(statusStyle?.outlineStyle || ""),
      row_status_outline_width: String(statusStyle?.outlineWidth || ""),
      row_status_box_shadow: String(statusStyle?.boxShadow || ""),
      row_main_outline_style: String(mainStyle?.outlineStyle || ""),
      row_main_outline_width: String(mainStyle?.outlineWidth || ""),
      row_main_box_shadow: String(mainStyle?.boxShadow || ""),
    };
  }, String(taskId || ""));
}

async function readTaskDetailFocusState(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".light-task-detail-card");
    const style = card ? getComputedStyle(card) : null;
    const active = document.activeElement;
    return {
      active_tag: String(active?.tagName || ""),
      active_class: active instanceof Element ? String(active.className || "") : "",
      task_detail_outline_style: String(style?.outlineStyle || ""),
      task_detail_outline_width: String(style?.outlineWidth || ""),
      task_detail_outline_offset: String(style?.outlineOffset || ""),
      task_detail_box_shadow: String(style?.boxShadow || ""),
    };
  });
}

async function readTaskListSelectionState(page) {
  return page.evaluate(() => {
    const toggles = Array.from(document.querySelectorAll(".light-task-section-toggle"));
    const selected_rows = Array.from(document.querySelectorAll('.light-task-row[data-task-selected="true"]'))
      .map(node => String(node.getAttribute("data-task-id") || "").trim())
      .filter(Boolean);
    const bulk_bar = document.querySelector(".light-task-bulk-bar");
    const legacy_filter_class = ["light", "task", "filter", "button"].join("-");
    return {
      page_title: String(document.querySelector(".light-page-title")?.textContent || "").trim(),
      headers: toggles.map(toggle => String(toggle.querySelector(".light-task-section-title")?.textContent || "").trim()).filter(Boolean),
      has_filter_pill: Array.from(document.querySelectorAll("button")).some(node => node.classList.contains(legacy_filter_class)),
      select_mode_active: String(document.querySelector(".light-page-title")?.textContent || "").trim() === "Select tasks",
      selected_rows,
      bulk_bar_present: Boolean(bulk_bar),
      bulk_count_label: String(bulk_bar?.querySelector(".light-task-bulk-count")?.textContent || "").trim(),
    };
  });
}

function assertNoVisibleTaskFocusRing(state, context) {
  const rowHidden = !("task_row_outline_style" in state)
    || String(state.task_row_outline_style || "").toLowerCase() === "none"
    || String(state.task_row_outline_width || "") === "0px";
  const statusHidden = !("row_status_outline_style" in state)
    || String(state.row_status_outline_style || "").toLowerCase() === "none"
    || String(state.row_status_outline_width || "") === "0px";
  const mainHidden = !("row_main_outline_style" in state)
    || String(state.row_main_outline_style || "").toLowerCase() === "none"
    || String(state.row_main_outline_width || "") === "0px";
  const detailHidden = !("task_detail_outline_style" in state)
    || String(state.task_detail_outline_style || "").toLowerCase() === "none"
    || String(state.task_detail_outline_width || "") === "0px";
  assert(rowHidden, `${context}: task row focus ring is still visible`);
  assert(statusHidden, `${context}: task status icon focus ring is still visible`);
  assert(mainHidden, `${context}: task row main-button focus ring is still visible`);
  assert(detailHidden, `${context}: task detail header focus ring is still visible`);
}

async function ensureTaskSectionExpanded(page, group) {
  const toggle = page.locator(`button.light-task-section-toggle[data-task-section="${group}"]`).first();
  if (!(await toggle.count())) {
    return;
  }
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
}

async function taskRowVisible(page, taskId) {
  return page.locator(`.light-task-row[data-task-id="${taskId}"]`).first().isVisible().catch(() => false);
}

async function revealTaskRow(page, taskId) {
  if (await taskRowVisible(page, taskId)) {
    return;
  }
  for (const group of ["overdue", "do", "soon", "done"]) {
    await ensureTaskSectionExpanded(page, group);
    if (await taskRowVisible(page, taskId)) {
      return;
    }
  }
}

async function waitForTaskAbsent(page, taskId, timeoutMs) {
  await page.waitForFunction(expectedTaskId => {
    return !document.querySelector(`.light-task-row[data-task-id="${expectedTaskId}"]`);
  }, String(taskId || ""), { timeout: timeoutMs });
}

async function taskGroupForRow(page, taskId) {
  return page.evaluate(expectedTaskId => {
    const toggles = Array.from(document.querySelectorAll("button.light-task-section-toggle"));
    for (const toggle of toggles) {
      const card = toggle.nextElementSibling;
      if (card && card.matches(".light-task-group") && card.querySelector(`.light-task-row[data-task-id="${expectedTaskId}"]`)) {
        return String(toggle.getAttribute("data-task-section") || "");
      }
    }
    return "";
  }, String(taskId || ""));
}

async function goToTasksList(page, mode, timeoutMs) {
  let route = await currentRoute(page);
  let attempts = 0;
  while (route !== "tasks" && attempts < 3) {
    await clickBack(page, timeoutMs);
    attempts += 1;
    await page.waitForTimeout(150);
    route = await currentRoute(page);
  }
  if (mode === "mobile") {
    await waitForRoute(page, "tasks", timeoutMs);
  }
}

async function waitForSeededProject(page, seed, timeoutMs) {
  await page.locator(`.light-project-row[data-project-id="${seed.projectId}"]`).first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function waitForSeededContact(page, seed, timeoutMs) {
  await page.locator(`.light-contact-row[data-contact-id="${seed.contactId}"]`).first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function readContactsListFlatness(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".light-shell");
    const list = document.querySelector(".light-contact-list");
    const rows = Array.from(document.querySelectorAll(".light-contact-row"));
    const firstRow = rows[0] || null;
    const secondRow = rows[1] || null;
    const listStyle = list ? getComputedStyle(list) : null;
    const firstRowStyle = firstRow ? getComputedStyle(firstRow) : null;
    const secondRowStyle = secondRow ? getComputedStyle(secondRow) : null;
    return {
      route: shell?.getAttribute("data-light-route") || "",
      row_count: rows.length,
      first_contact_id: firstRow?.getAttribute("data-contact-id") || "",
      list_gap: listStyle?.gap || "",
      list_padding_left: listStyle?.paddingLeft || "",
      list_padding_right: listStyle?.paddingRight || "",
      row_class_list: firstRow ? Array.from(firstRow.classList) : [],
      row_background: firstRowStyle?.backgroundColor || "",
      row_box_shadow: firstRowStyle?.boxShadow || "",
      row_border_top_left_radius: firstRowStyle?.borderTopLeftRadius || "",
      row_border_top_right_radius: firstRowStyle?.borderTopRightRadius || "",
      row_padding_left: firstRowStyle?.paddingLeft || "",
      row_padding_right: firstRowStyle?.paddingRight || "",
      divider_width: secondRowStyle?.borderTopWidth || "",
      divider_color: secondRowStyle?.borderTopColor || "",
    };
  });
}

async function readContactsSearchState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".light-shell");
    const search = document.querySelector(".light-contacts-search");
    const rows = Array.from(document.querySelectorAll(".light-contact-row"));
    const empty = document.querySelector(".light-empty-state");
    const rowData = rows.map(node => ({
      id: String(node.getAttribute("data-contact-id") || "").trim(),
      title: String(node.querySelector(".light-text-stack strong")?.textContent || "").trim(),
      detail: String(node.querySelector(".light-text-stack span")?.textContent || "").trim(),
      avatarText: String(node.querySelector(".light-avatar")?.textContent || "").trim(),
    }));
    return {
      route: shell?.getAttribute("data-light-route") || "",
      search_visible: Boolean(search),
      query: search instanceof HTMLInputElement ? search.value : "",
      row_ids: rowData.map(row => row.id).filter(Boolean),
      row_titles: rowData.map(row => row.title).filter(Boolean),
      row_details: Object.fromEntries(rowData.filter(row => row.id).map(row => [row.id, row.detail])),
      row_avatar_texts: Object.fromEntries(rowData.filter(row => row.id).map(row => [row.id, row.avatarText])),
      empty_text: String(empty?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });
}

async function installContactsSearchTrace(page) {
  await page.evaluate(() => {
    if (!window.__contactsSearchTraceStore) {
      const store = {
        currentNode: null,
        currentToken: 0,
        events: [],
        initialToken: 0,
        initialValue: "",
      };
      const bindSearchNode = () => {
        const next = document.getElementById("contactsSearch");
        if (next !== store.currentNode) {
          store.currentNode = next instanceof HTMLInputElement ? next : null;
          store.currentToken += 1;
          if (store.currentNode) {
            store.currentNode.dataset.traceToken = String(store.currentToken);
          }
          return true;
        }
        return false;
      };
      const readValue = () => store.currentNode instanceof HTMLInputElement ? store.currentNode.value : "";
      const record = (type, event = null) => {
        const target = event?.target instanceof HTMLElement ? event.target : null;
        const shouldRecord = !target || target.id === "contactsSearch" || target === store.currentNode;
        if (!shouldRecord) {
          return;
        }
        store.events.push({
          type,
          nodeToken: store.currentToken,
          activeId: document.activeElement?.id || "",
          targetId: target?.id || "",
          value: readValue(),
          key: event?.key || "",
          data: event?.data || "",
          inputType: event?.inputType || "",
        });
      };
      bindSearchNode();
      ["focusin", "focusout", "blur", "beforeinput", "input", "keydown", "keyup"].forEach(type => {
        document.addEventListener(type, event => {
          if (bindSearchNode()) {
            record("search-node-changed", null);
          }
          record(type, event);
        }, true);
      });
      new MutationObserver(() => {
        if (bindSearchNode()) {
          record("search-node-changed", null);
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
      window.__contactsSearchTraceStore = store;
    }
    const store = window.__contactsSearchTraceStore;
    const current = document.getElementById("contactsSearch");
    store.currentNode = current instanceof HTMLInputElement ? current : null;
    if (store.currentNode && !store.currentToken) {
      store.currentToken = 1;
      store.currentNode.dataset.traceToken = String(store.currentToken);
    }
    store.events = [];
    store.initialToken = store.currentToken;
    store.initialValue = store.currentNode instanceof HTMLInputElement ? store.currentNode.value : "";
  });
}

async function traceContactsSearchTyping(page, query, timeoutMs) {
  await setContactsSearchQuery(page, "", timeoutMs);
  const search = page.locator(".light-contacts-search").first();
  await search.click();
  await installContactsSearchTrace(page);
  await search.type(query, { delay: 40 });
  await page.waitForFunction(expectedQuery => {
    const input = document.querySelector(".light-contacts-search");
    return input instanceof HTMLInputElement && input.value === expectedQuery;
  }, query, { timeout: timeoutMs });
  const trace = await page.evaluate(() => {
    const store = window.__contactsSearchTraceStore || {};
    const current = document.getElementById("contactsSearch");
    return {
      initialToken: Number(store.initialToken || 0),
      initialValue: String(store.initialValue || ""),
      finalToken: Number(store.currentToken || 0),
      finalValue: current instanceof HTMLInputElement ? current.value : "",
      events: Array.isArray(store.events) ? store.events.slice() : [],
    };
  });
  const eventCounts = trace.events.reduce((counts, event) => {
    const key = String(event?.type || "");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  return {
    ...trace,
    eventCounts,
    searchState: await readContactsSearchState(page),
  };
}

async function readContactEditState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".light-shell");
    const pageRoot = document.querySelector(".light-contact-detail-page");
    const identity = pageRoot?.querySelector(".light-contact-detail-identity");
    const titleNode = pageRoot?.querySelector(".light-contact-detail-title");
    const identityStyle = identity ? getComputedStyle(identity) : null;
    const titleStyle = titleNode ? getComputedStyle(titleNode) : null;
    const isVisible = node => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      if (node.hidden || node.closest("[hidden]")) {
        return false;
      }
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      return node.getClientRects().length > 0;
    };
    const fieldValue = key => {
      const input = document.querySelector(`[data-contact-edit-field="${key}"]`);
      return input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value : "";
    };
    const status = document.querySelector("[data-contact-autosave-status]");
    const firstNameInput = document.querySelector('[data-contact-edit-field="first_name"]');
    const lastNameInput = document.querySelector('[data-contact-edit-field="last_name"]');
    const actionButton = document.querySelector("[data-contact-detail-action]");
    const summaryView = document.querySelector(".light-contact-detail-summary");
    const infoSections = Array.from(pageRoot?.querySelectorAll(".light-info-section") || []);
    const sectionTitle = section => String(section?.querySelector(".light-section-title")?.textContent || "").trim().toLowerCase();
    const connectedSection = infoSections.find(section => sectionTitle(section) === "connected") || null;
    const activitySection = infoSections.find(section => sectionTitle(section) === "activity") || null;
    const connectedInfoRows = Array.from(connectedSection?.querySelectorAll(".light-info-row") || []);
    const connectedLinkedRecordFeedRows = Array.from(connectedSection?.querySelectorAll(".light-linked-record-feed-row") || []);
    const identityRect = identity instanceof HTMLElement
      ? (() => {
          const rect = identity.getBoundingClientRect();
          return {
            top: Number(rect.top || 0),
            left: Number(rect.left || 0),
            width: Number(rect.width || 0),
            height: Number(rect.height || 0),
          };
        })()
      : null;
    const backgroundColor = String(identityStyle?.backgroundColor || "").trim().toLowerCase();
    const hasTransparentBackground = !backgroundColor || backgroundColor === "rgba(0, 0, 0, 0)" || backgroundColor === "transparent";
    const borderWidth = [
      Number.parseFloat(identityStyle?.borderTopWidth || "0"),
      Number.parseFloat(identityStyle?.borderRightWidth || "0"),
      Number.parseFloat(identityStyle?.borderBottomWidth || "0"),
      Number.parseFloat(identityStyle?.borderLeftWidth || "0"),
    ].some(value => Number.isFinite(value) && value > 0);
    const borderRadius = Number.parseFloat(identityStyle?.borderRadius || "0");
    return {
      route: shell?.getAttribute("data-light-route") || "",
      pageVisible: Boolean(pageRoot),
      mode: String(pageRoot?.getAttribute("data-contact-detail-mode") || "").trim() || "view",
      title: String(pageRoot?.querySelector(".light-contact-detail-title")?.textContent || "").trim(),
      titleFontSizePx: Number.parseFloat(titleStyle?.fontSize || "0") || 0,
      summaryViewText: String(summaryView?.textContent || "").replace(/\s+/g, " ").trim(),
      avatarText: String(pageRoot?.querySelector(".light-contact-detail-avatar-mount .light-avatar")?.textContent || "").trim(),
      firstName: fieldValue("first_name"),
      lastName: fieldValue("last_name"),
      summary: fieldValue("summary"),
      email: fieldValue("email"),
      phone: fieldValue("phone"),
      firstNameVisible: isVisible(firstNameInput),
      lastNameVisible: isVisible(lastNameInput),
      summaryVisible: isVisible(summaryView),
      hasConnectedSection: Boolean(connectedSection),
      hasActivitySection: Boolean(activitySection),
      sectionTitles: infoSections.map(section => String(section.querySelector(".light-section-title")?.textContent || "").trim()).filter(Boolean),
      connectedInfoRowCount: connectedInfoRows.length,
      connectedLinkedRecordFeedRowCount: connectedLinkedRecordFeedRows.length,
      connectedRowTexts: connectedInfoRows
        .map(row => String(row.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean),
      hasPhotoPreview: Boolean(pageRoot?.querySelector(".light-avatar.has-photo img")),
      hasHeroContainer: Boolean(pageRoot?.querySelector(".light-contact-detail-hero")),
      hasIdentityHeader: Boolean(identity),
      identityHasCardChrome: Boolean(identityStyle && (!hasTransparentBackground || identityStyle.boxShadow !== "none" || borderWidth || (Number.isFinite(borderRadius) && borderRadius > 0))),
      identityRect,
      action: String(actionButton?.getAttribute("data-contact-detail-action") || "").trim(),
      autosaveStatus: String(status?.getAttribute("data-contact-autosave-status") || "").trim(),
      autosaveLabel: String(status?.textContent || "").trim(),
    };
  });
}

async function waitForContactConnectedRows(page, labels, timeoutMs) {
  await page.waitForFunction(expectedLabels => {
    const pageRoot = document.querySelector(".light-contact-detail-page");
    const infoSections = Array.from(pageRoot?.querySelectorAll(".light-info-section") || []);
    const connectedSection = infoSections.find(section => String(section.querySelector(".light-section-title")?.textContent || "").trim().toLowerCase() === "connected");
    if (!connectedSection) {
      return false;
    }
    const infoRows = Array.from(connectedSection.querySelectorAll(".light-info-row"));
    const linkedFeedRows = connectedSection.querySelectorAll(".light-linked-record-feed-row").length;
    const rowTexts = infoRows
      .map(row => String(row.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return linkedFeedRows === 0 && expectedLabels.every(label => rowTexts.some(text => text.includes(label)));
  }, labels, { timeout: timeoutMs });
  return readContactEditState(page);
}

async function saveContactDetailIdentityScreenshot(page, reportDir, name, timeoutMs) {
  const target = path.join(reportDir, `${name}.png`);
  const identity = page.locator(".light-contact-detail-identity").first();
  await identity.waitFor({ state: "visible", timeout: timeoutMs });
  await identity.screenshot({
    path: target,
    animations: "disabled",
    timeout: timeoutMs,
  });
  return target;
}

async function setContactsSearchQuery(page, query, timeoutMs) {
  const search = page.locator(".light-contacts-search").first();
  await search.waitFor({ state: "visible", timeout: timeoutMs });
  await search.fill(query);
  await page.waitForFunction(expectedQuery => {
    const input = document.querySelector(".light-contacts-search");
    return input instanceof HTMLInputElement && input.value === expectedQuery;
  }, query, { timeout: timeoutMs });
}

async function expectContactsSearchRows(page, query, expectedIds, timeoutMs) {
  await setContactsSearchQuery(page, query, timeoutMs);
  await page.waitForFunction(({ expectedQuery, ids }) => {
    const input = document.querySelector(".light-contacts-search");
    const rowIds = Array.from(document.querySelectorAll(".light-contact-row"))
      .map(node => String(node.getAttribute("data-contact-id") || "").trim())
      .filter(Boolean);
    return input instanceof HTMLInputElement
      && input.value === expectedQuery
      && JSON.stringify(rowIds) === JSON.stringify(ids);
  }, { expectedQuery: query, ids: expectedIds }, { timeout: timeoutMs });
  return readContactsSearchState(page);
}

async function expectContactsSearchRowsContaining(page, query, requiredIds, timeoutMs) {
  await setContactsSearchQuery(page, query, timeoutMs);
  await page.waitForFunction(({ expectedQuery, ids }) => {
    const input = document.querySelector(".light-contacts-search");
    const rowIds = Array.from(document.querySelectorAll(".light-contact-row"))
      .map(node => String(node.getAttribute("data-contact-id") || "").trim())
      .filter(Boolean);
    return input instanceof HTMLInputElement
      && input.value === expectedQuery
      && ids.every(id => rowIds.includes(id));
  }, { expectedQuery: query, ids: requiredIds }, { timeout: timeoutMs });
  return readContactsSearchState(page);
}

async function fillContactEditField(page, fieldName, value, timeoutMs) {
  const input = page.locator(`[data-contact-edit-field="${fieldName}"]`).first();
  await input.waitFor({ state: "visible", timeout: timeoutMs });
  await input.fill(value);
}

async function waitForContactRecord(baseUrl, apiToken, contactId, predicate, timeoutMs, failureMessage) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 0) || 0);
  let lastRecord = null;
  while (Date.now() <= deadline) {
    lastRecord = await authorizedJsonRequest(baseUrl, apiToken, `/api/workspace/contacts/${encodeURIComponent(String(contactId || "").trim())}`);
    if (predicate(lastRecord)) {
      return lastRecord;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${failureMessage} (last contact record: ${JSON.stringify(lastRecord)})`);
}

async function waitForContactAutosaveSaved(page, timeoutMs) {
  await page.waitForFunction(() => {
    const status = document.querySelector("[data-contact-autosave-status]");
    return status instanceof HTMLElement && status.getAttribute("data-contact-autosave-status") === "saved";
  }, undefined, { timeout: timeoutMs });
}

async function installContactEditTrace(page, fieldName) {
  await page.evaluate(fieldKey => {
    if (!window.__contactEditTraceStore) {
      window.__contactEditTraceStore = {};
    }
    const store = {
      currentNode: null,
      currentToken: 0,
      events: [],
      initialToken: 0,
      initialValue: "",
    };
    const selector = `[data-contact-edit-field="${String(fieldKey || "")}"]`;
    const bindFieldNode = () => {
      const next = document.querySelector(selector);
      if (next !== store.currentNode) {
        store.currentNode = next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement ? next : null;
        store.currentToken += 1;
        if (store.currentNode instanceof HTMLElement) {
          store.currentNode.dataset.traceToken = String(store.currentToken);
        }
        return true;
      }
      return false;
    };
    const readValue = () => store.currentNode instanceof HTMLInputElement || store.currentNode instanceof HTMLTextAreaElement
      ? store.currentNode.value
      : "";
    const record = (type, event = null) => {
      const target = event?.target instanceof HTMLElement ? event.target : null;
      const shouldRecord = !target || target.matches(selector) || target === store.currentNode;
      if (!shouldRecord) {
        return;
      }
      store.events.push({
        type,
        nodeToken: store.currentToken,
        activeName: document.activeElement?.getAttribute?.("data-contact-edit-field") || "",
        value: readValue(),
        key: event?.key || "",
        data: event?.data || "",
        inputType: event?.inputType || "",
      });
    };
    bindFieldNode();
    ["focusin", "focusout", "blur", "beforeinput", "input", "keydown", "keyup"].forEach(type => {
      document.addEventListener(type, event => {
        if (bindFieldNode()) {
          record("contact-edit-node-changed", null);
        }
        record(type, event);
      }, true);
    });
    new MutationObserver(() => {
      if (bindFieldNode()) {
        record("contact-edit-node-changed", null);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    window.__contactEditTraceStore[fieldKey] = store;
    if (store.currentNode && !store.currentToken) {
      store.currentToken = 1;
      store.currentNode.dataset.traceToken = String(store.currentToken);
    }
    store.events = [];
    store.initialToken = store.currentToken;
    store.initialValue = readValue();
  }, fieldName);
}

async function traceContactEditTyping(page, fieldName, value, timeoutMs) {
  const input = page.locator(`[data-contact-edit-field="${fieldName}"]`).first();
  await input.waitFor({ state: "visible", timeout: timeoutMs });
  await input.click();
  await input.fill("");
  await installContactEditTrace(page, fieldName);
  await input.type(value, { delay: 40 });
  await page.waitForFunction(({ fieldKey, expectedValue }) => {
    const field = document.querySelector(`[data-contact-edit-field="${fieldKey}"]`);
    return (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.value === expectedValue;
  }, { fieldKey: fieldName, expectedValue: value }, { timeout: timeoutMs });
  const trace = await page.evaluate(fieldKey => {
    const store = (window.__contactEditTraceStore || {})[fieldKey] || {};
    const current = document.querySelector(`[data-contact-edit-field="${fieldKey}"]`);
    return {
      initialToken: Number(store.initialToken || 0),
      initialValue: String(store.initialValue || ""),
      finalToken: Number(store.currentToken || 0),
      finalValue: current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement ? current.value : "",
      events: Array.isArray(store.events) ? store.events.slice() : [],
    };
  }, fieldName);
  const eventCounts = trace.events.reduce((counts, event) => {
    const key = String(event?.type || "");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  return {
    ...trace,
    eventCounts,
    editState: await readContactEditState(page),
  };
}

function buildContactsEditProofValues(mode) {
  const modeKey = String(mode || "proof").trim().toLowerCase() || "proof";
  const modeLabel = modeKey === "desktop" ? "Desktop" : modeKey === "iphone" ? "iPhone" : modeKey === "android" ? "Android" : "Proof";
  const phoneSuffix = modeKey === "desktop" ? "0179" : modeKey === "iphone" ? "0199" : modeKey === "android" ? "0209" : "0189";
  return {
    updatedTitle: "Updated Live Contact",
    updatedSummary: `Updated from ${modeKey} live proof edit flow`,
    updatedEmail: "updated.live.contact@example.com",
    updatedPhone: `+1 (415) 555-${phoneSuffix}`,
    modeLabel,
  };
}

async function waitForSeededCalendarEvent(page, seed, timeoutMs) {
  const selector = `.light-event-block[data-event-id="${seed.calendarEventId}"] .light-event-main`;
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: "visible", timeout: Math.min(5000, timeoutMs) });
  } catch (_error) {
    const eventDate = new Date(seed.primaryDueAtMs).toISOString().slice(0, 10);
    const input = page.locator("input.light-date-input[type=\"date\"]").first();
    await input.waitFor({ state: "visible", timeout: timeoutMs });
    await input.fill(eventDate);
    await input.dispatchEvent("change");
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
  }
}

async function readTaskDetailState(page) {
  return page.evaluate(() => {
    const detail = document.querySelector(".light-task-detail-surface");
    const infoSections = Array.from(detail?.querySelectorAll(".light-info-section") || []);
    const infoSection = title => infoSections.find(section =>
      String(section.querySelector(".light-section-title")?.textContent || "").trim().toLowerCase() === title
    ) || null;
    const connectedSection = infoSection("connected");
    const contentSections = Array.from(detail?.children || [])
      .filter(node => node instanceof HTMLElement && node.matches(".light-copy-section, .light-info-section"));
    const contentSectionTitles = contentSections
      .map(node => String(node.querySelector(".light-section-title")?.textContent || "").trim().toLowerCase())
      .filter(Boolean);
    const firstSectionTitle = String(contentSectionTitles[0] || "");
    const checklistImmediatelyAfterDescription = contentSectionTitles[0] === "description" && contentSectionTitles[1] === "checklist";
    const statusCard = document.querySelector(".light-task-detail-card");
    return {
      route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
      task_detail_id: detail?.getAttribute("data-task-detail-id") || "",
      task_status: detail?.getAttribute("data-task-status") || "",
      status_label: String(statusCard?.getAttribute("data-task-status-label") || "").trim(),
      title: String(detail?.querySelector(".light-task-detail-title")?.textContent || "").trim(),
      header_created_meta: String(detail?.querySelector(".light-task-detail-created")?.textContent || "").trim(),
      sections: Array.from(detail?.querySelectorAll(".light-section-title") || [])
        .map(node => String(node.textContent || "").trim().toLowerCase()),
      content_section_titles: contentSectionTitles,
      checklist: Array.from(detail?.querySelectorAll(".light-task-checklist-label") || [])
        .map(node => String(node.textContent || "").trim()),
      connected: Array.from(connectedSection?.querySelectorAll('.light-info-row[data-task-connected-kind]') || [])
        .map(node => ({
          kind: String(node.getAttribute("data-task-connected-kind") || ""),
          label: String(node.querySelector(".light-text-stack strong")?.textContent || "").trim(),
        })),
      description: String(Array.from(document.querySelectorAll(".light-copy-section"))
        .find(node => /description/i.test(String(node.textContent || "")))?.textContent || "").trim(),
      description_is_first_section: firstSectionTitle === "description",
      checklist_immediately_after_description: checklistImmediatelyAfterDescription,
      task_detail_chevron_count: Array.from(detail?.querySelectorAll(".light-info-row .light-chevron") || []).length,
      status_card_present: Boolean(statusCard),
      status_circle_present: Boolean(document.querySelector(".light-task-status-circle")),
      task_html_frame_present: Boolean(detail?.querySelector(".light-html-frame, iframe")),
    };
  });
}

function expectedTaskReturnRoute(mode) {
  return mode === "mobile" ? "task-detail" : "tasks";
}

function createModeRecorder(mode, config, page) {
  const steps = [];
  const screenshots = {};
  let counter = 0;
  return {
    steps,
    screenshots,
    async capture({ route, action, expected, confirmation, observed }) {
      counter += 1;
      const name = `${mode}-${String(counter).padStart(2, "0")}-${slug(`${route}-${action}`)}`;
      const screenshot = await saveScreenshot(page, config.reportDir, name);
      const step = {
        step_id: name,
        route,
        action,
        expected,
        confirmation,
        observed,
        screenshot,
        ok: true,
      };
      steps.push(step);
      screenshots[name] = screenshot;
      return step;
    },
  };
}

async function runRouteTour(page, config, mode, seed, runtimeMeeting = null) {
  const recorder = createModeRecorder(mode, config, page);
  await goHome(page, config);
  const homeTiles = await readHomeTiles(page);
  REQUIRED_HOME_ROUTES.forEach(route => assert(homeTiles.includes(route), `${mode}: launcher tile missing ${route}`));
  await recorder.capture({
    route: "home",
    action: "Open launcher",
      expected: "Launcher tiles for inbox, meetings, meeting notes, reminders, connect, settings, notes, tasks, calendar, projects, and contacts are visible.",
    confirmation: "Required launcher tiles are present.",
    observed: { tiles: homeTiles },
  });

  if (shouldRunRoute(config, "inbox")) {
    await goHome(page, config);
    await openRouteFromHome(page, "inbox", config.timeoutMs);
    await waitForInboxReady(page, config.timeoutMs);
    const feedError = await page.locator(".feed-load-error").count();
    assert(feedError === 0, `${mode}: inbox route reported a feed load error`);
    const inboxCards = page.locator("article[data-card-id] .card-body");
    const runtimeMeetingId = String(runtimeMeeting?.meetingId || "").trim();
    if (runtimeMeetingId) {
      await page.waitForFunction(
        expectedId => Boolean(document.querySelector(`article[data-card-session-id="${expectedId}"] .card-body`)),
        runtimeMeetingId,
        { timeout: config.timeoutMs }
      );
    }
    if (await inboxCards.count()) {
      const targetCard = runtimeMeetingId
        ? page.locator(`article[data-card-session-id="${runtimeMeetingId}"]`).first()
        : page.locator("article[data-card-id]").first();
      const targetTitle = normalizeText(await targetCard.locator(".title").first().textContent().catch(() => runtimeMeetingId));
      const targetCardKind = String(await targetCard.getAttribute("data-card-kind").catch(() => ""));
      const targetBody = targetCard.locator(".card-body").first();
      await targetBody.click();
      await waitForDetailOpen(page, config.timeoutMs);
      const detailTitle = normalizeText(await page.locator("#detail .light-page-title").last().textContent().catch(() => ""));
      await recorder.capture({
        route: "inbox",
        action: runtimeMeetingId ? "Open runtime meeting card from Inbox" : "Open first inbox card",
        expected: runtimeMeetingId
          ? "The runtime-generated meeting card appears in Inbox and opens its detail panel."
          : "The first inbox card opens its detail panel.",
        confirmation: runtimeMeetingId ? "Runtime meeting card was visible in Inbox and opened its detail panel." : "Inbox detail panel opened.",
        observed: { empty: false, inbox_card_title: targetTitle, inbox_card_kind: targetCardKind, detail_title: detailTitle, meeting_id: runtimeMeetingId },
      });
      await closeDetailPanel(page, config.timeoutMs);
    } else {
      const emptyText = normalizeText(await page.locator(".empty").first().textContent().catch(() => "No inbox items yet."));
      assert(!runtimeMeetingId, `${mode}: Inbox stayed empty instead of showing runtime meeting ${runtimeMeetingId}`);
      await recorder.capture({
        route: "inbox",
        action: "Check empty inbox state",
        expected: "An empty inbox is reported honestly when no live cards are available.",
        confirmation: "Inbox empty state was shown.",
        observed: { empty: true, message: emptyText },
      });
    }
  }

  if (shouldRunRoute(config, "connect")) {
    await goHome(page, config);
    await openRouteFromHome(page, "connect", config.timeoutMs);
    const backendConnect = await fetchConnectMyApps(config.baseUrl, config.refreshKey);
    await waitForConnectReady(page, config.timeoutMs);
    await waitForConnectChips(page, backendConnect.activeApps, config.timeoutMs);
    const connectState = await readConnectState(page);
    assertConnectMatchesBackend(mode, connectState, backendConnect, config.baseUrl);
    await recorder.capture({
      route: "connect",
      action: "Inspect connect connected apps",
      expected: "Connect stays read-only, no auth CTA is pressed, and the top connected-apps strip matches the live backend account state.",
      confirmation: "Connect rendered the expected connected apps without clicking any integration CTA.",
      observed: {
        ...connectState,
        backend_user_id: String(backendConnect.payload?.user_id || ""),
        backend_active_apps: backendConnect.activeApps,
        my_apps_url: backendConnect.myAppsUrl,
      },
    });

    await goHome(page, config);
    await openRouteFromHome(page, "connect", config.timeoutMs);
    await waitForConnectReady(page, config.timeoutMs);
    await waitForConnectChips(page, backendConnect.activeApps, config.timeoutMs);
    const connectRevisitState = await readConnectState(page);
    assertConnectMatchesBackend(mode, connectRevisitState, backendConnect, config.baseUrl);
    await recorder.capture({
      route: "connect",
      action: "Reopen connect from home",
      expected: "Leaving Connect and coming back from Home repopulates the same connected-app strip.",
      confirmation: "Connect repopulated the connected-app strip after re-entry.",
      observed: connectRevisitState,
    });

    const reloadUrl = buildRouteUrl(config, "connect");
    logStep(config, `${mode}: reloading connect route ${reloadUrl}`);
    await gotoAndWaitForRoute(page, reloadUrl, "connect", config.timeoutMs);
    await waitForConnectReady(page, config.timeoutMs);
    await waitForConnectChips(page, backendConnect.activeApps, config.timeoutMs);
    const connectReloadState = await readConnectState(page);
    assertConnectMatchesBackend(mode, connectReloadState, backendConnect, config.baseUrl);
    await recorder.capture({
      route: "connect",
      action: "Reload connect directly",
      expected: "A full reload back into Connect repopulates the same connected-app strip without any unlock step.",
      confirmation: "Connect repopulated the connected-app strip after full reload.",
      observed: connectReloadState,
    });
  }

  if (shouldRunRoute(config, "meetings")) {
    await goHome(page, config);
    await openRouteFromHome(page, "meetings", config.timeoutMs);
    await waitForMeetingsReady(page, config.timeoutMs);
    const meetingsError = await page.locator(".meetings-empty.is-error").count();
    assert(meetingsError === 0, `${mode}: meetings route reported an error`);
    const meetingCards = page.locator("article[data-card-session-id] .card-body");
    const runtimeMeetingId = String(runtimeMeeting?.meetingId || "").trim();
    if (runtimeMeetingId) {
      await page.waitForFunction(
        expectedId => Boolean(document.querySelector(`article[data-card-session-id="${expectedId}"] .card-body`)),
        runtimeMeetingId,
        { timeout: config.timeoutMs }
      );
    }
    if (await meetingCards.count()) {
      const targetCard = runtimeMeetingId
        ? page.locator(`article[data-card-session-id="${runtimeMeetingId}"]`).first()
        : page.locator("article[data-card-session-id]").first();
      const targetTitle = normalizeText(await targetCard.locator(".title").first().textContent().catch(() => runtimeMeetingId));
      const targetCardKind = String(await targetCard.getAttribute("data-card-kind").catch(() => ""));
      const targetBody = targetCard.locator(".card-body").first();
      await targetBody.click();
      await waitForDetailOpen(page, config.timeoutMs);
      const detailTitle = normalizeText(await page.locator("#detail .light-page-title").last().textContent().catch(() => ""));
      const detailText = normalizeText(await page.locator("#detail").textContent().catch(() => ""));
      await recorder.capture({
        route: "meetings",
        action: runtimeMeetingId ? "Open runtime meeting record" : "Open first meeting record",
        expected: runtimeMeetingId
          ? "The runtime-ingested meeting appears in Meetings and opens its runtime detail shell."
          : "The first meeting record opens its detail panel.",
        confirmation: runtimeMeetingId ? "Runtime meeting detail panel opened." : "Meeting detail panel opened.",
        observed: { empty: false, meeting_title: targetTitle, meeting_card_kind: targetCardKind, detail_title: detailTitle, detail_text: detailText, meeting_id: runtimeMeetingId },
      });
      await closeDetailPanel(page, config.timeoutMs);
    } else {
      const emptyText = normalizeText(await page.locator(".meetings-empty").first().textContent().catch(() => "No meeting recordings yet."));
      assert(!/loading meetings/i.test(emptyText), `${mode}: meetings route never resolved past loading`);
      assert(!runtimeMeetingId, `${mode}: Meetings stayed empty instead of showing runtime meeting ${runtimeMeetingId}`);
      await recorder.capture({
        route: "meetings",
        action: "Check empty meetings state",
        expected: "An empty meetings surface is reported honestly when no recordings exist.",
        confirmation: "Meetings empty state was shown.",
        observed: { empty: true, message: emptyText },
      });
    }
  }

  if (shouldRunRoute(config, "meeting-notes")) {
    await goHome(page, config);
    await openRouteFromHome(page, "meeting-notes", config.timeoutMs);
    await waitForSeededMeetingNote(page, seed, config.timeoutMs);
    await page.locator(`.light-graph-row[data-record-id="${seed.meetingNoteId}"]`).first().click();
    await waitForRoute(page, "meeting-note-detail", config.timeoutMs);
    await waitForTextInBody(page, seed.meetingNoteTitle, config.timeoutMs);
    await waitForTextInBody(page, seed.noteTitle, config.timeoutMs);
    await recorder.capture({
      route: "meeting-note-detail",
      action: "Open seeded meeting note detail",
      expected: "The seeded meeting note opens from the Meeting Notes route and surfaces its linked note.",
      confirmation: "Seeded meeting note detail opened with linked note context.",
      observed: { meeting_note_title: seed.meetingNoteTitle, linked_note_title: seed.noteTitle },
    });
  }

  if (shouldRunRoute(config, "reminders")) {
    await goHome(page, config);
    await openRouteFromHome(page, "reminders", config.timeoutMs);
    await waitForSeededReminder(page, seed, config.timeoutMs);
    await page.locator(`.light-reminder-row[data-reminder-id="${seed.reminderId}"]`).first().click();
    await waitForRoute(page, "reminder-detail", config.timeoutMs);
    await waitForTextInBody(page, seed.reminderTitle, config.timeoutMs);
    await waitForTextInBody(page, seed.noteTitle, config.timeoutMs);
    await recorder.capture({
      route: "reminder-detail",
      action: "Open seeded reminder detail",
      expected: "The seeded reminder opens from the Reminders route and surfaces its linked note.",
      confirmation: "Seeded reminder detail opened with linked note context.",
      observed: { reminder_title: seed.reminderTitle, linked_note_title: seed.noteTitle },
    });
  }

  if (shouldRunRoute(config, "settings")) {
    await goHome(page, config);
    await openRouteFromHome(page, "settings", config.timeoutMs);
    await page.locator(".light-settings-surface").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    const settingsTitle = normalizeText(await page.locator(".light-settings-page .light-page-title").first().textContent());
    await recorder.capture({
      route: "settings",
      action: "Render settings surface",
      expected: "Settings renders without changing any persistent preference.",
      confirmation: "Settings surface rendered.",
      observed: { title: settingsTitle },
    });
  }

  if (shouldRunRoute(config, "notes")) {
    await goHome(page, config);
    await openRouteFromHome(page, "notes", config.timeoutMs);
    await waitForSeededNote(page, seed, config.timeoutMs);
    await page.locator(".light-note-row").filter({ hasText: seed.noteTitle }).first().click();
    await waitForRoute(page, "note-detail", config.timeoutMs);
    await waitForTextInBody(page, seed.noteTitle, config.timeoutMs);
    await recorder.capture({
      route: "note-detail",
      action: "Open seeded note detail",
      expected: "The seeded note opens from the Notes route.",
      confirmation: "Seeded note detail opened.",
      observed: { note_title: seed.noteTitle },
    });
  }

  if (shouldRunRoute(config, "tasks")) {
    await page.goto(buildRouteUrl(config, "tasks", "light"), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForRoute(page, "tasks", config.timeoutMs);
    await waitForSeededTask(page, seed, config.timeoutMs);
    const initialTaskListState = await readTaskListSelectionState(page);
    assert(!initialTaskListState.has_filter_pill, `${mode}: task list should not render the legacy filter pill`);
    assert(
      JSON.stringify(initialTaskListState.headers.slice(0, 4)) === JSON.stringify(["Today", "Overdue", "Upcoming", "Done"]),
      `${mode}: expected Today / Overdue / Upcoming / Done task section order, got ${JSON.stringify(initialTaskListState.headers)}`
    );
    await recorder.capture({
      route: "tasks",
      action: "Inspect Tasks list before cleanup",
      expected: "Tasks opens without a filter pill and orders sections as Today, Overdue, Upcoming, and Done.",
      confirmation: "Tasks list starts without a filter pill and with Today first.",
      observed: initialTaskListState,
    });

    await page.locator(".light-task-select-toggle").first().click();
    const selectModeState = await readTaskListSelectionState(page);
    assert(selectModeState.page_title === "Select tasks", `${mode}: Select mode did not change the task page title`);
    assert(selectModeState.select_mode_active, `${mode}: Select mode did not activate`);
    assert(selectModeState.bulk_bar_present, `${mode}: Select mode should show the bulk archive bar`);
    await recorder.capture({
      route: "tasks",
      action: "Open task bulk select mode",
      expected: "Tapping Select enters bulk-select mode and shows the sticky archive bar.",
      confirmation: "Task bulk select mode opened cleanly.",
      observed: selectModeState,
    });

    await page.locator(`.light-task-row[data-task-id="${seed.inProgressTaskId}"] .light-task-row-main`).first().click();
    await page.locator(`.light-task-row[data-task-id="${seed.waitingTaskId}"] .light-task-row-main`).first().click();
    const selectedTaskListState = await readTaskListSelectionState(page);
    assert(
      JSON.stringify(selectedTaskListState.selected_rows.sort()) === JSON.stringify([seed.inProgressTaskId, seed.waitingTaskId].sort()),
      `${mode}: bulk-select mode did not keep the selected task ids in sync`
    );
    assert(selectedTaskListState.bulk_count_label === "2 selected", `${mode}: bulk-select bar should show 2 selected, got ${selectedTaskListState.bulk_count_label}`);
    await page.locator(".light-task-bulk-archive").first().click();
    await waitForTaskAbsent(page, seed.inProgressTaskId, config.timeoutMs);
    await waitForTaskAbsent(page, seed.waitingTaskId, config.timeoutMs);
    await page.waitForFunction(() => {
      const title = String(document.querySelector(".light-page-title")?.textContent || "").trim();
      return title !== "Select tasks" && !document.querySelector(".light-task-bulk-bar");
    }, { timeout: config.timeoutMs });
    const archivedTaskListState = await readTaskListSelectionState(page);
    assert(!archivedTaskListState.select_mode_active, `${mode}: bulk archive should exit Select mode after success`);
    assert(!archivedTaskListState.selected_rows.length, `${mode}: bulk archive should clear the selected task ids`);
    await recorder.capture({
      route: "tasks",
      action: "Archive two selected tasks from the Tasks list",
      expected: "Selecting two tasks and tapping Archive removes both from the active Tasks feed.",
      confirmation: "Archive two selected tasks from the Tasks list.",
      observed: archivedTaskListState,
    });

    await goHome(page, config);
    await openRouteFromHome(page, "tasks", config.timeoutMs);
    await waitForSeededTask(page, seed, config.timeoutMs);
    await page.locator(`.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-status-trigger`).first().click();
    await page.locator(".settings-selector-sheet").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    assert((await currentRoute(page)) === "tasks", `${mode}: task list status selector should keep the route on tasks`);
    const listFocusState = await readTaskRowFocusState(page, seed.primaryTaskId);
    assertNoVisibleTaskFocusRing(listFocusState, `${mode}: task list status selector`);
    await recorder.capture({
      route: "tasks",
      action: "Open task list status selector",
      expected: "Clicking the task list status icon opens the shared status selector without opening task detail.",
      confirmation: "Task list status selector opened in place without a blue focus rectangle.",
      observed: {
        route: await currentRoute(page),
        task_id: seed.primaryTaskId,
        ...listFocusState,
      },
    });
    await page.locator('.settings-selector-option[data-selector-value="in_progress"]').first().click();
    await waitForTaskRowStatus(page, seed.primaryTaskId, "in_progress", config.timeoutMs);
    assert((await currentRoute(page)) === "tasks", `${mode}: applying a list task status change should keep the route on tasks`);
    await page.locator(`.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-main`).first().click();
    await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
    let taskState = await readTaskDetailState(page);
    ["description", "checklist", "connected"].forEach(section => {
      assert(taskState.sections.includes(section), `${mode}: task detail missing ${section} section`);
    });
    assert(!taskState.sections.includes("details"), `${mode}: task detail should not render a Details section`);
    assert(!taskState.sections.includes("people"), `${mode}: task detail should not render a People section`);
    assert(!taskState.sections.includes("notes"), `${mode}: task detail should not render a standalone Notes section`);
    assert(!taskState.sections.includes("attached"), `${mode}: task detail should not render a standalone Attached section`);
    assert(taskState.status_card_present, `${mode}: task detail is missing the interactive status header card`);
    assert(taskState.status_circle_present, `${mode}: task detail is missing the visible status circle`);
    assert(!taskState.task_html_frame_present, `${mode}: task detail should not render a task HTML frame above Description`);
    assert(taskState.description_is_first_section, `${mode}: task detail should start with Description`);
    assert(taskState.checklist_immediately_after_description, `${mode}: task detail should place Checklist directly after Description`);
    assert(taskState.header_created_meta, `${mode}: task detail should show compact created metadata in the header`);
    assert(taskState.header_created_meta.startsWith("Created "), `${mode}: active task detail header should say Created, got ${taskState.header_created_meta}`);
    assert(taskState.connected.some(item => item.kind === "note" && item.label === seed.noteTitle), `${mode}: task detail missing connected note entry`);
    assert(taskState.connected.some(item => item.kind === "calendar_event" && item.label === seed.calendarEventTitle), `${mode}: task detail missing connected calendar event`);
    assert(taskState.connected.some(item => item.kind === "contact" && item.label === seed.contactTitle), `${mode}: task detail missing connected contact`);
    assert(taskState.connected.some(item => item.kind === "project" && item.label === seed.projectTitle), `${mode}: task detail missing connected project`);
    assert(taskState.checklist.includes("Prep the room summary"), `${mode}: task detail missing expected checklist item`);
    assert(taskState.description.includes(seed.primaryDescription), `${mode}: task detail missing seeded description`);
    assert(taskState.task_detail_chevron_count === 0, `${mode}: task detail linked rows should not render trailing chevrons`);
    await recorder.capture({
      route: taskState.route || "tasks",
      action: "Open seeded task detail",
      expected: "The seeded primary task shows a compact header with created metadata, then Description, Checklist, and Connected with no embedded task HTML block.",
      confirmation: "Task detail keeps the compact header, checklist-first layout, and chevron-free linked rows.",
      observed: taskState,
    });

    await goToTasksList(page, mode, config.timeoutMs);
    await waitForRoute(page, "tasks", config.timeoutMs);
    await revealTaskRow(page, seed.overdueTaskId);
    await page.locator(`.light-task-row[data-task-id="${seed.overdueTaskId}"] .light-task-row-main`).first().click();
    await waitForTaskDetail(page, seed.overdueTaskId, config.timeoutMs);
    await page.locator(".light-task-detail-action-trigger").first().click();
    await page.locator(".settings-selector-sheet").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.locator('.settings-selector-option[data-selector-value="archive_task"]').first().click();
    await waitForRoute(page, "tasks", config.timeoutMs);
    await waitForTaskAbsent(page, seed.overdueTaskId, config.timeoutMs);
    const detailArchiveState = await readTaskListSelectionState(page);
    await recorder.capture({
      route: "tasks",
      action: "Archive current task from task detail actions",
      expected: "Choosing Archive task from the task detail actions removes the current task and returns cleanly to the Tasks feed.",
      confirmation: "Archive task from task detail actions removed the current task and returned to Tasks.",
      observed: detailArchiveState,
    });
    await page.locator(`.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-main`).first().click();
    await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);

    const incompleteChecklistIds = Array.isArray(seed.primaryChecklist)
      ? seed.primaryChecklist.filter(item => item && item.done !== true).map(item => String(item.id || ""))
      : [];
    assert(incompleteChecklistIds.length >= 2, `${mode}: expected at least two incomplete checklist items in the seeded task`);
    await page.locator(`.light-task-checklist-row[data-checklist-item-id="${incompleteChecklistIds[0]}"]`).first().click();
    await waitForTaskDetailStatus(page, "in_progress", config.timeoutMs);
    await page.locator(`.light-task-checklist-row[data-checklist-item-id="${incompleteChecklistIds[1]}"]`).first().click();
    await waitForTaskDetailStatus(page, "done", config.timeoutMs);
    const taskStateAfterChecklistDone = await readTaskDetailState(page);
    const taskRecordAfterChecklistDone = await waitForTaskRecord(
      config.baseUrl,
      seed.primaryTaskId,
      config.refreshKey,
      task => String(task?.status || "") === "done" && Number(task?.completed_at_ms || 0) > 0,
      config.timeoutMs,
      `${mode}: completing the final checklist item should mark the task done in the API`
    );
    const completedAtAfterChecklistDone = Number(taskRecordAfterChecklistDone.completed_at_ms || 0);
    assert(taskStateAfterChecklistDone.task_status === "done", `${mode}: completing the final checklist item should mark the task done in the DOM`);
    assert(taskStateAfterChecklistDone.header_created_meta.startsWith("Completed "), `${mode}: completed task detail header should say Completed, got ${taskStateAfterChecklistDone.header_created_meta}`);
    assert(taskRecordAfterChecklistDone.status === "done", `${mode}: completing the final checklist item should mark the task done in the API`);
    assert(completedAtAfterChecklistDone > 0, `${mode}: completing the final checklist item should stamp completed_at_ms in the API`);
    await goToTasksList(page, mode, config.timeoutMs);
    await waitForRoute(page, "tasks", config.timeoutMs);
    await revealTaskRow(page, seed.primaryTaskId);
    await waitForTaskRowStatus(page, seed.primaryTaskId, "done", config.timeoutMs);
    const taskGroupAfterChecklistDone = await taskGroupForRow(page, seed.primaryTaskId);
    assert(taskGroupAfterChecklistDone === "done", `${mode}: completed checklist task should move into the Done group`);
    await recorder.capture({
      route: "tasks",
      action: "Complete final task checklist item",
      expected: "Checking the final remaining checklist item auto-marks the task Done, persists the API status, and moves the task into the Done group.",
      confirmation: "The final checklist item auto-completed the task and moved it into Done.",
      observed: {
        ...taskStateAfterChecklistDone,
        api_status: String(taskRecordAfterChecklistDone.status || ""),
        task_group: taskGroupAfterChecklistDone,
      },
    });
    await page.locator(`.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-main`).first().click();
    await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
    await page.locator(`.light-task-checklist-row[data-checklist-item-id="${incompleteChecklistIds[1]}"]`).first().click();
    await waitForTaskDetailStatus(page, "in_progress", config.timeoutMs);
    const taskStateAfterChecklistReopen = await readTaskDetailState(page);
    const taskRecordAfterChecklistReopen = await waitForTaskRecord(
      config.baseUrl,
      seed.primaryTaskId,
      config.refreshKey,
      task => String(task?.status || "") === "in_progress" && !("completed_at_ms" in (task || {})),
      config.timeoutMs,
      `${mode}: unchecking a completed checklist item should reopen the task in the API`
    );
    assert(taskStateAfterChecklistReopen.task_status === "in_progress", `${mode}: unchecking a completed checklist item should reopen the task in the DOM`);
    assert(taskStateAfterChecklistReopen.header_created_meta.startsWith("Created "), `${mode}: reopened task detail header should return to Created, got ${taskStateAfterChecklistReopen.header_created_meta}`);
    assert(taskRecordAfterChecklistReopen.status === "in_progress", `${mode}: unchecking a completed checklist item should reopen the task in the API`);
    assert(!("completed_at_ms" in taskRecordAfterChecklistReopen), `${mode}: reopening a task should clear completed_at_ms in the API`);
    await goToTasksList(page, mode, config.timeoutMs);
    await waitForRoute(page, "tasks", config.timeoutMs);
    await revealTaskRow(page, seed.primaryTaskId);
    await waitForTaskRowStatus(page, seed.primaryTaskId, "in_progress", config.timeoutMs);
    const taskGroupAfterChecklistReopen = await taskGroupForRow(page, seed.primaryTaskId);
    assert(taskGroupAfterChecklistReopen === "do", `${mode}: reopened checklist task should leave Done and return to the Today group`);
    await recorder.capture({
      route: "tasks",
      action: "Reopen task by unchecking a completed checklist item",
      expected: "Unchecking one checklist item after completion reopens the task to In progress, persists the API status, and removes the task from the Done group.",
      confirmation: "The checklist uncheck reopened the task and moved it back out of Done.",
      observed: {
        ...taskStateAfterChecklistReopen,
        api_status: String(taskRecordAfterChecklistReopen.status || ""),
        task_group: taskGroupAfterChecklistReopen,
      },
    });
    await page.locator(`.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-main`).first().click();
    await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
    taskState = await readTaskDetailState(page);
    assert(taskState.task_status === "in_progress", `${mode}: task detail should reopen in progress before header selector checks continue`);

    await page.locator(".light-task-detail-card").first().click({ position: { x: 16, y: 16 } });
    await page.locator(".settings-selector-sheet").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    assert((await currentRoute(page)) === expectedTaskReturnRoute(mode), `${mode}: task detail header selector should keep the current route stable`);
    const detailFocusState = await readTaskDetailFocusState(page);
    assertNoVisibleTaskFocusRing(detailFocusState, `${mode}: task detail header selector from circle side`);
    await recorder.capture({
      route: taskState.route || expectedTaskReturnRoute(mode),
      action: "Open task detail header status selector near circle",
      expected: "Clicking the task detail header near the status circle opens the shared status selector without leaving task detail.",
      confirmation: "Task detail header selector opened in place without a blue focus rectangle.",
      observed: {
        route: await currentRoute(page),
        task_id: seed.primaryTaskId,
        task_status: taskState.task_status,
        status_label: taskState.status_label,
        ...detailFocusState,
      },
    });
    await page.locator('.settings-selector-option[data-selector-value="waiting"]').first().click();
    await waitForTaskDetailStatus(page, "waiting", config.timeoutMs);
    taskState = await readTaskDetailState(page);
    assert(taskState.task_status === "waiting", `${mode}: task detail header did not persist Waiting in the DOM`);

    await page.locator(".light-task-detail-card").first().click({ position: { x: 132, y: 20 } });
    await page.locator(".settings-selector-sheet").first().waitFor({ state: "visible", timeout: config.timeoutMs });
    assert((await currentRoute(page)) === expectedTaskReturnRoute(mode), `${mode}: task detail header selector should keep the current route stable`);
    const detailTitleFocusState = await readTaskDetailFocusState(page);
    assertNoVisibleTaskFocusRing(detailTitleFocusState, `${mode}: task detail header selector from title area`);
    await recorder.capture({
      route: taskState.route || expectedTaskReturnRoute(mode),
      action: "Open task detail header status selector on title area",
      expected: "Clicking the task detail header on the title area opens the shared status selector without leaving task detail.",
      confirmation: "Task detail header selector opened from the title area without a blue focus rectangle.",
      observed: {
        route: await currentRoute(page),
        task_id: seed.primaryTaskId,
        task_status: taskState.task_status,
        status_label: taskState.status_label,
        ...detailTitleFocusState,
      },
    });
    await page.waitForTimeout(25);
    await page.locator('.settings-selector-option[data-selector-value="done"]').first().click();
    await waitForTaskDetailStatus(page, "done", config.timeoutMs);
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("reset_nav");
      window.history.replaceState({}, "", url.toString());
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForRoute(page, expectedTaskReturnRoute(mode), config.timeoutMs);
    await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
    taskState = await readTaskDetailState(page);
    const taskRecord = await waitForTaskRecord(
      config.baseUrl,
      seed.primaryTaskId,
      config.refreshKey,
      task => String(task?.status || "") === "done" && Number(task?.completed_at_ms || 0) > completedAtAfterChecklistDone,
      config.timeoutMs,
      `${mode}: task API did not persist Done after reload`
    );
    const completedAtAfterReload = Number(taskRecord.completed_at_ms || 0);
    assert(taskState.task_status === "done", `${mode}: task detail did not keep Done after reload`);
    assert(taskRecord.status === "done", `${mode}: task API did not persist Done after reload`);
    assert(!taskState.task_html_frame_present, `${mode}: task detail should stay free of embedded HTML after reload`);
    assert(taskState.description_is_first_section, `${mode}: task detail should still start with Description after reload`);
    assert(taskState.checklist_immediately_after_description, `${mode}: task detail should keep Checklist directly after Description after reload`);
    assert(taskState.header_created_meta, `${mode}: task detail should keep compact created metadata after reload`);
    assert(taskState.header_created_meta.startsWith("Completed "), `${mode}: done task detail header should keep Completed after reload, got ${taskState.header_created_meta}`);
    assert(completedAtAfterReload > completedAtAfterChecklistDone, `${mode}: re-done task should stamp a fresh completion timestamp after reopening`);
    assert(taskState.task_detail_chevron_count === 0, `${mode}: task detail linked rows should stay chevron-free after reload`);
    await recorder.capture({
      route: taskState.route || expectedTaskReturnRoute(mode),
      action: "Persist Done status after reload",
      expected: "The task keeps its Done status after reload, matches the workspace API, and keeps the compact checklist-first detail layout.",
      confirmation: "Task status persisted through reload and the cleaned detail layout remained intact.",
      observed: {
        ...taskState,
        api_status: String(taskRecord.status || ""),
      },
    });

    await goToTasksList(page, mode, config.timeoutMs);
    await revealTaskRow(page, seed.primaryTaskId);
    await ensureTaskSectionExpanded(page, "done");
    const finalTaskGroup = await taskGroupForRow(page, seed.primaryTaskId);
    assert(finalTaskGroup === "done", `${mode}: task did not move into the Done section after the final status change`);
    if (mode === "mobile") {
      await page.locator(`.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-main`).first().click();
      await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
    } else {
      await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
    }

    for (const link of TASK_LINKS) {
      const targetId = seed[link.idKey];
      const targetTitle = seed[link.titleKey];
      const selector = `.light-info-row[data-task-connected-kind][data-workspace-target-route="${link.route}"][data-workspace-target-id="${targetId}"]`;
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: config.timeoutMs });
      await locator.click();
      await waitForRoute(page, link.route, config.timeoutMs);
      await waitForTextInBody(page, targetTitle, config.timeoutMs);
      const pageTitle = normalizeText(await page.locator(".light-page-title").last().textContent().catch(() => targetTitle));
      await recorder.capture({
        route: link.route,
        action: `Open task-linked ${link.label}`,
        expected: `The task-linked ${link.label} opens from the task detail surface.`,
        confirmation: `Task-linked ${link.label} detail opened.`,
        observed: { target_kind: link.kind, target_title: targetTitle, page_title: pageTitle },
      });
      await clickBack(page, config.timeoutMs);
      await waitForRoute(page, expectedTaskReturnRoute(mode), config.timeoutMs);
      await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
    }
  }

  if (shouldRunRoute(config, "calendar")) {
    await goHome(page, config);
    await openRouteFromHome(page, "calendar", config.timeoutMs);
    await waitForSeededCalendarEvent(page, seed, config.timeoutMs);
    await page.locator(`.light-event-block[data-event-id="${seed.calendarEventId}"] .light-event-main`).first().click();
    await waitForRoute(page, "meeting-detail", config.timeoutMs);
    await waitForTextInBody(page, seed.calendarEventTitle, config.timeoutMs);
    await recorder.capture({
      route: "meeting-detail",
      action: "Open seeded calendar event",
      expected: "The seeded calendar event opens from the Calendar route.",
      confirmation: "Seeded calendar event detail opened.",
      observed: { event_title: seed.calendarEventTitle },
    });
  }

  if (shouldRunRoute(config, "projects")) {
    await goHome(page, config);
    await openRouteFromHome(page, "projects", config.timeoutMs);
    await waitForSeededProject(page, seed, config.timeoutMs);
    await page.locator(`.light-project-row[data-project-id="${seed.projectId}"]`).first().click();
    await waitForRoute(page, "project-detail", config.timeoutMs);
    await waitForTextInBody(page, seed.projectTitle, config.timeoutMs);
    await recorder.capture({
      route: "project-detail",
      action: "Open seeded project detail",
      expected: "The seeded project detail opens from the Projects route.",
      confirmation: "Seeded project detail opened.",
      observed: { project_title: seed.projectTitle },
    });
  }

  if (shouldRunRoute(config, "contacts")) {
    const stabilityQuery = "dav";
    const summaryQuery = "primary task";
    const phoneQuery = "0188";
    const staleActivityQuery = "Linked to live alpha";
    const staleSelfActivityQuery = "reminder";
    const noMatchQuery = "zzzz-no-match";
    const initialsQuery = "Da";
    const connectedLabels = [seed.noteTitle, seed.primaryTaskTitle, seed.meetingNoteTitle];

    await goHome(page, config);
    await openRouteFromHome(page, "contacts", config.timeoutMs);
    await waitForSeededContact(page, seed, config.timeoutMs);
    const contactsListFlatness = await readContactsListFlatness(page);
    const baselineSearchState = await readContactsSearchState(page);
    const baselineRowIds = baselineSearchState.row_ids.slice();
    assert(contactsListFlatness.route === "contacts", `${mode}: expected Contacts route before detail, got ${contactsListFlatness.route}`);
    assert(baselineSearchState.search_visible, `${mode}: Contacts search should be visible once contacts load`);
    assert(baselineSearchState.query === "", `${mode}: Contacts search should start empty, got ${baselineSearchState.query}`);
    assert(
      JSON.stringify(baselineSearchState.row_titles) === JSON.stringify(baselineSearchState.row_titles.slice().sort((left, right) => left.localeCompare(right))),
      `${mode}: expected Contacts baseline list to stay alphabetical, got ${baselineSearchState.row_titles.join(", ")}`
    );
    assert(baselineSearchState.row_details[seed.contactId] === "Proof contact linked from the primary task.", `${mode}: expected Contacts row subtitle to drop activity suffix, got ${baselineSearchState.row_details[seed.contactId] || "<missing>"}`);
    assert(baselineSearchState.row_avatar_texts["contact-me"] === "M", `${mode}: Expected contact-me avatar to stay M, got ${baselineSearchState.row_avatar_texts["contact-me"] || "<missing>"}`);
    assert(baselineSearchState.row_avatar_texts[seed.davidContactId] === "D", `${mode}: Expected David avatar to render a single D initial, got ${baselineSearchState.row_avatar_texts[seed.davidContactId] || "<missing>"}`);
    assert(baselineSearchState.row_avatar_texts[seed.danielContactId] === "D", `${mode}: Expected Daniel avatar to render a single D initial, got ${baselineSearchState.row_avatar_texts[seed.danielContactId] || "<missing>"}`);
    assert(contactsListFlatness.row_class_list.includes("is-flat-feed"), `${mode}: Contacts list should render flat-feed rows (${contactsListFlatness.row_class_list.join(" ")})`);
    assert(isTransparentColor(contactsListFlatness.row_background), `${mode}: Contacts list should stay visually flat (${contactsListFlatness.row_background})`);
    assert(isNoShadow(contactsListFlatness.row_box_shadow), `${mode}: Contacts list should stay visually flat (${contactsListFlatness.row_box_shadow})`);
    assert(
      isZeroishPx(contactsListFlatness.row_border_top_left_radius) && isZeroishPx(contactsListFlatness.row_border_top_right_radius),
      `${mode}: Contacts list should remove rounded row corners (${contactsListFlatness.row_border_top_left_radius}, ${contactsListFlatness.row_border_top_right_radius})`
    );
    assert(isZeroishPx(contactsListFlatness.list_gap), `${mode}: Contacts list should remove inter-row card gaps (${contactsListFlatness.list_gap})`);
    assert(
      isZeroishPx(contactsListFlatness.row_padding_left) && isZeroishPx(contactsListFlatness.row_padding_right),
      `${mode}: Contacts list should remove detached side padding (${contactsListFlatness.row_padding_left}, ${contactsListFlatness.row_padding_right})`
    );
    if (contactsListFlatness.row_count > 1) {
      assert(
        !isZeroishPx(contactsListFlatness.divider_width) && !isTransparentColor(contactsListFlatness.divider_color),
        `${mode}: Contacts list should keep divider separation between rows (${contactsListFlatness.divider_width}, ${contactsListFlatness.divider_color})`
      );
    }
    await recorder.capture({
      route: "contacts",
      action: "Inspect Contacts list",
      expected: "The Contacts list stays flat on the deployed hosted UI before opening detail.",
      confirmation: "Contacts list stayed flat, exposed search, and preserved the alphabetical baseline order.",
      observed: {
        contact_title: seed.contactTitle,
        first_contact_id: contactsListFlatness.first_contact_id,
        contacts_list_flatness: contactsListFlatness,
        contacts_search: baselineSearchState,
      },
    });

    const initialsSearchState = await expectContactsSearchRowsContaining(page, initialsQuery, [seed.danielContactId, seed.davidContactId], config.timeoutMs);
    assert(initialsSearchState.row_avatar_texts[seed.davidContactId] === "D", `${mode}: Expected David avatar to render a single D initial, got ${initialsSearchState.row_avatar_texts[seed.davidContactId] || "<missing>"}`);
    assert(initialsSearchState.row_avatar_texts[seed.danielContactId] === "D", `${mode}: Expected Daniel avatar to render a single D initial, got ${initialsSearchState.row_avatar_texts[seed.danielContactId] || "<missing>"}`);
    await recorder.capture({
      route: "contacts",
      action: "Inspect Contacts single-name initials",
      expected: "Seeded one-token contacts render a single initial while the self contact stays on a single derived initial.",
      confirmation: "David and Daniel each rendered D, and contact-me stayed on M.",
      observed: { query: initialsQuery, contacts_search: initialsSearchState },
    });

    const stabilityTrace = await traceContactsSearchTyping(page, stabilityQuery, config.timeoutMs);
    assert((stabilityTrace.eventCounts.blur || 0) === 0 && (stabilityTrace.eventCounts.focusout || 0) === 0, `${mode}: Expected Contacts search typing to avoid blur/focusout while filtering; saw ${JSON.stringify(stabilityTrace.eventCounts)}`);
    assert((stabilityTrace.eventCounts["search-node-changed"] || 0) === 0, `${mode}: Expected Contacts search typing to keep the same mounted input; saw ${JSON.stringify(stabilityTrace.eventCounts)}`);
    assert(stabilityTrace.initialToken === stabilityTrace.finalToken, `${mode}: Expected Contacts search typing to keep the same mounted input (token ${stabilityTrace.initialToken} -> ${stabilityTrace.finalToken})`);
    assert(stabilityTrace.finalValue === stabilityQuery, `${mode}: expected Contacts search to finish with ${stabilityQuery}, got ${stabilityTrace.finalValue}`);
    assert(
      stabilityTrace.searchState.row_ids.includes(seed.davidContactId),
      `${mode}: expected ${stabilityQuery} to keep the seeded David visible, got ${stabilityTrace.searchState.row_ids.join(", ")}`
    );
    assert(
      !stabilityTrace.searchState.row_ids.includes(seed.danielContactId),
      `${mode}: expected ${stabilityQuery} to exclude Daniel, got ${stabilityTrace.searchState.row_ids.join(", ")}`
    );
    await recorder.capture({
      route: "contacts",
      action: "Type into Contacts search without remounting",
      expected: "Typing into Contacts search keeps the same mounted input and never triggers blur or focusout while filtering.",
      confirmation: "Contacts search accepted dav without blur, focusout, or input replacement.",
      observed: {
        query: stabilityQuery,
        trace_event_counts: stabilityTrace.eventCounts,
        initial_token: stabilityTrace.initialToken,
        final_token: stabilityTrace.finalToken,
        contacts_search: stabilityTrace.searchState,
      },
    });
    await expectContactsSearchRows(page, "", baselineRowIds, config.timeoutMs);

    const summarySearchState = await expectContactsSearchRows(page, summaryQuery, [seed.contactId], config.timeoutMs);
    assert(summarySearchState.row_titles.includes(seed.contactTitle), `${mode}: summary query should return the seeded contact, got ${summarySearchState.row_titles.join(", ")}`);
    await recorder.capture({
      route: "contacts",
      action: "Filter Contacts by summary text",
      expected: "Searching by a contact summary phrase narrows the Contacts list to the matching contact.",
      confirmation: "Summary-text filtering returned only the seeded contact.",
      observed: { query: summaryQuery, contacts_search: summarySearchState },
    });

    const phoneSearchState = await expectContactsSearchRows(page, phoneQuery, [seed.contactId], config.timeoutMs);
    assert(phoneSearchState.row_titles.includes(seed.contactTitle), `${mode}: phone query should return the seeded contact, got ${phoneSearchState.row_titles.join(", ")}`);

    const staleActivitySearchState = await expectContactsSearchRows(page, staleActivityQuery, [], config.timeoutMs);
    assert(staleActivitySearchState.search_visible, `${mode}: stale activity-only query should keep the search visible`);
    assert(staleActivitySearchState.row_ids.length === 0, `${mode}: Expected stale activity-only phrase to return zero Contacts rows, got ${staleActivitySearchState.row_ids.join(", ")}`);
    await recorder.capture({
      route: "contacts",
      action: "Reject Contacts activity-only phrase",
      expected: "An old activity-only phrase no longer matches Contacts once activity becomes UI-inert.",
      confirmation: "The stale activity-only phrase returned zero Contacts rows.",
      observed: { query: staleActivityQuery, contacts_search: staleActivitySearchState },
    });

    const staleSelfActivitySearchState = await expectContactsSearchRows(page, staleSelfActivityQuery, [], config.timeoutMs);
    assert(staleSelfActivitySearchState.row_ids.length === 0, `${mode}: Expected stale self activity-only phrase to return zero Contacts rows, got ${staleSelfActivitySearchState.row_ids.join(", ")}`);

    const emptySearchState = await expectContactsSearchRows(page, noMatchQuery, [], config.timeoutMs);
    assert(emptySearchState.search_visible, `${mode}: Contacts search should remain visible when no results match`);
    assert(
      emptySearchState.empty_text.includes("No contacts match your search."),
      `${mode}: expected empty Contacts search copy, got ${emptySearchState.empty_text}`
    );
    await recorder.capture({
      route: "contacts",
      action: "Show Contacts search empty state",
      expected: "A no-match Contacts search keeps the search field visible and shows an honest empty state.",
      confirmation: "Contacts search empty state appeared while keeping the field visible.",
      observed: { query: noMatchQuery, contacts_search: emptySearchState },
    });

    const clearedSearchState = await expectContactsSearchRows(page, "", baselineRowIds, config.timeoutMs);
    assert(
      JSON.stringify(clearedSearchState.row_ids) === JSON.stringify(baselineRowIds),
      `${mode}: clearing Contacts search should restore the baseline order, got ${clearedSearchState.row_ids.join(", ")}`
    );
    await recorder.capture({
      route: "contacts",
      action: "Clear Contacts search",
      expected: "Clearing the Contacts search restores the baseline list and order immediately.",
      confirmation: "Contacts list returned to its baseline order after clearing search.",
      observed: { contacts_search: clearedSearchState },
    });

    await expectContactsSearchRows(page, summaryQuery, [seed.contactId], config.timeoutMs);
    await page.locator(`.light-contact-row[data-contact-id="${seed.contactId}"]`).first().click();
    await waitForRoute(page, "contact-detail", config.timeoutMs);
    await waitForTextInBody(page, seed.contactTitle, config.timeoutMs);
    const filteredDetailState = await waitForContactConnectedRows(page, connectedLabels, config.timeoutMs);
    assert(!filteredDetailState.hasActivitySection, `${mode}: expected classic detail to omit the Activity section`);
    assert(filteredDetailState.hasConnectedSection, `${mode}: expected contact detail to keep Connected visible`);
    assert(filteredDetailState.connectedInfoRowCount >= 3, `${mode}: expected contact Connected rows to use generic info rows, got ${filteredDetailState.connectedInfoRowCount}`);
    assert(filteredDetailState.connectedLinkedRecordFeedRowCount === 0, `${mode}: expected contact Connected rows to stop using linked-record feed rows, got ${filteredDetailState.connectedLinkedRecordFeedRowCount}`);
    for (const label of connectedLabels) {
      assert(filteredDetailState.connectedRowTexts.some(value => value.includes(label)), `${mode}: expected contact Connected to include ${label}, got ${filteredDetailState.connectedRowTexts.join(", ")}`);
    }
    await recorder.capture({
      route: "contact-detail",
      action: "Open seeded contact detail from filtered list",
      expected: "A filtered Contacts result still opens its contact detail normally.",
      confirmation: "Seeded contact detail opened from the filtered Contacts list.",
      observed: { contact_title: seed.contactTitle, query: summaryQuery, contact_edit: filteredDetailState },
    });

    await clickBack(page, config.timeoutMs);
    await waitForRoute(page, "contacts", config.timeoutMs);
    const backToFilteredState = await readContactsSearchState(page);
    assert(backToFilteredState.query === summaryQuery, `${mode}: expected Back to preserve the Contacts query, got ${backToFilteredState.query}`);
    assert(
      JSON.stringify(backToFilteredState.row_ids) === JSON.stringify([seed.contactId]),
      `${mode}: expected Back to restore the filtered Contacts list, got ${backToFilteredState.row_ids.join(", ")}`
    );
    await recorder.capture({
      route: "contacts",
      action: "Return to filtered Contacts list",
      expected: "Back from contact detail returns to the same filtered Contacts list with the same query.",
      confirmation: "Contacts Back restored the same filtered list and query.",
      observed: { query: summaryQuery, contacts_search: backToFilteredState },
    });

    await goHome(page, config);
    await openRouteFromHome(page, "contacts", config.timeoutMs);
    await waitForSeededContact(page, seed, config.timeoutMs);
    const reenteredSearchState = await readContactsSearchState(page);
    assert(reenteredSearchState.query === "", `${mode}: Contacts search should reset after leaving the Contacts surface, got ${reenteredSearchState.query}`);
    assert(
      JSON.stringify(reenteredSearchState.row_ids) === JSON.stringify(baselineRowIds),
      `${mode}: Contacts re-entry should restore the baseline list, got ${reenteredSearchState.row_ids.join(", ")}`
    );
  }

  if (shouldRunRoute(config, "contact-edit")) {
    const { updatedTitle, updatedSummary, updatedEmail, updatedPhone, modeLabel } = buildContactsEditProofValues(mode);
    const updatedFirstName = "Updated";
    const updatedLastName = "Live Contact";
    const photoPath = path.resolve("pucky_vm/ui_src/fixtures/contact_photos/proof-contact.webp");
    const expectedInitials = "UC";
    const staleActivityQuery = "Linked to live alpha";
    const connectedLabels = [seed.noteTitle, seed.primaryTaskTitle, seed.meetingNoteTitle];

    await goHome(page, config);
    await openRouteFromHome(page, "contacts", config.timeoutMs);
    await waitForSeededContact(page, seed, config.timeoutMs);
    const baselineListState = await readContactsSearchState(page);
    assert(baselineListState.row_details[seed.contactId] === "Proof contact linked from the primary task.", `${mode}: expected Contacts row subtitle to drop activity suffix, got ${baselineListState.row_details[seed.contactId] || "<missing>"}`);
    const staleActivitySearchState = await expectContactsSearchRows(page, staleActivityQuery, [], config.timeoutMs);
    assert(staleActivitySearchState.search_visible, `${mode}: stale activity-only query should keep the search visible`);
    assert(staleActivitySearchState.row_ids.length === 0, `${mode}: Expected stale activity-only phrase to return zero Contacts rows, got ${staleActivitySearchState.row_ids.join(", ")}`);
    await expectContactsSearchRows(page, "", baselineListState.row_ids, config.timeoutMs);
    await page.locator(`.light-contact-row[data-contact-id="${seed.contactId}"]`).first().click();
    await waitForRoute(page, "contact-detail", config.timeoutMs);
    await waitForTextInBody(page, seed.contactTitle, config.timeoutMs);
    const editState = await waitForContactConnectedRows(page, connectedLabels, config.timeoutMs);
    assert(editState.pageVisible, `${mode}: expected classic contact detail to be visible`);
    assert(editState.route === "contact-detail", `${mode}: expected contact-detail route, got ${editState.route}`);
    assert(editState.mode === "view", `${mode}: expected classic detail to open in view mode, got ${editState.mode}`);
    assert(editState.action === "edit", `${mode}: expected classic detail to expose an edit action, got ${editState.action}`);
    assert(!editState.hasHeroContainer, `${mode}: expected classic detail to drop the hero container chrome`);
    assert(editState.hasIdentityHeader, `${mode}: expected classic detail to keep a frameless identity header`);
    assert(!editState.identityHasCardChrome, `${mode}: expected classic detail identity header to stay chrome-free`);
    assert(editState.titleFontSizePx >= 28, `${mode}: expected classic detail title font size to stay large, got ${editState.titleFontSizePx}`);
    assert(!editState.firstNameVisible && !editState.lastNameVisible, `${mode}: expected name inputs to stay hidden until edit mode`);
    assert(!editState.hasActivitySection, `${mode}: expected classic detail to omit the Activity section`);
    assert(editState.hasConnectedSection, `${mode}: expected Connected to remain visible on the detail`);
    assert(editState.connectedInfoRowCount >= 3, `${mode}: expected contact Connected rows to use generic info rows, got ${editState.connectedInfoRowCount}`);
    assert(editState.connectedLinkedRecordFeedRowCount === 0, `${mode}: expected contact Connected rows to stop using linked-record feed rows, got ${editState.connectedLinkedRecordFeedRowCount}`);
    for (const label of connectedLabels) {
      assert(editState.connectedRowTexts.some(value => value.includes(label)), `${mode}: expected contact Connected to include ${label}, got ${editState.connectedRowTexts.join(", ")}`);
    }
    const identityViewScreenshot = await saveContactDetailIdentityScreenshot(page, config.reportDir, `${mode}-02a-contact-detail-identity-view`, config.timeoutMs);
    await recorder.capture({
      route: "contact-detail",
      action: "Open classic contact detail",
      expected: "Clicking a contact opens the classic read-only contact profile without the old hero container, while keeping a large frameless identity header.",
      confirmation: "The deployed contact detail opened in classic read-only mode with the frameless identity header, large name, and edit action.",
      observed: { contact_title: seed.contactTitle, contact_edit: editState, identity_screenshot: identityViewScreenshot },
    });

    await page.locator('[data-contact-detail-action="edit"]').first().click();
    await page.waitForFunction(() => {
      const pageRoot = document.querySelector(".light-contact-detail-page");
      return pageRoot instanceof HTMLElement && pageRoot.getAttribute("data-contact-detail-mode") === "edit";
    }, undefined, { timeout: config.timeoutMs });
    const editModeState = await readContactEditState(page);
    assert(editModeState.mode === "edit", `${mode}: expected detail to enter edit mode, got ${editModeState.mode}`);
    assert(editModeState.action === "done", `${mode}: expected edit mode to expose a done action, got ${editModeState.action}`);
    assert(!editModeState.hasHeroContainer, `${mode}: expected edit mode to keep the hero container removed`);
    assert(editModeState.hasIdentityHeader, `${mode}: expected edit mode to keep the frameless identity header`);
    assert(!editModeState.identityHasCardChrome, `${mode}: expected edit mode to keep the identity header chrome-free`);
    assert(editModeState.firstNameVisible && editModeState.lastNameVisible, `${mode}: expected editable first + last name inputs in edit mode`);
    assert(!editModeState.hasActivitySection, `${mode}: expected edit mode to keep Activity removed`);
    const identityEditScreenshot = await saveContactDetailIdentityScreenshot(page, config.reportDir, `${mode}-03a-contact-detail-identity-edit`, config.timeoutMs);
    await recorder.capture({
      route: "contact-detail",
      action: "Enter in-place contact edit mode",
      expected: "The same contact-detail surface stays mounted and swaps relevant fields into editable inputs.",
      confirmation: "The deployed contact detail entered in-place edit mode without replacing the frameless identity header or route.",
      observed: { contact_title: seed.contactTitle, contact_edit: editModeState, identity_screenshot: identityEditScreenshot },
    });

    const typingTrace = await traceContactEditTyping(page, "first_name", updatedFirstName, config.timeoutMs);
    assert((typingTrace.eventCounts.blur || 0) === 0 && (typingTrace.eventCounts.focusout || 0) === 0, `${mode}: Expected contact edit typing to avoid blur/focusout while editing`);
    assert(typingTrace.initialToken === typingTrace.finalToken, `${mode}: Expected contact edit typing to keep the same mounted input`);
    await fillContactEditField(page, "last_name", updatedLastName, config.timeoutMs);
    await fillContactEditField(page, "summary", updatedSummary, config.timeoutMs);
    await fillContactEditField(page, "email", updatedEmail, config.timeoutMs);
    await fillContactEditField(page, "phone", updatedPhone, config.timeoutMs);
    await waitForContactAutosaveSaved(page, config.timeoutMs);
    let updatedRecord = await waitForContactRecord(
      config.baseUrl,
      config.apiToken,
      seed.contactId,
      record => record.title === updatedTitle
        && record.summary === updatedSummary
        && String(record?.metadata?.email || "") === updatedEmail
        && String(record?.metadata?.phone || "") === updatedPhone,
      config.timeoutMs,
      `${mode}: Expected saved contact detail to show the updated title`
    );
    await recorder.capture({
      route: "contact-detail",
      action: "Autosave edited contact",
      expected: "Typing contact fields autosaves name, description, email, and phone changes without leaving the detail route.",
      confirmation: `${modeLabel} edits autosaved in place and persisted through the Contacts API.`,
      observed: {
        updated_title: updatedTitle,
        updated_summary: updatedSummary,
        updated_email: updatedEmail,
        updated_phone: updatedPhone,
        typing_trace: typingTrace,
      },
    });

    const photoInput = page.locator('input[type="file"][data-contact-photo-input="true"]').first();
    await photoInput.setInputFiles(photoPath);
    await page.waitForFunction(() => Boolean(document.querySelector(".light-contact-detail-page .light-avatar.has-photo img")), undefined, { timeout: config.timeoutMs });
    await waitForContactAutosaveSaved(page, config.timeoutMs);
    updatedRecord = await waitForContactRecord(
      config.baseUrl,
      config.apiToken,
      seed.contactId,
      record => String(record?.metadata?.photo || "").startsWith("data:image/jpeg"),
      config.timeoutMs,
      `${mode}: Expected contact edit to persist the uploaded photo`
    );
    assert(String(updatedRecord.metadata?.photo || "").trim(), `${mode}: Expected contact edit to persist the uploaded photo`);
    await page.locator('[data-contact-photo-remove="true"]').first().click();
    await page.waitForFunction(() => !document.querySelector(".light-contact-detail-page .light-avatar.has-photo img"), undefined, { timeout: config.timeoutMs });
    await waitForContactAutosaveSaved(page, config.timeoutMs);
    updatedRecord = await waitForContactRecord(
      config.baseUrl,
      config.apiToken,
      seed.contactId,
      record => !String(record?.metadata?.photo || "").trim(),
      config.timeoutMs,
      `${mode}: Expected contact edit to remove the uploaded photo`
    );
    assert(!String(updatedRecord.metadata?.photo || "").trim(), `${mode}: Expected contact edit to remove the uploaded photo`);
    const photoRemovedState = await readContactEditState(page);
    assert(photoRemovedState.avatarText === expectedInitials, `${mode}: Expected photo removal to restore initials, got ${photoRemovedState.avatarText}`);
    await recorder.capture({
      route: "contact-detail",
      action: "Add and remove contact photo",
      expected: "Adding a photo persists the preview and removing it restores initials without leaving the detail editor.",
      confirmation: "The deployed editor persisted photo add/remove correctly and restored initials after removal.",
      observed: { photo_fixture: photoPath, avatar_text_after_remove: photoRemovedState.avatarText },
    });

    await page.locator('[data-contact-detail-action="done"]').first().click();
    await page.waitForFunction(expectedTitle => {
      const pageRoot = document.querySelector(".light-contact-detail-page");
      const title = document.querySelector(".light-contact-detail-title");
      return pageRoot instanceof HTMLElement
        && pageRoot.getAttribute("data-contact-detail-mode") === "view"
        && String(title?.textContent || "").trim() === expectedTitle;
    }, updatedTitle, { timeout: config.timeoutMs });

    await clickBack(page, config.timeoutMs);
    await waitForRoute(page, "contacts", config.timeoutMs);
    await page.locator(`.light-contact-row[data-contact-id="${seed.contactId}"]`).first().waitFor({ state: "visible", timeout: config.timeoutMs });
    const editedListState = await readContactsSearchState(page);
    assert(editedListState.row_titles.includes(updatedTitle), `${mode}: Expected edited contact row to reappear with the updated title, got ${editedListState.row_titles.join(", ")}`);
    await page.locator(`.light-contact-row[data-contact-id="${seed.contactId}"]`).first().click();
    await waitForRoute(page, "contact-detail", config.timeoutMs);
    await waitForTextInBody(page, updatedTitle, config.timeoutMs);
    const reopenedState = await readContactEditState(page);
    assert(reopenedState.mode === "view", `${mode}: expected reopened detail to return in view mode, got ${reopenedState.mode}`);
    assert(reopenedState.action === "edit", `${mode}: expected reopened detail to expose the edit action, got ${reopenedState.action}`);
    assert(reopenedState.firstName === updatedFirstName, `${mode}: expected reopened detail to preserve first name, got ${reopenedState.firstName}`);
    assert(reopenedState.lastName === updatedLastName, `${mode}: expected reopened detail to preserve last name, got ${reopenedState.lastName}`);
    assert(reopenedState.summary === updatedSummary, `${mode}: expected reopened detail to preserve summary, got ${reopenedState.summary}`);
    assert(reopenedState.email === updatedEmail, `${mode}: expected reopened detail to preserve email, got ${reopenedState.email}`);
    assert(reopenedState.phone === updatedPhone, `${mode}: expected reopened detail to preserve phone, got ${reopenedState.phone}`);
    assert(!reopenedState.hasActivitySection, `${mode}: expected reopened detail to keep Activity removed`);
    assert(!reopenedState.hasPhotoPreview, `${mode}: expected reopened detail to stay initials-only after photo removal`);
    await page.reload({ waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForRoute(page, "contact-detail", config.timeoutMs);
    await waitForTextInBody(page, updatedTitle, config.timeoutMs);
    const reloadedState = await readContactEditState(page);
    assert(reloadedState.mode === "view", `${mode}: expected reloaded detail to stay in view mode, got ${reloadedState.mode}`);
    assert(reloadedState.firstName === updatedFirstName, `${mode}: Expected contact detail reload to stay on the edited contact, got ${reloadedState.firstName}`);
    assert(reloadedState.lastName === updatedLastName, `${mode}: expected reloaded detail to preserve last name, got ${reloadedState.lastName}`);
    assert(reloadedState.summary === updatedSummary, `${mode}: expected reloaded detail to preserve summary, got ${reloadedState.summary}`);
    assert(reloadedState.email === updatedEmail, `${mode}: expected reloaded detail to preserve email, got ${reloadedState.email}`);
    assert(reloadedState.phone === updatedPhone, `${mode}: expected reloaded detail to preserve phone, got ${reloadedState.phone}`);
    assert(!reloadedState.hasActivitySection, `${mode}: expected reloaded detail to keep Activity removed`);
    assert(!reloadedState.hasPhotoPreview, `${mode}: expected reloaded detail to stay initials-only after photo removal`);
    await recorder.capture({
      route: "contact-detail",
      action: "Reload saved contact detail",
      expected: "Reloading the edited contact detail stays on the same contact and keeps the autosaved values.",
      confirmation: "The reloaded contact detail stayed on the edited contact with the saved values intact.",
      observed: { updated_title: updatedTitle, reloaded_state: reloadedState },
    });
    await recorder.capture({
      route: "contacts",
      action: "Return to edited Contacts list",
      expected: "Returning to Contacts shows the edited row, and reopening detail keeps the saved values.",
      confirmation: "The edited row reappeared in Contacts and reopening detail showed the persisted autosaved values.",
      observed: { updated_title: updatedTitle, contacts_search: editedListState, reopened_state: reopenedState },
    });

    await clickBack(page, config.timeoutMs);
    await waitForRoute(page, "contacts", config.timeoutMs);
    const davidOnlySearchState = await expectContactsSearchRowsContaining(page, "David", [seed.davidContactId], config.timeoutMs);
    assert(
      !davidOnlySearchState.row_ids.includes(seed.danielContactId),
      `${mode}: expected David search to exclude Daniel, got ${davidOnlySearchState.row_ids.join(", ")}`
    );
    await page.locator(`.light-contact-row[data-contact-id="${seed.davidContactId}"]`).first().click();
    await waitForRoute(page, "contact-detail", config.timeoutMs);
    await waitForTextInBody(page, "David", config.timeoutMs);
    const emptyConnectedState = await readContactEditState(page);
    assert(!emptyConnectedState.hasActivitySection, `${mode}: expected unlinked contact detail to omit the Activity section`);
    assert(!emptyConnectedState.hasConnectedSection, `${mode}: expected unlinked contact detail to omit Connected entirely`);
    await goHome(page, config);
  }

  return {
    steps: recorder.steps,
    screenshots: recorder.screenshots,
    page_url: buildRouteUrl(config, "home"),
  };
}

async function runProofMode(browser, config, mode, seed, runtimeMeeting = null) {
  const viewport = mode === "iphone"
    ? { width: 390, height: 844 }
    : mode === "android"
      ? { width: 412, height: 915 }
      : mode === "mobile"
        ? { width: 430, height: 932 }
        : { width: 1440, height: 900 };
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    hasTouch: mode !== "desktop",
    isMobile: mode !== "desktop",
  });
  await context.addInitScript(() => {
    try {
      const bootKey = "pucky.cover.live_user_session_bootstrap.v1";
      if (!sessionStorage.getItem(bootKey)) {
        localStorage.removeItem("pucky.cover.nav_state.v1");
        localStorage.removeItem("pucky.cover.browser_device_id.v1");
        sessionStorage.setItem(bootKey, "1");
      }
    } catch (_error) {
      // Ignore localStorage bootstrap failures in proof mode.
    }
  });
  await installAuthorizedApiProxy(context, config.baseUrl, config.apiToken);

  const page = await context.newPage();
  const consoleLogPath = path.join(config.reportDir, `${mode}.console.log`);
  const tracking = buildPageTracking(page, consoleLogPath);
  try {
    logStep(config, `${mode}: starting live user session route tour`);
    const result = await runRouteTour(page, config, mode, seed, runtimeMeeting);
    const pageErrors = tracking.pageErrors.slice();
    const badConsole = seriousConsoleErrors(tracking.consoleErrors);
    const badRequests = seriousFailedRequests(tracking.failedRequests, config.baseUrl);
    const badResponses = seriousHttpErrorResponses(tracking.httpErrorResponses, config.baseUrl);
    assert(pageErrors.length === 0, `${mode}: unexpected page errors: ${JSON.stringify(pageErrors)}`);
    assert(badConsole.length === 0, `${mode}: unexpected console errors: ${JSON.stringify(badConsole)}`);
    assert(badRequests.length === 0, `${mode}: unexpected failed requests: ${JSON.stringify(badRequests)}`);
    assert(badResponses.length === 0, `${mode}: unexpected HTTP error responses: ${JSON.stringify(badResponses)}`);
    return {
      mode,
      page_url: result.page_url,
      steps: result.steps,
      screenshots: result.screenshots,
      console_log: consoleLogPath,
      page_errors: pageErrors,
      console_errors: tracking.consoleErrors,
      failed_requests: tracking.failedRequests,
      http_error_responses: tracking.httpErrorResponses,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function proveRuntimeMeetingTerminal(browser, config, runtimeMeeting) {
  const viewport = { width: 430, height: 932 };
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    hasTouch: true,
    isMobile: true,
  });
  await installAuthorizedApiProxy(context, config.baseUrl, config.apiToken);
  const page = await context.newPage();
  const consoleLogPath = path.join(config.reportDir, "runtime-terminal.console.log");
  const tracking = buildPageTracking(page, consoleLogPath);
  const screenshots = {};
  try {
    const meetingId = String(runtimeMeeting?.meetingId || "").trim();
    const meetingTitle = normalizeText(runtimeMeeting?.title || meetingId);
    assert(meetingId, "Runtime meeting proof is missing meetingId");
    assert(String(runtimeMeeting?.state || "").trim().toLowerCase() === "completed", `Runtime meeting ${meetingId} did not complete successfully for note-first verification (state ${runtimeMeeting?.state || ""}).`);

    const meetingsUrl = buildRouteUrl(config, "meetings", "light");
    await gotoAndWaitForRoute(page, meetingsUrl, "meetings", config.timeoutMs);
    await waitForMeetingsReady(page, config.timeoutMs);
    const meetingCard = page.locator(`article[data-card-session-id="${meetingId}"] .card-body`).first();
    await meetingCard.waitFor({ state: "visible", timeout: config.timeoutMs });
    screenshots.meetings_terminal = await saveScreenshot(page, config.reportDir, "runtime-meetings-terminal");
    await meetingCard.click();
    await waitForDetailOpen(page, config.timeoutMs);
    const meetingDetail = await readMeetingRuntimeDetailState(page);
    assert(meetingDetail.connectedSectionCount === 1, "Completed runtime meeting detail should render a Connected section.");
    assert(meetingDetail.connectedIsFlat, "Completed runtime meeting detail should render a flat Connected feed shell.");
    assert(meetingDetail.connectedRowCount > 0, "Completed runtime meeting detail should render at least one connected row.");
    assert(meetingDetail.noteRowCount >= 1, "Completed runtime meeting detail should render a regular note as a connected row.");
    assert(meetingDetail.connectedRoutes[0] === "note-detail", `Completed runtime meeting should put the merged note first in Connected (saw ${meetingDetail.connectedRoutes[0] || "<missing>"}).`);
    assert(meetingDetail.connectedChevronCount === 0, "Completed runtime meeting Connected feed should omit chevrons.");
    assert(meetingDetail.connectedChipCount === 0, "Completed runtime meeting Connected feed should omit pills.");
    screenshots.meeting_detail_connected = await saveScreenshot(page, config.reportDir, "runtime-meeting-detail-connected");

    const noteRow = page.locator('#detail .light-linked-records-section[data-linked-records-title="connected"] [data-workspace-target-route="note-detail"]').first();
    await noteRow.waitFor({ state: "visible", timeout: config.timeoutMs });
    await noteRow.click();
    await waitForRoute(page, "note-detail", config.timeoutMs);
    await waitForTextInBody(page, meetingTitle, config.timeoutMs);
    screenshots.meeting_note_open = await saveScreenshot(page, config.reportDir, "runtime-meeting-note-open");
    await clickBack(page, config.timeoutMs);
    await waitForRoute(page, "meetings", config.timeoutMs);
    await waitForDetailOpen(page, config.timeoutMs);
    await closeDetailPanel(page, config.timeoutMs);

    const notesUrl = buildRouteUrl(config, "notes", "light");
    await gotoAndWaitForRoute(page, notesUrl, "notes", config.timeoutMs);
    await waitForNotesListReady(page, config.timeoutMs);
    await waitForTextInBody(page, meetingTitle, config.timeoutMs);
    screenshots.notes_list = await saveScreenshot(page, config.reportDir, "runtime-notes-list");

    const meetingNotesUrl = buildRouteUrl(config, "meeting-notes", "light");
    await gotoAndWaitForRoute(page, meetingNotesUrl, "meeting-notes", config.timeoutMs);
    await waitForMeetingNotesListReady(page, config.timeoutMs);
    const meetingNotesTexts = await page.locator(".light-graph-row").evaluateAll(nodes =>
      nodes.map(node => String(node.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)
    ).catch(() => []);
    assert(!meetingNotesTexts.some(text => text === meetingTitle), "Captured runtime meeting note should live in Notes only and not leak into Meeting Notes.");

    const inboxUrl = buildRouteUrl(config, "inbox", "light");
    await gotoAndWaitForRoute(page, inboxUrl, "inbox", config.timeoutMs);
    await waitForInboxReady(page, config.timeoutMs);
    const inboxCard = page.locator(`article[data-card-session-id="${meetingId}"] .card-body`).first();
    await inboxCard.waitFor({ state: "visible", timeout: config.timeoutMs });
    const inlinePageActions = await page.locator('.light-shell[data-light-route="inbox"] [data-card-action="page"], .light-shell[data-light-route="inbox"] [data-card-action="attachment"]').count();
    assert(inlinePageActions === 0, `Inbox compact cards should not render page/paperclip actions after the graph-first cutover (found ${inlinePageActions}).`);
    screenshots.inbox_terminal = await saveScreenshot(page, config.reportDir, "runtime-inbox-terminal");
    await inboxCard.click();
    await waitForDetailOpen(page, config.timeoutMs);
    const inboxDetail = await readInboxConnectedDetailState(page);
    assert(inboxDetail.connectedChipLabels.length > 0, "Inbox transcript detail should render inline connected record chips for the runtime meeting.");
    assert(inboxDetail.legacyArtifactLabels.length === 0, `Inbox transcript detail should hide legacy meeting summary/transcript artifacts once the connected note exists (saw ${JSON.stringify(inboxDetail.legacyArtifactLabels)}).`);
    screenshots.inbox_detail_connected = await saveScreenshot(page, config.reportDir, "runtime-inbox-detail-connected");
    const inlineNoteChip = page.locator('#detail .bubble-connected-record-row [data-workspace-target-route="note-detail"]').first();
    await inlineNoteChip.waitFor({ state: "visible", timeout: config.timeoutMs });
    await inlineNoteChip.click();
    await waitForRoute(page, "note-detail", config.timeoutMs);
    await waitForTextInBody(page, meetingTitle, config.timeoutMs);
    await clickBack(page, config.timeoutMs);
    await waitForRoute(page, "inbox", config.timeoutMs);
    await waitForDetailOpen(page, config.timeoutMs);
    await closeDetailPanel(page, config.timeoutMs);

    const pageErrors = tracking.pageErrors.slice();
    const badConsole = seriousConsoleErrors(tracking.consoleErrors);
    const badRequests = seriousFailedRequests(tracking.failedRequests, config.baseUrl);
    const badResponses = seriousHttpErrorResponses(tracking.httpErrorResponses, config.baseUrl);
    assert(pageErrors.length === 0, `runtime terminal proof: unexpected page errors: ${JSON.stringify(pageErrors)}`);
    assert(badConsole.length === 0, `runtime terminal proof: unexpected console errors: ${JSON.stringify(badConsole)}`);
    assert(badRequests.length === 0, `runtime terminal proof: unexpected failed requests: ${JSON.stringify(badRequests)}`);
    assert(badResponses.length === 0, `runtime terminal proof: unexpected HTTP error responses: ${JSON.stringify(badResponses)}`);

    return {
      page_url: meetingsUrl,
      meeting_id: meetingId,
      meeting_title: meetingTitle,
      screenshots,
      meeting_detail: meetingDetail,
      inbox_detail: inboxDetail,
      meeting_notes_texts: meetingNotesTexts,
      console_log: consoleLogPath,
      page_errors: pageErrors,
      console_errors: tracking.consoleErrors,
      failed_requests: tracking.failedRequests,
      http_error_responses: tracking.httpErrorResponses,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

function renderReport(summary) {
  const lines = [
    "# Live User Session Browser Proof",
    "",
    `- Schema: ${summary.schema}`,
    `- Base URL: ${summary.base_url}`,
    `- Requested routes: ${summary.requested_routes.length ? summary.requested_routes.join(", ") : "all"}`,
    `- Manifest URL: ${summary.manifest_url}`,
    `- Source commit: ${summary.source_commit_full}`,
    `- UI version: ${summary.ui_version}`,
    `- Cleanup ok: ${summary.cleanup_ok}`,
    `- Universal feed tile acceptance routes: ${summary.universal_feed_tile_routes.join(", ")}`,
  ];
  if (summary.runtime_meeting?.title) {
    lines.push(`- Runtime meeting title: ${summary.runtime_meeting.title}`);
    lines.push(`- Runtime meeting id: ${summary.runtime_meeting.meetingId || ""}`);
    lines.push(`- Archived meetings before proof: ${(summary.runtime_meeting.archivedMeetingIds || []).length}`);
  }
  if (summary.runtime_terminal) {
    lines.push(`- Runtime terminal note-first proof: ok`);
  }
  if (summary.cleanup_error) {
    lines.push(`- Cleanup error: ${summary.cleanup_error}`);
  }
  for (const lane of Array.isArray(summary.proof_modes) && summary.proof_modes.length ? summary.proof_modes : ["mobile", "desktop"]) {
    const result = summary[lane];
    if (!result) {
      continue;
    }
    lines.push("", `## ${lane[0].toUpperCase()}${lane.slice(1)}`, "");
    lines.push(`- Start URL: ${result.page_url}`);
    lines.push(`- Console errors: ${(result.console_errors || []).length}`);
    lines.push(`- Page errors: ${(result.page_errors || []).length}`);
    lines.push(`- Failed requests: ${(result.failed_requests || []).length}`);
    lines.push(`- HTTP error responses: ${(result.http_error_responses || []).length}`);
    for (const step of result.steps || []) {
      const shot = path.basename(String(step.screenshot || ""));
      lines.push(
        `- ${step.step_id}: ${step.action}. Expected: ${step.expected} Confirmation: ${step.confirmation} Screenshot: [${shot}](${shot})`
      );
    }
    if (Array.isArray(result.failed_requests) && result.failed_requests.length) {
      lines.push("", "### Failed Requests", "");
      for (const entry of result.failed_requests) {
        lines.push(`- ${entry.resource_type || "resource"} ${entry.method || "GET"} ${entry.url} :: ${entry.failure || "failed"}`);
      }
    }
    if (Array.isArray(result.http_error_responses) && result.http_error_responses.length) {
      lines.push("", "### HTTP Error Responses", "");
      for (const entry of result.http_error_responses) {
        lines.push(`- ${entry.status || 0} ${entry.resource_type || "resource"} ${entry.url}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  fs.rmSync(config.reportDir, { recursive: true, force: true });
  ensureDir(config.reportDir);
  if (!String(config.apiToken || "").trim()) {
    throw new Error("Live user session proof requires --api-token or PUCKY_LIVE_USER_SESSION_TOKEN/PUCKY_OPERATOR_TOKEN/PUCKY_API_TOKEN");
  }
  const gitState = localGitState();
  config.refreshKey = gitState.headShort || `manual-${Date.now()}`;
  logStep(config, `starting live user session proof against ${config.baseUrl}`);

  let browser = null;
  let seed = null;
  let remoteManifestResult = null;
  let mobile = null;
  let desktop = null;
  let iphone = null;
  let android = null;
  let runtimeMeeting = null;
  let runtimeTerminal = null;
  let pendingError = null;
  let cleanupOk = true;
  let cleanupError = "";
  const contactEditOnly = Array.isArray(config.routes)
    && config.routes.length === 1
    && config.routes[0] === "contact-edit";

  try {
    const chromium = await loadChromium();
    browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
    remoteManifestResult = await fetchRemoteManifest(config.baseUrl, config.refreshKey);
    seed = await seedTaskProofWorkspace(config.baseUrl, config.apiToken, config.runId, {
      cleanupFirst: true,
      reportDir: config.reportDir,
    });
    if (!contactEditOnly) {
      runtimeMeeting = await prepareRuntimeMeeting(config.baseUrl, config.apiToken, config.runId, config.timeoutMs);
    }
    if (contactEditOnly) {
      desktop = await runProofMode(browser, config, "desktop", seed, runtimeMeeting);
      await restoreTaskProofSeed(config.baseUrl, config.apiToken, seed);
      iphone = await runProofMode(browser, config, "iphone", seed, runtimeMeeting);
      await restoreTaskProofSeed(config.baseUrl, config.apiToken, seed);
      android = await runProofMode(browser, config, "android", seed, runtimeMeeting);
    } else {
      mobile = await runProofMode(browser, config, "mobile", seed, runtimeMeeting);
      await restoreTaskProofSeed(config.baseUrl, config.apiToken, seed);
      desktop = await runProofMode(browser, config, "desktop", seed, runtimeMeeting);
      runtimeMeeting = await finalizeRuntimeMeeting(config.baseUrl, config.apiToken, runtimeMeeting, config.timeoutMs);
      runtimeTerminal = await proveRuntimeMeetingTerminal(browser, config, runtimeMeeting);
    }
  } catch (error) {
    pendingError = error;
  } finally {
    if (seed && !config.keepSeed) {
      try {
        await cleanupTaskProofSeed(config.baseUrl, config.apiToken, seed);
      } catch (error) {
        cleanupOk = false;
        cleanupError = error?.message || String(error);
        if (!pendingError) {
          pendingError = error;
        }
      }
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  if (pendingError) {
    writeAutomationError(config.reportDir, pendingError);
    if (cleanupError) {
      fs.appendFileSync(path.join(config.reportDir, "automation-error.txt"), `cleanup_error=${cleanupError}\n`, "utf8");
    }
    throw pendingError;
  }

  const summary = {
    schema: RESULT_SCHEMA,
    ok: true,
    report_dir: config.reportDir,
    base_url: config.baseUrl,
    manifest_url: remoteManifestResult.manifestUrl,
    remote_manifest: remoteManifestResult.manifest,
    source_commit_full: String(remoteManifestResult.manifest?.source_commit_full || gitState.head || ""),
    source_commit_short: String(remoteManifestResult.manifest?.source_commit_short || gitState.headShort || ""),
    ui_version: String(remoteManifestResult.manifest?.ui_version || ""),
    refresh_key: config.refreshKey,
    seed_manifest_path: seed?.seed_manifest_path || "",
    cleanup_ok: config.keepSeed ? true : cleanupOk,
    cleanup_error: cleanupError || "",
    cleanup_skipped: Boolean(config.keepSeed),
    requested_routes: Array.isArray(config.routes) ? config.routes.slice() : [],
    proof_modes: contactEditOnly ? ["desktop", "iphone", "android"] : ["mobile", "desktop"],
    universal_feed_tile_routes: UNIVERSAL_FEED_TILE_ROUTES.slice(),
    runtime_meeting: runtimeMeeting,
    runtime_terminal: runtimeTerminal,
    mobile,
    desktop,
    iphone,
    android,
  };
  writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  fs.writeFileSync(path.join(config.reportDir, "report.md"), renderReport(summary), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
