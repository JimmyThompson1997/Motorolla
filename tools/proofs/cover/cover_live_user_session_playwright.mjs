import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assert,
  cleanupTaskProofSeed,
  logStep,
  restoreTaskProofSeed,
  seedTaskProofWorkspace,
} from "../../support/task_workspace_proof_shared.mjs";
import {
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
    try {
      const resolved = require.resolve("playwright-core", { paths: [candidate] });
      const mod = await import(pathToFileURL(resolved).href);
      const chromium = mod?.chromium || mod?.default?.chromium;
      if (chromium) {
        return chromium;
      }
    } catch (_error) {
      // Try next candidate.
    }
  }
  throw new Error("Could not resolve playwright-core from bundled or local node_modules");
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

function buildTracking(page, consoleLogPath) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", message => {
    fs.appendFileSync(consoleLogPath, `[console:${message.type()}] ${message.text()}\n`, "utf8");
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", error => {
    const text = error?.message || String(error);
    fs.appendFileSync(consoleLogPath, `[pageerror] ${text}\n`, "utf8");
    pageErrors.push(text);
  });
  return { consoleErrors, pageErrors };
}

function seriousConsoleErrors(messages) {
  const patterns = [
    /\b401\b/i,
    /forbidden/i,
    /cannot read/i,
    /is not a function/i,
    /referenceerror/i,
    /syntaxerror/i,
    /typeerror/i,
    /undefined/i,
    /unhandled/i,
  ];
  return messages.filter(message => patterns.some(pattern => pattern.test(String(message || ""))));
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
    return Array.from(document.querySelectorAll(".empty")).some(node =>
      /No replies yet\.|Could not load the Home feed\./i.test(String(node.textContent || ""))
    );
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

async function readTaskFilterSelectorState(page) {
  return page.evaluate(() => {
    const task_filter_selector_options = Array.from(document.querySelectorAll(".settings-selector-option")).map(option => {
      const leading = option.querySelector(".settings-selector-option-leading");
      return {
        value: String(option.getAttribute("data-selector-value") || ""),
        label: String(option.querySelector(".settings-selector-option-label")?.textContent || "").trim(),
        meta: String(option.querySelector(".settings-selector-option-meta")?.textContent || "").trim(),
        has_leading_visual: Boolean(
          leading
          && (
            leading.children.length > 0
            || leading.querySelector("svg, .light-check-circle")
            || String(leading.textContent || "").trim()
          )
        ),
      };
    });
    return {
      theme: String(
        document.querySelector(".app-shell")?.getAttribute("data-theme")
        || new URL(window.location.href).searchParams.get("theme")
        || ""
      ),
      selector_option_count: task_filter_selector_options.length,
      task_filter_selector_options,
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

function assertTaskFilterSelectorLeadingVisuals(state, context) {
  const expectedValues = ["all", "todo", "in_progress", "waiting", "done"];
  assert(state.selector_option_count === expectedValues.length, `${context}: expected ${expectedValues.length} task filter selector options`);
  expectedValues.forEach(value => {
    const option = Array.isArray(state.task_filter_selector_options)
      ? state.task_filter_selector_options.find(item => String(item?.value || "") === value)
      : null;
    assert(option, `${context}: missing task filter selector option ${value}`);
    assert(option.has_leading_visual, `${context}: task filter selector option ${value} is missing its leading visual`);
  });
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

async function runRouteTour(page, config, mode, seed) {
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

  await goHome(page, config);
  await openRouteFromHome(page, "inbox", config.timeoutMs);
  await waitForInboxReady(page, config.timeoutMs);
  const feedError = await page.locator(".feed-load-error").count();
  assert(feedError === 0, `${mode}: inbox route reported a feed load error`);
  const inboxCards = page.locator("article[data-card-id] .card-body");
  if (await inboxCards.count()) {
    const firstTitle = normalizeText(await page.locator("article[data-card-id] .title").first().textContent());
    await inboxCards.first().click();
    await waitForDetailOpen(page, config.timeoutMs);
    const detailTitle = normalizeText(await page.locator("#detail .light-page-title").last().textContent().catch(() => ""));
    await recorder.capture({
      route: "inbox",
      action: "Open first inbox card",
      expected: "The first inbox card opens its detail panel.",
      confirmation: "Inbox detail panel opened.",
      observed: { empty: false, first_card_title: firstTitle, detail_title: detailTitle },
    });
    await closeDetailPanel(page, config.timeoutMs);
  } else {
    const emptyText = normalizeText(await page.locator(".empty").first().textContent().catch(() => "No replies yet."));
    await recorder.capture({
      route: "inbox",
      action: "Check empty inbox state",
      expected: "An empty inbox is reported honestly when no live cards are available.",
      confirmation: "Inbox empty state was shown.",
      observed: { empty: true, message: emptyText },
    });
  }

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

  await goHome(page, config);
  await openRouteFromHome(page, "meetings", config.timeoutMs);
  await waitForMeetingsReady(page, config.timeoutMs);
  const meetingsError = await page.locator(".meetings-empty.is-error").count();
  assert(meetingsError === 0, `${mode}: meetings route reported an error`);
  const meetingCards = page.locator("article[data-card-session-id] .card-body");
  if (await meetingCards.count()) {
    const firstTitle = normalizeText(await page.locator("article[data-card-session-id] .title").first().textContent());
    await meetingCards.first().click();
    await waitForDetailOpen(page, config.timeoutMs);
    const detailTitle = normalizeText(await page.locator("#detail .light-page-title").last().textContent().catch(() => ""));
    await recorder.capture({
      route: "meetings",
      action: "Open first meeting record",
      expected: "The first meeting record opens its detail panel.",
      confirmation: "Meeting detail panel opened.",
      observed: { empty: false, first_meeting_title: firstTitle, detail_title: detailTitle },
    });
    await closeDetailPanel(page, config.timeoutMs);
  } else {
    const emptyText = normalizeText(await page.locator(".meetings-empty").first().textContent().catch(() => "No meeting recordings yet."));
    assert(!/loading meetings/i.test(emptyText), `${mode}: meetings route never resolved past loading`);
    await recorder.capture({
      route: "meetings",
      action: "Check empty meetings state",
      expected: "An empty meetings surface is reported honestly when no recordings exist.",
      confirmation: "Meetings empty state was shown.",
      observed: { empty: true, message: emptyText },
    });
  }

  await goHome(page, config);
  await openRouteFromHome(page, "meeting-notes", config.timeoutMs);
  await waitForSeededMeetingNote(page, seed, config.timeoutMs);
  await page.locator(`.light-graph-row[data-record-id="${seed.meetingNoteId}"]`).first().click();
  await waitForRoute(page, "meeting-note-detail", config.timeoutMs);
  await waitForTextInBody(page, seed.meetingNoteTitle, config.timeoutMs);
  await recorder.capture({
    route: "meeting-note-detail",
    action: "Open seeded meeting note detail",
    expected: "The seeded meeting note opens from the Meeting Notes route.",
    confirmation: "Seeded meeting note detail opened.",
    observed: { meeting_note_title: seed.meetingNoteTitle },
  });

  await goHome(page, config);
  await openRouteFromHome(page, "reminders", config.timeoutMs);
  await waitForSeededReminder(page, seed, config.timeoutMs);
  await page.locator(`.light-reminder-row[data-reminder-id="${seed.reminderId}"]`).first().click();
  await waitForRoute(page, "reminder-detail", config.timeoutMs);
  await waitForTextInBody(page, seed.reminderTitle, config.timeoutMs);
  await recorder.capture({
    route: "reminder-detail",
    action: "Open seeded reminder detail",
    expected: "The seeded reminder opens from the Reminders route.",
    confirmation: "Seeded reminder detail opened.",
    observed: { reminder_title: seed.reminderTitle },
  });

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

  await page.goto(buildRouteUrl(config, "tasks", "dark"), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForRoute(page, "tasks", config.timeoutMs);
  await waitForSeededTask(page, seed, config.timeoutMs);
  await page.locator(".light-task-filter-button").first().click();
  await page.locator(".settings-selector-sheet").first().waitFor({ state: "visible", timeout: config.timeoutMs });
  const darkTaskFilterSelectorState = await readTaskFilterSelectorState(page);
  assertTaskFilterSelectorLeadingVisuals(darkTaskFilterSelectorState, `${mode}: dark task filter selector`);
  await recorder.capture({
    route: "tasks",
    action: "Open dark task filter selector",
    expected: "Opening the task filter sheet in dark mode shows leading visuals for All, To do, In progress, Waiting, and Done.",
    confirmation: "Task filter selector renders leading visuals for every task category in dark mode.",
    observed: darkTaskFilterSelectorState,
  });
  await page.locator('.settings-selector-option[data-selector-value="all"]').first().click();
  await waitForSeededTask(page, seed, config.timeoutMs);

  await page.goto(buildRouteUrl(config, "tasks", "light"), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForRoute(page, "tasks", config.timeoutMs);
  await waitForSeededTask(page, seed, config.timeoutMs);
  await page.locator(".light-task-filter-button").first().click();
  await page.locator(".settings-selector-sheet").first().waitFor({ state: "visible", timeout: config.timeoutMs });
  const lightTaskFilterSelectorState = await readTaskFilterSelectorState(page);
  assertTaskFilterSelectorLeadingVisuals(lightTaskFilterSelectorState, `${mode}: light task filter selector`);
  await recorder.capture({
    route: "tasks",
    action: "Open light task filter selector",
    expected: "Opening the task filter sheet in light mode shows leading visuals for All, To do, In progress, Waiting, and Done.",
    confirmation: "Task filter selector renders leading visuals for every task category in light mode.",
    observed: lightTaskFilterSelectorState,
  });
  await page.locator('.settings-selector-option[data-selector-value="all"]').first().click();
  await waitForSeededTask(page, seed, config.timeoutMs);

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

  const incompleteChecklistIds = Array.isArray(seed.primaryChecklist)
    ? seed.primaryChecklist.filter(item => item && item.done !== true).map(item => String(item.id || ""))
    : [];
  assert(incompleteChecklistIds.length >= 2, `${mode}: expected at least two incomplete checklist items in the seeded task`);
  await page.locator(`.light-task-checklist-row[data-checklist-item-id="${incompleteChecklistIds[0]}"]`).first().click();
  await waitForTaskDetailStatus(page, "in_progress", config.timeoutMs);
  await page.locator(`.light-task-checklist-row[data-checklist-item-id="${incompleteChecklistIds[1]}"]`).first().click();
  await waitForTaskDetailStatus(page, "done", config.timeoutMs);
  const taskStateAfterChecklistDone = await readTaskDetailState(page);
  const taskRecordAfterChecklistDone = await fetchTaskRecord(config.baseUrl, seed.primaryTaskId, config.refreshKey);
  assert(taskStateAfterChecklistDone.task_status === "done", `${mode}: completing the final checklist item should mark the task done in the DOM`);
  assert(taskRecordAfterChecklistDone.status === "done", `${mode}: completing the final checklist item should mark the task done in the API`);
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
  const taskRecordAfterChecklistReopen = await fetchTaskRecord(config.baseUrl, seed.primaryTaskId, config.refreshKey);
  assert(taskStateAfterChecklistReopen.task_status === "in_progress", `${mode}: unchecking a completed checklist item should reopen the task in the DOM`);
  assert(taskRecordAfterChecklistReopen.status === "in_progress", `${mode}: unchecking a completed checklist item should reopen the task in the API`);
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
  const taskRecord = await fetchTaskRecord(config.baseUrl, seed.primaryTaskId, config.refreshKey);
  assert(taskState.task_status === "done", `${mode}: task detail did not keep Done after reload`);
  assert(taskRecord.status === "done", `${mode}: task API did not persist Done after reload`);
  assert(!taskState.task_html_frame_present, `${mode}: task detail should stay free of embedded HTML after reload`);
  assert(taskState.description_is_first_section, `${mode}: task detail should still start with Description after reload`);
  assert(taskState.checklist_immediately_after_description, `${mode}: task detail should keep Checklist directly after Description after reload`);
  assert(taskState.header_created_meta, `${mode}: task detail should keep compact created metadata after reload`);
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

  await goHome(page, config);
  await openRouteFromHome(page, "projects", config.timeoutMs);
  await waitForSeededProject(page, seed, config.timeoutMs);
  await page.locator(`.light-project-row[data-project-id="${seed.projectId}"]`).first().click();
  await waitForRoute(page, "project-detail", config.timeoutMs);
  await waitForTextInBody(page, seed.projectTitle, config.timeoutMs);
  await recorder.capture({
    route: "project-detail",
    action: "Open seeded project detail",
    expected: "The seeded project opens from the Projects route.",
    confirmation: "Seeded project detail opened.",
    observed: { project_title: seed.projectTitle },
  });

  await goHome(page, config);
  await openRouteFromHome(page, "contacts", config.timeoutMs);
  await waitForSeededContact(page, seed, config.timeoutMs);
  await page.locator(`.light-contact-row[data-contact-id="${seed.contactId}"]`).first().click();
  await waitForRoute(page, "contact-detail", config.timeoutMs);
  await waitForTextInBody(page, seed.contactTitle, config.timeoutMs);
  await recorder.capture({
    route: "contact-detail",
    action: "Open seeded contact detail",
    expected: "The seeded contact opens from the Contacts route.",
    confirmation: "Seeded contact detail opened.",
    observed: { contact_title: seed.contactTitle },
  });

  return {
    steps: recorder.steps,
    screenshots: recorder.screenshots,
    page_url: buildRouteUrl(config, "home"),
  };
}

async function runProofMode(browser, config, mode, seed) {
  const viewport = mode === "mobile"
    ? { width: 430, height: 932 }
    : { width: 1400, height: 1000 };
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    hasTouch: mode === "mobile",
    isMobile: mode === "mobile",
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

  const page = await context.newPage();
  const consoleLogPath = path.join(config.reportDir, `${mode}.console.log`);
  const tracking = buildTracking(page, consoleLogPath);
  try {
    logStep(config, `${mode}: starting live user session route tour`);
    const result = await runRouteTour(page, config, mode, seed);
    const pageErrors = tracking.pageErrors.slice();
    const badConsole = seriousConsoleErrors(tracking.consoleErrors);
    assert(pageErrors.length === 0, `${mode}: unexpected page errors: ${JSON.stringify(pageErrors)}`);
    assert(badConsole.length === 0, `${mode}: unexpected console errors: ${JSON.stringify(badConsole)}`);
    return {
      mode,
      page_url: result.page_url,
      steps: result.steps,
      screenshots: result.screenshots,
      console_log: consoleLogPath,
      page_errors: pageErrors,
      console_errors: tracking.consoleErrors,
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
    `- Manifest URL: ${summary.manifest_url}`,
    `- Source commit: ${summary.source_commit_full}`,
    `- UI version: ${summary.ui_version}`,
    `- Cleanup ok: ${summary.cleanup_ok}`,
    `- Universal feed tile acceptance routes: ${summary.universal_feed_tile_routes.join(", ")}`,
  ];
  if (summary.cleanup_error) {
    lines.push(`- Cleanup error: ${summary.cleanup_error}`);
  }
  for (const lane of ["mobile", "desktop"]) {
    const result = summary[lane];
    lines.push("", `## ${lane[0].toUpperCase()}${lane.slice(1)}`, "");
    lines.push(`- Start URL: ${result.page_url}`);
    for (const step of result.steps || []) {
      const shot = path.basename(String(step.screenshot || ""));
      lines.push(
        `- ${step.step_id}: ${step.action}. Expected: ${step.expected} Confirmation: ${step.confirmation} Screenshot: [${shot}](${shot})`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
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
  let pendingError = null;
  let cleanupOk = true;
  let cleanupError = "";

  try {
    const chromium = await loadChromium();
    browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
    remoteManifestResult = await fetchRemoteManifest(config.baseUrl, config.refreshKey);
    seed = await seedTaskProofWorkspace(config.baseUrl, config.apiToken, config.runId, {
      cleanupFirst: true,
      reportDir: config.reportDir,
    });
    mobile = await runProofMode(browser, config, "mobile", seed);
    await restoreTaskProofSeed(config.baseUrl, config.apiToken, seed);
    desktop = await runProofMode(browser, config, "desktop", seed);
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
    universal_feed_tile_routes: UNIVERSAL_FEED_TILE_ROUTES.slice(),
    mobile,
    desktop,
  };
  writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  fs.writeFileSync(path.join(config.reportDir, "report.md"), renderReport(summary), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
