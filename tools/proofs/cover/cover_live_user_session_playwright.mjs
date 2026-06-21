import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assert,
  cleanupTaskProofSeed,
  logStep,
  seedTaskProofWorkspace,
} from "../../support/task_workspace_proof_shared.mjs";
import {
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile,
} from "../../support/cover_shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
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
  "tags",
  "contacts",
];
const UNIVERSAL_FEED_TILE_ROUTES = [
  "inbox",
  "meetings",
  "meeting-notes",
  "reminders",
  "notes",
  "tags",
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
    label: "tag",
    route: "tag-detail",
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
  const webToken = String(process.env.PUCKY_WEB_UI_TOKEN || "").trim();
  if (webToken) {
    return webToken;
  }
  const proofToken = String(process.env.PUCKY_LIVE_USER_SESSION_TOKEN || "").trim();
  if (proofToken) {
    return proofToken;
  }
  const operatorToken = String(process.env.PUCKY_OPERATOR_TOKEN || "").trim();
  if (operatorToken) {
    return operatorToken;
  }
  return String(process.env.PUCKY_API_TOKEN || "").trim();
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

function buildRouteUrl(config, route) {
  const url = new URL("/ui/pucky/latest/index.html", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  url.searchParams.set("theme", "light");
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
    return {
      route: shell?.getAttribute("data-light-route") || "",
      search_visible: Boolean(search),
      query: search instanceof HTMLInputElement ? search.value : "",
      row_ids: rows.map(node => String(node.getAttribute("data-contact-id") || "").trim()).filter(Boolean),
      row_titles: rows
        .map(node => String(node.querySelector(".light-text-stack strong")?.textContent || "").trim())
        .filter(Boolean),
      empty_text: String(empty?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });
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
    const peopleSection = infoSection("people");
    const attachedSection = infoSection("attached");
    return {
      route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
      task_detail_id: detail?.getAttribute("data-task-detail-id") || "",
      task_status: detail?.getAttribute("data-task-status") || "",
      title: String(detail?.querySelector(".light-task-detail-title")?.textContent || "").trim(),
      sections: Array.from(document.querySelectorAll(".light-section-title"))
        .map(node => String(node.textContent || "").trim().toLowerCase()),
      people: Array.from(peopleSection?.querySelectorAll('.light-info-row[data-task-person-role] .light-text-stack strong') || [])
        .map(node => String(node.textContent || "").trim()),
      checklist: Array.from(detail?.querySelectorAll(".light-task-checklist-label") || [])
        .map(node => String(node.textContent || "").trim()),
      notes: Array.from(detail?.querySelectorAll('[data-workspace-target-route="note-detail"] .light-text-stack strong') || [])
        .map(node => String(node.textContent || "").trim()),
      attachments: Array.from(attachedSection?.querySelectorAll('.light-info-row[data-task-attachment-kind] .light-text-stack strong') || [])
        .map(node => String(node.textContent || "").trim()),
      description: String(Array.from(document.querySelectorAll(".light-copy-section"))
        .find(node => /description/i.test(String(node.textContent || "")))?.textContent || "").trim(),
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
    expected: "Launcher tiles for inbox, meetings, meeting notes, reminders, connect, settings, notes, tasks, calendar, tags, and contacts are visible.",
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
    await goHome(page, config);
    await openRouteFromHome(page, "tasks", config.timeoutMs);
    await waitForSeededTask(page, seed, config.timeoutMs);
    await page.locator(`.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-main`).first().click();
    await waitForTaskDetail(page, seed.primaryTaskId, config.timeoutMs);
    const taskState = await readTaskDetailState(page);
    ["description", "people", "checklist", "notes", "attached"].forEach(section => {
      assert(taskState.sections.includes(section), `${mode}: task detail missing ${section} section`);
    });
    assert(taskState.people.includes(seed.contactTitle), `${mode}: task detail missing created-by contact`);
    assert(taskState.people.includes(seed.ownerContactTitle), `${mode}: task detail missing owner contact`);
    assert(taskState.notes.includes(seed.noteTitle), `${mode}: task detail missing linked note section entry`);
    assert(taskState.attachments.includes(seed.calendarEventTitle), `${mode}: task detail missing linked calendar event`);
    assert(taskState.attachments.includes(seed.contactTitle), `${mode}: task detail missing linked contact`);
    assert(taskState.attachments.includes(seed.projectTitle), `${mode}: task detail missing linked project`);
    assert(taskState.checklist.includes("Prep the room summary"), `${mode}: task detail missing expected checklist item`);
    assert(taskState.description.includes(seed.primaryDescription), `${mode}: task detail missing seeded description`);
    await recorder.capture({
      route: taskState.route || "tasks",
      action: "Open seeded task detail",
      expected: "The seeded primary task shows description, people, checklist, and attached linked records.",
      confirmation: "Task detail rendered the seeded structured sections.",
      observed: taskState,
    });

    for (const link of TASK_LINKS) {
      const targetId = seed[link.idKey];
      const targetTitle = seed[link.titleKey];
      const locator = page.locator(
        `[data-workspace-target-route="${link.route}"][data-workspace-target-id="${targetId}"]`
      ).first();
      await locator.waitFor({ state: "visible", timeout: config.timeoutMs });
      await locator.click();
      await waitForRoute(page, link.route, config.timeoutMs);
      await waitForTextInBody(page, targetTitle, config.timeoutMs);
      const pageTitle = normalizeText(await page.locator(".light-page-title").last().textContent().catch(() => targetTitle));
      if (link.route === "tag-detail" || link.route === "contact-detail") {
        await waitForTextInBody(page, seed.noteTitle, config.timeoutMs);
      }
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

  if (shouldRunRoute(config, "tags")) {
    await goHome(page, config);
    await openRouteFromHome(page, "tags", config.timeoutMs);
    await waitForSeededProject(page, seed, config.timeoutMs);
    await page.locator(`.light-project-row[data-project-id="${seed.projectId}"]`).first().click();
    await waitForRoute(page, "tag-detail", config.timeoutMs);
    await waitForTextInBody(page, seed.projectTitle, config.timeoutMs);
    await recorder.capture({
      route: "tag-detail",
      action: "Open seeded tag detail",
      expected: "The seeded tag opens from the Tags route.",
      confirmation: "Seeded tag detail opened.",
      observed: { project_title: seed.projectTitle },
    });
  }

  if (shouldRunRoute(config, "contacts")) {
    const phraseQuery = "Linked to live alpha";
    const phoneQuery = "0188";
    const reminderQuery = "reminder";
    const noMatchQuery = "zzzz-no-match";

    await goHome(page, config);
    await openRouteFromHome(page, "contacts", config.timeoutMs);
    await waitForSeededContact(page, seed, config.timeoutMs);
    const contactsListFlatness = await readContactsListFlatness(page);
    const baselineSearchState = await readContactsSearchState(page);
    const baselineRowIds = baselineSearchState.row_ids.slice();
    assert(contactsListFlatness.route === "contacts", `${mode}: expected Contacts route before detail, got ${contactsListFlatness.route}`);
    assert(contactsListFlatness.first_contact_id === "contact-me", `${mode}: Me contact should remain pinned first in Contacts (saw ${contactsListFlatness.first_contact_id || "none"})`);
    assert(baselineSearchState.search_visible, `${mode}: Contacts search should be visible once contacts load`);
    assert(baselineSearchState.query === "", `${mode}: Contacts search should start empty, got ${baselineSearchState.query}`);
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
      confirmation: "Contacts list stayed flat, exposed search, and kept Me first.",
      observed: {
        contact_title: seed.contactTitle,
        first_contact_id: contactsListFlatness.first_contact_id,
        contacts_list_flatness: contactsListFlatness,
        contacts_search: baselineSearchState,
      },
    });

    const phraseSearchState = await expectContactsSearchRows(page, phraseQuery, [seed.contactId], config.timeoutMs);
    assert(phraseSearchState.row_titles.includes(seed.contactTitle), `${mode}: phrase query should return the seeded contact, got ${phraseSearchState.row_titles.join(", ")}`);
    await recorder.capture({
      route: "contacts",
      action: "Filter Contacts by activity phrase",
      expected: "Searching by a contact activity phrase narrows the Contacts list to the matching contact.",
      confirmation: "Activity phrase filtering returned only the seeded contact.",
      observed: { query: phraseQuery, contacts_search: phraseSearchState },
    });

    const phoneSearchState = await expectContactsSearchRows(page, phoneQuery, [seed.contactId], config.timeoutMs);
    assert(phoneSearchState.row_titles.includes(seed.contactTitle), `${mode}: phone query should return the seeded contact, got ${phoneSearchState.row_titles.join(", ")}`);

    await setContactsSearchQuery(page, reminderQuery, config.timeoutMs);
    await page.waitForFunction(expectedQuery => {
      const input = document.querySelector(".light-contacts-search");
      const rowIds = Array.from(document.querySelectorAll(".light-contact-row"))
        .map(node => String(node.getAttribute("data-contact-id") || "").trim())
        .filter(Boolean);
      return input instanceof HTMLInputElement
        && input.value === expectedQuery
        && rowIds.includes("contact-me")
        && rowIds[0] === "contact-me";
    }, reminderQuery, { timeout: config.timeoutMs });
    const reminderSearchState = await readContactsSearchState(page);
    assert(reminderSearchState.row_ids[0] === "contact-me", `${mode}: reminder query should keep Me first, got ${reminderSearchState.row_ids.join(", ")}`);

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
    assert(clearedSearchState.row_ids[0] === "contact-me", `${mode}: clearing Contacts search should restore Me first, got ${clearedSearchState.row_ids[0] || "none"}`);
    await recorder.capture({
      route: "contacts",
      action: "Clear Contacts search",
      expected: "Clearing the Contacts search restores the baseline list and order immediately.",
      confirmation: "Contacts list returned to its baseline order after clearing search.",
      observed: { contacts_search: clearedSearchState },
    });

    await expectContactsSearchRows(page, phraseQuery, [seed.contactId], config.timeoutMs);
    await page.locator(`.light-contact-row[data-contact-id="${seed.contactId}"]`).first().click();
    await waitForRoute(page, "contact-detail", config.timeoutMs);
    await waitForTextInBody(page, seed.contactTitle, config.timeoutMs);
    await recorder.capture({
      route: "contact-detail",
      action: "Open seeded contact detail from filtered list",
      expected: "A filtered Contacts result still opens its contact detail normally.",
      confirmation: "Seeded contact detail opened from the filtered Contacts list.",
      observed: { contact_title: seed.contactTitle, query: phraseQuery },
    });

    await clickBack(page, config.timeoutMs);
    await waitForRoute(page, "contacts", config.timeoutMs);
    const backToFilteredState = await readContactsSearchState(page);
    assert(backToFilteredState.query === phraseQuery, `${mode}: expected Back to preserve the Contacts query, got ${backToFilteredState.query}`);
    assert(
      JSON.stringify(backToFilteredState.row_ids) === JSON.stringify([seed.contactId]),
      `${mode}: expected Back to restore the filtered Contacts list, got ${backToFilteredState.row_ids.join(", ")}`
    );
    await recorder.capture({
      route: "contacts",
      action: "Return to filtered Contacts list",
      expected: "Back from contact detail returns to the same filtered Contacts list with the same query.",
      confirmation: "Contacts Back restored the same filtered list and query.",
      observed: { query: phraseQuery, contacts_search: backToFilteredState },
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
      localStorage.removeItem("pucky.cover.nav_state.v1");
      localStorage.removeItem("pucky.cover.browser_device_id.v1");
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
    `- Requested routes: ${summary.requested_routes.length ? summary.requested_routes.join(", ") : "all"}`,
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
    throw new Error("Live user session proof requires --api-token or PUCKY_WEB_UI_TOKEN/PUCKY_LIVE_USER_SESSION_TOKEN/PUCKY_OPERATOR_TOKEN/PUCKY_API_TOKEN");
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
    requested_routes: Array.isArray(config.routes) ? config.routes.slice() : [],
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
