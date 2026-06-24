import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
loadProofRuntimeEnv({ rootDir: repoRoot });
const RESULT_SCHEMA = "pucky.hosted_bug_hunt_browser_proof.v1";
const DEFAULT_BASE_URL = process.env.PUCKY_HOSTED_BUG_HUNT_BASE_URL || "https://pucky.fly.dev";
const MOBILE_VIEWPORT = { width: 430, height: 932 };
const DESKTOP_VIEWPORT = { width: 1440, height: 980 };
const DETAIL_SELECTOR = "#detail";
const PROOF_CLASSIFICATIONS = ["keep as-is", "harden", "expand", "retire"];
const FINDING_CLASSES = [
  "functional",
  "visual",
  "content",
  "navigation",
  "state-truthfulness",
  "performance-feel",
];
const HOSTED_SEEDED_CALENDAR_EVENT_IDS = {
  today: ["roadmap", "vendor", "design-overlap", "house-walkthrough", "forster-dinner", "late-night-design-call"],
  tomorrow: ["tomorrow-demo", "clinic-checkin", "katy-handoff"],
};
const ROUTE_SWEEP_ORDER = [
  {
    surface: "Home",
    route: "home",
    primarySelector: ".light-app-tile",
    emptySelector: ".light-empty-state",
    detail: null,
    desktop: false,
    requiresHeader: false,
  },
  {
    surface: "Inbox",
    route: "inbox",
    primarySelector: "article[data-card-id], article[data-card-session-id]",
    emptySelector: ".empty, .feed-load-error",
    detail: {
      openerSelector: "article[data-card-id] .card-body, article[data-card-session-id] .card-body",
      expectedSelector: `${DETAIL_SELECTOR}[aria-hidden="false"], ${DETAIL_SELECTOR}.is-open`,
      htmlPolicy: "forbid",
    },
    desktop: false,
    requiresHeader: true,
  },
  {
    surface: "Meetings",
    route: "meetings",
    primarySelector: ".meetings-list-card article[data-card-id], .meetings-list-card article[data-card-session-id]",
    emptySelector: ".meetings-empty",
    detail: {
      openerSelector: ".meetings-list-card .card-body",
      expectedSelector: `${DETAIL_SELECTOR}[aria-hidden="false"], ${DETAIL_SELECTOR}.is-open`,
      htmlPolicy: "forbid",
    },
    desktop: false,
    requiresHeader: true,
  },
  {
    surface: "Meeting Notes",
    route: "meeting-notes",
    primarySelector: ".light-graph-row",
    emptySelector: ".light-empty-state",
    detail: {
      openerSelector: ".light-graph-row",
      expectedRoute: "meeting-note-detail",
      htmlPolicy: "forbid",
    },
    desktop: true,
    requiresHeader: true,
  },
  {
    surface: "Reminders",
    route: "reminders",
    primarySelector: ".light-reminder-row",
    emptySelector: ".light-empty-state",
    detail: {
      openerSelector: ".light-reminder-row",
      expectedRoute: "reminder-detail",
      htmlPolicy: "forbid",
    },
    desktop: false,
    requiresHeader: true,
  },
  {
    surface: "Notes",
    route: "notes",
    primarySelector: ".light-note-row",
    emptySelector: ".light-empty-state",
    detail: {
      openerSelector: ".light-note-row",
      expectedRoute: "note-detail",
      htmlPolicy: "require",
    },
    desktop: true,
    requiresHeader: true,
  },
  {
    surface: "Tasks",
    route: "tasks",
    primarySelector: ".light-task-row",
    emptySelector: ".light-empty-state",
    detail: {
      openerSelector: ".light-task-row-main",
      expectedSelector: ".light-task-detail-surface, .light-task-detail-pane [data-task-detail-id]",
      htmlPolicy: "forbid",
    },
    desktop: true,
    requiresHeader: true,
  },
  {
    surface: "Calendar",
    route: "calendar",
    primarySelector: ".light-event-block",
    emptySelector: ".light-empty-state",
    detail: {
      openerSelector: ".light-event-block",
      expectedRoute: "meeting-detail",
      htmlPolicy: "forbid",
    },
    desktop: true,
    requiresHeader: true,
  },
  {
    surface: "Projects",
    route: "projects",
    primarySelector: ".light-project-row",
    emptySelector: ".light-empty-state",
    detail: {
      openerSelector: ".light-project-row",
      expectedRoute: "project-detail",
      htmlPolicy: "forbid",
    },
    desktop: true,
    requiresHeader: true,
  },
  {
    surface: "Contacts",
    route: "contacts",
    primarySelector: ".light-contact-row",
    emptySelector: ".light-empty-state",
    detail: {
      openerSelector: ".light-contact-row",
      expectedRoute: "contact-detail",
      htmlPolicy: "forbid",
    },
    desktop: true,
    requiresHeader: true,
  },
  {
    surface: "Connect",
    route: "connect",
    primarySelector: ".links-list-card",
    emptySelector: ".links-empty:not([hidden]), .light-empty-state",
    detail: null,
    desktop: false,
    requiresHeader: true,
  },
  {
    surface: "Settings",
    route: "settings",
    primarySelector: ".light-settings-real .settings-card",
    emptySelector: ".light-empty-state",
    detail: null,
    desktop: false,
    requiresHeader: true,
  },
];
const BASELINE_PROOFS = [
  {
    id: "live_user_session",
    label: "Live user session",
    type: "backbone",
    script: "tools/proofs/cover/cover_live_user_session_playwright.mjs",
    requiresToken: true,
    args: (config, reportDir) => [
      "--base-url",
      config.baseUrl,
      "--report-dir",
      reportDir,
      "--timeout-ms",
      String(config.timeoutMs),
      "--api-token",
      config.apiToken,
    ],
  },
  {
    id: "inbox_audio_light",
    label: "Inbox audio truth (light)",
    type: "backbone",
    script: "tools/proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs",
    requiresToken: false,
    args: (config, reportDir) => [
      "--page-url",
      buildPageUrl(config.baseUrl, "inbox", "light", config.refreshKey),
      "--report-dir",
      reportDir,
      "--timeout-ms",
      String(config.timeoutMs),
      "--skip-canonical-check",
    ],
  },
  {
    id: "inbox_audio_dark",
    label: "Inbox audio truth (dark)",
    type: "backbone",
    script: "tools/proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs",
    requiresToken: false,
    args: (config, reportDir) => [
      "--page-url",
      buildPageUrl(config.baseUrl, "inbox", "dark", config.refreshKey),
      "--report-dir",
      reportDir,
      "--timeout-ms",
      String(config.timeoutMs),
      "--skip-canonical-check",
    ],
  },
  {
    id: "light_native_ports",
    label: "Light native ports",
    type: "backbone",
    script: "tools/proofs/cover/cover_light_native_ports_playwright.mjs",
    requiresToken: false,
    args: (config, reportDir) => [
      "--report-dir",
      reportDir,
      "--light-url",
      buildPageUrl(config.baseUrl, "home", "light", config.refreshKey),
      "--dark-feed-url",
      buildPageUrl(config.baseUrl, "inbox", "dark", config.refreshKey),
      "--dark-meetings-url",
      buildPageUrl(config.baseUrl, "meetings", "dark", config.refreshKey),
      "--timeout-ms",
      String(config.timeoutMs),
    ],
  },
  {
    id: "universal_feed_tiles",
    label: "Universal feed tiles",
    type: "backbone",
    script: "tools/proofs/cover/cover_universal_feed_tiles_playwright.mjs",
    requiresToken: true,
    args: (config, reportDir) => [
      "--base-url",
      config.baseUrl,
      "--report-dir",
      reportDir,
      "--timeout-ms",
      String(config.timeoutMs),
      "--api-token",
      config.apiToken,
    ],
  },
  {
    id: "workspace_apps",
    label: "Workspace apps",
    type: "focused",
    script: "tools/proofs/cover/cover_workspace_apps_playwright.mjs",
    requiresToken: true,
    args: (config, reportDir) => [
      "--base-url",
      config.baseUrl,
      "--api-token",
      config.apiToken,
      "--report-dir",
      reportDir,
      "--timeout-ms",
      String(config.timeoutMs),
      "--reminder-delivery",
      "never",
    ],
  },
  {
    id: "home_app_labels",
    label: "Home app labels",
    type: "focused",
    script: "tools/proofs/cover/cover_home_app_labels_playwright.mjs",
    requiresToken: false,
    args: (config, reportDir) => [
      "--base-url",
      config.baseUrl,
      "--report-dir",
      reportDir,
      "--timeout-ms",
      String(config.timeoutMs),
    ],
  },
  {
    id: "settings_quiet_list",
    label: "Settings quiet list",
    type: "focused",
    script: "tools/proofs/cover/cover_settings_quiet_list_playwright.mjs",
    requiresToken: false,
    args: (config, reportDir) => [
      "--base-url",
      config.baseUrl,
      "--report-dir",
      reportDir,
      "--timeout-ms",
      String(config.timeoutMs),
    ],
  },
  {
    id: "meetings_load_probe",
    label: "Meetings load probe",
    type: "focused",
    script: "tools/proofs/meeting/meetings_load_probe.mjs",
    requiresToken: false,
    args: (config, reportDir) => [
      "--api-base",
      config.baseUrl,
      "--page-url",
      buildPageUrl(config.baseUrl, "inbox", "light", config.refreshKey),
      "--report-dir",
      reportDir,
      "--api-token",
      config.apiToken || resolveApiToken(),
    ],
  },
  {
    id: "reminders_v3",
    label: "Reminders v3",
    type: "focused",
    script: "tools/proofs/reminders/reminders_v3_browser_proof.mjs",
    requiresToken: true,
    args: (config, reportDir) => [
      "--base-url",
      config.baseUrl,
      "--api-token",
      config.apiToken,
      "--report-dir",
      reportDir,
      "--timeout-ms",
      String(config.timeoutMs),
      "--theme",
      "light",
      "--reminder-delivery",
      "never",
    ],
  },
];

function resolveApiToken() {
  return resolveWriteToken({
    sharedKeys: ["PUCKY_API_TOKEN", "PUCKY_OPERATOR_TOKEN"],
    rootDir: repoRoot,
    remoteEnvLoader: () => loadFlyEnvironment({ app: "pucky", rootDir: repoRoot }),
  });
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: resolveApiToken(),
    reportDir: path.join(repoRoot, ".tmp", "hosted-bug-hunt", timestampSlug()),
    timeoutMs: 30000,
    refreshKey: `bug-hunt-${Date.now()}`,
    routes: [],
    skipProofs: false,
    skipManualSweep: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).replace(/\/+$/, "");
    } else if (arg === "--api-token" && argv[index + 1]) {
      config.apiToken = String(argv[++index] || config.apiToken).trim();
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--refresh-key" && argv[index + 1]) {
      config.refreshKey = String(argv[++index] || config.refreshKey).trim() || config.refreshKey;
    } else if (arg === "--routes" && argv[index + 1]) {
      config.routes = String(argv[++index] || "")
        .split(",")
        .map(value => String(value || "").trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === "--skip-proofs") {
      config.skipProofs = true;
    } else if (arg === "--skip-manual-sweep") {
      config.skipManualSweep = true;
    }
  }
  return config;
}

function appendLog(targetPath, message) {
  fs.appendFileSync(targetPath, `${message}\n`, "utf8");
}

function buildPageUrl(baseUrl, route, theme, refreshKey = "") {
  const url = new URL("/ui/pucky/latest/index.html", `${String(baseUrl || "").replace(/\/+$/, "")}/`);
  url.searchParams.set("theme", theme || "light");
  url.searchParams.set("route", route || "home");
  url.searchParams.set("reset_nav", "1");
  if (String(refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(refreshKey || "").trim());
  }
  return url.toString();
}

function deepFileList(root, matcher) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const output = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!matcher || matcher(full)) {
        output.push(full);
      }
    }
  }
  return output.sort();
}

function loadJsonIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(targetPath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function normalizeSeverity(value) {
  return ["P0", "P1", "P2", "P3"].includes(String(value || "")) ? String(value) : "P2";
}

function pushFinding(findings, finding) {
  findings.push({
    id: String(finding.id || `finding-${findings.length + 1}`),
    surface: String(finding.surface || ""),
    route: String(finding.route || ""),
    theme: String(finding.theme || ""),
    viewport: String(finding.viewport || ""),
    severity: normalizeSeverity(finding.severity),
    class: FINDING_CLASSES.includes(String(finding.class || "")) ? String(finding.class) : "functional",
    expected: String(finding.expected || ""),
    actual: String(finding.actual || ""),
    repro_steps: Array.isArray(finding.repro_steps) ? finding.repro_steps.map(step => String(step || "")) : [],
    screenshot_paths: Array.isArray(finding.screenshot_paths) ? finding.screenshot_paths.filter(Boolean) : [],
    automation_candidate: finding.automation_candidate === "no" ? "no" : "yes",
    source: String(finding.source || "manual"),
  });
}

function laneClassification(lane, status) {
  if (status === "failed" || status === "suspicious" || status === "skipped") {
    return PROOF_CLASSIFICATIONS[1];
  }
  if (lane.type === "focused") {
    return PROOF_CLASSIFICATIONS[2];
  }
  return PROOF_CLASSIFICATIONS[0];
}

function proofFailureKind(result) {
  const message = String(result.error || result.stderr || "");
  if (/api-token|authorization|unauthorized|401|403/i.test(message)) {
    return "proof-harness-brittleness";
  }
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|fetch failed|route\.fetch: Timeout|TimeoutError|pucky-local-dev-token/i.test(message)) {
    return "proof-harness-brittleness";
  }
  if (/chrome executable not found|playwright-core|Could not resolve/i.test(message)) {
    return "proof-harness-brittleness";
  }
  return "product-bug";
}

async function waitForLightRoute(page, route, timeoutMs) {
  await page.waitForFunction(
    expectedRoute => document.querySelector(".light-shell")?.getAttribute("data-light-route") === expectedRoute,
    route,
    { timeout: timeoutMs }
  );
}

async function waitForExpectedDetail(page, detail, surface, timeoutMs) {
  if (detail.expectedRoute) {
    await waitForLightRoute(page, detail.expectedRoute, timeoutMs);
  }
  if (detail.expectedSelector) {
    await page.waitForSelector(detail.expectedSelector, { timeout: timeoutMs });
  }
  if (!detail.expectedRoute && !detail.expectedSelector) {
    throw new Error(`${surface.surface}: detail expectation is missing`);
  }
}

function localDateKey(offsetDays = 0) {
  const target = new Date();
  target.setHours(12, 0, 0, 0);
  target.setDate(target.getDate() + offsetDays);
  return [
    String(target.getFullYear()),
    String(target.getMonth() + 1).padStart(2, "0"),
    String(target.getDate()).padStart(2, "0"),
  ].join("-");
}

async function setCalendarDate(page, value, timeoutMs) {
  const input = page.locator('input.light-date-input[type="date"]').first();
  await input.waitFor({ state: "visible", timeout: timeoutMs });
  await input.fill(value);
  await input.dispatchEvent("change");
  await page.waitForFunction(
    expected => document.querySelector('input.light-date-input[type="date"]')?.value === expected,
    value,
    { timeout: timeoutMs }
  );
}

async function visibleCalendarEventIds(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll(".light-event-block[data-event-id]"))
      .map(node => String(node.getAttribute("data-event-id") || "").trim())
      .filter(Boolean)
  );
}

async function runCalendarFreshnessCheck(page, config, matrixEntry, screenshotsDir) {
  const checks = [
    { key: "today", date: localDateKey(0), expectedIds: HOSTED_SEEDED_CALENDAR_EVENT_IDS.today },
    { key: "tomorrow", date: localDateKey(1), expectedIds: HOSTED_SEEDED_CALENDAR_EVENT_IDS.tomorrow },
  ];
  const screenshots = [];
  for (const check of checks) {
    await setCalendarDate(page, check.date, config.timeoutMs);
    await page.waitForLoadState("networkidle", { timeout: Math.min(10_000, config.timeoutMs) }).catch(() => {});
    const visibleIds = await visibleCalendarEventIds(page);
    const matchedIds = check.expectedIds.filter(id => visibleIds.includes(id));
    const screenshot = await saveScreenshot(page, screenshotsDir, `calendar-${matrixEntry.label}-${check.key}-seeded-window`);
    screenshots.push(screenshot);
    if (!matchedIds.length) {
      return {
        status: "failed",
        reason: `missing_${check.key}_seeded_demo_events`,
        screenshot_paths: screenshots,
        observed: { date: check.date, visible_ids: visibleIds, expected_ids: check.expectedIds },
      };
    }
  }
  await setCalendarDate(page, checks[0].date, config.timeoutMs);
  return {
    status: "passed",
    reason: "",
    screenshot_paths: screenshots,
    observed: {
      today_expected_ids: checks[0].expectedIds,
      tomorrow_expected_ids: checks[1].expectedIds,
    },
  };
}
async function collectRouteMetrics(page, surface) {
  return await page.evaluate((routeSurface) => {
    function text(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }
    function rectOf(node) {
      if (!(node instanceof Element)) {
        return null;
      }
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
    function count(selector) {
      if (!selector) {
        return 0;
      }
      return document.querySelectorAll(selector).length;
    }
    const shell = document.querySelector(".light-shell");
    const header = document.querySelector(".light-page-header, .meetings-header");
    const title = header?.querySelector(".light-page-title, .meetings-title");
    const leftControl = header?.querySelector(".light-back-button, .meetings-refresh, .light-nav-slot");
    const rightControl = header?.querySelector(".light-page-header > :last-child, .meetings-refresh");
    const titleRect = rectOf(title);
    const leftRect = rectOf(leftControl);
    const rightRect = rectOf(rightControl);
    const visibleSectionTitles = Array.from(document.querySelectorAll(".light-section-title"))
      .map(node => text(node.textContent))
      .filter(Boolean);
    return {
      loadedRoute: String(shell?.getAttribute("data-light-route") || ""),
      title: text(title?.textContent || header?.textContent || ""),
      primaryCount: count(routeSurface.primarySelector),
      hasEmptyState: Boolean(
        routeSurface.emptySelector
          ? document.querySelector(routeSurface.emptySelector)
          : document.querySelector(".light-empty-state, .meetings-empty, .links-empty")
      ),
      hasHeader: Boolean(header),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      titleOverlap: Boolean(
        titleRect
        && ((leftRect && titleRect.left < leftRect.right - 4) || (rightRect && titleRect.right > rightRect.left + 4))
      ),
      noteSectionVisible: visibleSectionTitles.includes("NOTES"),
      linkedRecordsVisible: visibleSectionTitles.includes("LINKED RECORDS") || visibleSectionTitles.includes("RELATED"),
      htmlBodyCount: document.querySelectorAll(".light-detail-html-body").length,
      sectionTitles: visibleSectionTitles,
      inboxVisibleMenuButtonCount: routeSurface.route === "inbox"
        ? Array.from(document.querySelectorAll('[data-card-action="manage_menu"]'))
          .filter(node => node instanceof HTMLElement && getComputedStyle(node).display !== "none" && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0)
          .length
        : 0,
    };
  }, surface);
}

function routePassNote(surface, matrixEntry, metrics, detailResult) {
  const density = metrics.primaryCount > 0
    ? `${metrics.primaryCount} visible rows/cards`
    : metrics.hasEmptyState
      ? "intentional empty state"
      : "no primary content";
  const detailNote = detailResult?.status === "passed"
    ? "detail opened cleanly"
    : detailResult?.status === "gap"
      ? `detail gap: ${detailResult.reason}`
      : detailResult?.status === "failed"
        ? "detail check failed"
        : "no detail check";
  const overflowNote = metrics.horizontalOverflow ? "horizontal overflow detected" : "no horizontal overflow";
  const titleNote = surface.requiresHeader
    ? metrics.titleOverlap ? "header crowding detected" : "header spacing looks sane"
    : "launcher header not applicable";
  return `${surface.surface} ${matrixEntry.label}: ${density}, ${detailNote}, ${overflowNote}, ${titleNote}.`;
}

function manualSweepMatrix() {
  return [
    { label: "light-mobile", theme: "light", viewportName: "mobile", viewport: MOBILE_VIEWPORT, navigationMode: "home_tile" },
    { label: "dark-mobile", theme: "dark", viewportName: "mobile", viewport: MOBILE_VIEWPORT, navigationMode: "direct_url" },
    { label: "desktop", theme: "light", viewportName: "desktop", viewport: DESKTOP_VIEWPORT, navigationMode: "direct_url" },
  ];
}

async function openSurface(page, config, surface, matrixEntry) {
  const homeUrl = buildPageUrl(config.baseUrl, "home", matrixEntry.theme, config.refreshKey);
  const targetUrl = buildPageUrl(config.baseUrl, surface.route, matrixEntry.theme, config.refreshKey);
  if (surface.route !== "home" && matrixEntry.navigationMode === "home_tile") {
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForLightRoute(page, "home", config.timeoutMs);
    try {
      await page.locator(`.light-app-tile[data-light-app-route="${surface.route}"]`).click({ timeout: config.timeoutMs });
      await waitForLightRoute(page, surface.route, config.timeoutMs);
      return {
        pageUrl: page.url(),
        navigationMode: "home_tile",
        tileNavigationRecovered: false,
        tileNavigationError: "",
      };
    } catch (error) {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
      await waitForLightRoute(page, surface.route, config.timeoutMs);
      return {
        pageUrl: targetUrl,
        navigationMode: "home_tile_fallback",
        tileNavigationRecovered: true,
        tileNavigationError: error?.message || String(error),
      };
    }
  }
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForLightRoute(page, surface.route, config.timeoutMs);
  return {
    pageUrl: targetUrl,
    navigationMode: "direct_url",
    tileNavigationRecovered: false,
    tileNavigationError: "",
  };
}

async function runDetailCheck(page, config, surface, matrixEntry, screenshotsDir) {
  if (!surface.detail) {
    return { status: "skipped", reason: "not_configured", screenshot: "" };
  }
  const opener = page.locator(surface.detail.openerSelector).first();
  const openerCount = await opener.count();
  if (!openerCount) {
    return { status: "gap", reason: "no_visible_rows", screenshot: "" };
  }
  await opener.click({ timeout: config.timeoutMs, force: true });
  await waitForExpectedDetail(page, surface.detail, surface, config.timeoutMs);
  const metrics = await collectRouteMetrics(page, surface);
  const screenshot = await saveScreenshot(page, screenshotsDir, `${slug(surface.route)}-${matrixEntry.label}-detail`);
  if (surface.detail.htmlPolicy === "require" && metrics.htmlBodyCount < 1) {
    return { status: "failed", reason: "missing_required_html_body", screenshot, metrics };
  }
  if (surface.detail.htmlPolicy === "forbid" && metrics.htmlBodyCount > 0) {
    return { status: "failed", reason: "unexpected_html_body", screenshot, metrics };
  }
  return { status: "passed", reason: "", screenshot, metrics };
}

async function runManualSweep(browser, config, reportDir, consoleLogPath, findings) {
  const screenshotsDir = path.join(reportDir, "screenshots");
  ensureDir(screenshotsDir);
  const networkEvents = [];
  const results = [];
  const coverageGaps = [];
  const routeSet = config.routes.length ? new Set(config.routes) : null;

  for (const matrixEntry of manualSweepMatrix()) {
    const context = await browser.newContext({ viewport: matrixEntry.viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    attachPageLogging(page, consoleLogPath);
    page.on("response", response => {
      try {
        const url = response.url();
        if (!url.startsWith(config.baseUrl) && !url.includes("/ui/pucky/latest")) {
          return;
        }
        networkEvents.push({
          at: new Date().toISOString(),
          url,
          status: response.status(),
          resource_type: response.request().resourceType(),
        });
      } catch (_error) {
        // Best effort only.
      }
    });

    try {
      for (const surface of ROUTE_SWEEP_ORDER) {
        if (routeSet && !routeSet.has(surface.route)) {
          continue;
        }
        if (matrixEntry.viewportName === "desktop" && !surface.desktop) {
          continue;
        }
        try {
          const openResult = await openSurface(page, config, surface, matrixEntry);
          await page.waitForLoadState("networkidle", { timeout: Math.min(10_000, config.timeoutMs) }).catch(() => {});
          const metrics = await collectRouteMetrics(page, surface);
          const screenshot = await saveScreenshot(page, screenshotsDir, `${slug(surface.route)}-${matrixEntry.label}`);
          const calendarFreshness = surface.route === "calendar"
            ? await runCalendarFreshnessCheck(page, config, matrixEntry, screenshotsDir)
            : { status: "skipped", reason: "", screenshot_paths: [], observed: {} };
          const detailResult = await runDetailCheck(page, config, surface, matrixEntry, screenshotsDir);
          const status = metrics.loadedRoute === surface.route
            && (!surface.requiresHeader || metrics.hasHeader)
            && (metrics.primaryCount > 0 || metrics.hasEmptyState)
            && calendarFreshness.status !== "failed"
            && detailResult.status !== "failed"
            ? "pass"
            : "fail";

          if (openResult.tileNavigationRecovered) {
            pushFinding(findings, {
              id: `tile-nav-${surface.route}-${matrixEntry.label}`,
              surface: surface.surface,
              route: surface.route,
              theme: matrixEntry.theme,
              viewport: matrixEntry.viewportName,
              severity: "P2",
              class: "navigation",
              expected: "Home-tile navigation should land on the target route without a direct-URL fallback.",
              actual: `Tile navigation timed out, then direct route load recovered successfully. ${openResult.tileNavigationError}`.trim(),
              repro_steps: [
                `Open ${buildPageUrl(config.baseUrl, "home", matrixEntry.theme, config.refreshKey)}`,
                `Tap the ${surface.surface} home tile`,
              ],
              screenshot_paths: [screenshot],
              automation_candidate: "yes",
            });
          }

          if (surface.requiresHeader && !metrics.hasHeader) {
            pushFinding(findings, {
              id: `header-${surface.route}-${matrixEntry.label}`,
              surface: surface.surface,
              route: surface.route,
              theme: matrixEntry.theme,
              viewport: matrixEntry.viewportName,
              severity: "P2",
              class: "visual",
              expected: "Each non-launcher route should render a clear page header.",
              actual: "The route loaded without a visible header shell.",
              repro_steps: [`Open ${openResult.pageUrl}`],
              screenshot_paths: [screenshot],
              automation_candidate: "yes",
            });
          }
          if (metrics.loadedRoute !== surface.route) {
            pushFinding(findings, {
              id: `route-${surface.route}-${matrixEntry.label}`,
              surface: surface.surface,
              route: surface.route,
              theme: matrixEntry.theme,
              viewport: matrixEntry.viewportName,
              severity: "P1",
              class: "navigation",
              expected: `Expected light route ${surface.route}.`,
              actual: `Loaded light route ${metrics.loadedRoute || "unknown"} instead.`,
              repro_steps: [`Open ${openResult.pageUrl}`],
              screenshot_paths: [screenshot],
              automation_candidate: "yes",
            });
          }
          if (metrics.primaryCount < 1 && !metrics.hasEmptyState) {
            pushFinding(findings, {
              id: `load-honesty-${surface.route}-${matrixEntry.label}`,
              surface: surface.surface,
              route: surface.route,
              theme: matrixEntry.theme,
              viewport: matrixEntry.viewportName,
              severity: "P1",
              class: "content",
              expected: "Sparse routes should show either real content or an intentional empty state.",
              actual: "The route loaded without rows/cards and without an empty-state explanation.",
              repro_steps: [`Open ${openResult.pageUrl}`],
              screenshot_paths: [screenshot],
              automation_candidate: "yes",
            });
          }
          if (metrics.horizontalOverflow) {
            pushFinding(findings, {
              id: `overflow-${surface.route}-${matrixEntry.label}`,
              surface: surface.surface,
              route: surface.route,
              theme: matrixEntry.theme,
              viewport: matrixEntry.viewportName,
              severity: "P2",
              class: "visual",
              expected: "Route should fit within the viewport without horizontal scrolling.",
              actual: "The page layout overflowed horizontally.",
              repro_steps: [`Open ${openResult.pageUrl}`],
              screenshot_paths: [screenshot],
              automation_candidate: "yes",
            });
          }
          if (surface.route === "inbox" && metrics.inboxVisibleMenuButtonCount > 0) {
            pushFinding(findings, {
              id: `inbox-left-menu-${matrixEntry.label}`,
              surface: surface.surface,
              route: surface.route,
              theme: matrixEntry.theme,
              viewport: matrixEntry.viewportName,
              severity: "P1",
              class: "visual",
              expected: "Normal-mode Inbox rows should not expose left-side row menu buttons.",
              actual: `Inbox rendered ${metrics.inboxVisibleMenuButtonCount} visible row-level menu button(s) in normal mode.`,
              repro_steps: [`Open ${openResult.pageUrl}`],
              screenshot_paths: [screenshot],
              automation_candidate: "yes",
            });
          }
          if (surface.requiresHeader && metrics.titleOverlap) {
            pushFinding(findings, {
              id: `title-overlap-${surface.route}-${matrixEntry.label}`,
              surface: surface.surface,
              route: surface.route,
              theme: matrixEntry.theme,
              viewport: matrixEntry.viewportName,
              severity: "P2",
              class: "visual",
              expected: "Header title should not collide with navigation controls.",
              actual: "Header geometry suggests the title crowding overlaps the nav controls.",
              repro_steps: [`Open ${openResult.pageUrl}`],
              screenshot_paths: [screenshot],
              automation_candidate: "yes",
            });
          }
          if (detailResult.status === "failed") {
            pushFinding(findings, {
              id: `detail-${surface.route}-${matrixEntry.label}`,
              surface: surface.surface,
              route: surface.route,
              theme: matrixEntry.theme,
              viewport: matrixEntry.viewportName,
              severity: "P1",
              class: "functional",
              expected: surface.detail?.htmlPolicy === "require"
                ? "Note detail should render the rich HTML document."
                : "Non-note detail should avoid rich HTML document rendering.",
              actual: detailResult.reason === "missing_required_html_body"
                ? "The detail view opened without the required note HTML body."
                : "The detail view rendered a rich HTML body on a non-note surface.",
              repro_steps: [
                `Open ${openResult.pageUrl}`,
                `Open the first ${surface.surface} detail row`,
              ],
              screenshot_paths: [detailResult.screenshot, screenshot].filter(Boolean),
              automation_candidate: "yes",
            });
          }
          if (calendarFreshness.status === "failed") {
            pushFinding(findings, {
              id: `calendar-seeded-window-${matrixEntry.label}`,
              surface: surface.surface,
              route: surface.route,
              theme: matrixEntry.theme,
              viewport: matrixEntry.viewportName,
              severity: "P1",
              class: "content",
              expected: "Hosted Calendar should show current-window seeded demo events on both today and tomorrow.",
              actual: `Calendar ${calendarFreshness.observed.date} showed ${JSON.stringify(calendarFreshness.observed.visible_ids)} instead of any of ${JSON.stringify(calendarFreshness.observed.expected_ids)}.`,
              repro_steps: [
                `Open ${buildPageUrl(config.baseUrl, surface.route, matrixEntry.theme, config.refreshKey)}`,
                `Set the calendar date to ${calendarFreshness.observed.date}`,
              ],
              screenshot_paths: [...calendarFreshness.screenshot_paths, screenshot].filter(Boolean),
              automation_candidate: "yes",
            });
          }
          if (detailResult.status === "gap") {
            coverageGaps.push({
              surface: surface.surface,
              route: surface.route,
              theme: matrixEntry.theme,
              viewport: matrixEntry.viewportName,
              reason: detailResult.reason,
            });
          }
          results.push({
            surface: surface.surface,
            route: surface.route,
            theme: matrixEntry.theme,
            viewport: matrixEntry.viewportName,
            page_url: openResult.pageUrl,
            navigation_mode: openResult.navigationMode,
            status,
            note: routePassNote(surface, matrixEntry, metrics, detailResult),
            screenshot_path: screenshot,
            detail_screenshot_path: detailResult.screenshot || "",
            metrics,
            calendar_freshness: {
              status: calendarFreshness.status,
              reason: calendarFreshness.reason || "",
            },
            detail: {
              status: detailResult.status,
              reason: detailResult.reason || "",
            },
          });
          appendLog(consoleLogPath, `[manual:${matrixEntry.label}] ${surface.route} => ${status}`);
        } catch (error) {
          const screenshot = await saveScreenshot(page, screenshotsDir, `${slug(surface.route)}-${matrixEntry.label}-failure`).catch(() => "");
          pushFinding(findings, {
            id: `manual-${surface.route}-${matrixEntry.label}`,
            surface: surface.surface,
            route: surface.route,
            theme: matrixEntry.theme,
            viewport: matrixEntry.viewportName,
            severity: "P1",
            class: "functional",
            expected: `${surface.surface} should load cleanly on hosted.`,
            actual: error?.message || String(error),
            repro_steps: [
              `Open ${buildPageUrl(config.baseUrl, surface.route, matrixEntry.theme, config.refreshKey)}`,
            ],
            screenshot_paths: [screenshot].filter(Boolean),
            automation_candidate: "yes",
          });
          results.push({
            surface: surface.surface,
            route: surface.route,
            theme: matrixEntry.theme,
            viewport: matrixEntry.viewportName,
            page_url: buildPageUrl(config.baseUrl, surface.route, matrixEntry.theme, config.refreshKey),
            navigation_mode: matrixEntry.navigationMode,
            status: "fail",
            note: `${surface.surface} ${matrixEntry.label}: failed to load cleanly. ${error?.message || String(error)}`,
            screenshot_path: screenshot,
            detail_screenshot_path: "",
            metrics: null,
            detail: { status: "failed", reason: error?.message || String(error) },
          });
          appendLog(consoleLogPath, `[manual:${matrixEntry.label}] ${surface.route} => fail ${error?.message || String(error)}`);
        }
      }
    } finally {
      await context.close().catch(() => {});
    }
  }

  return {
    results,
    coverageGaps,
    network: {
      schema: "pucky.hosted_bug_hunt_network.v1",
      events: networkEvents,
    },
  };
}

function runProofLane(lane, config, proofsDir, consoleLogPath) {
  const reportDir = path.join(proofsDir, lane.id);
  ensureDir(reportDir);
  if (lane.requiresToken && !String(config.apiToken || "").trim()) {
    return {
      id: lane.id,
      label: lane.label,
      type: lane.type,
      status: "skipped",
      classification: PROOF_CLASSIFICATIONS[1],
      report_dir: reportDir,
      summary_path: "",
      screenshots: [],
      error: "requires PUCKY_OPERATOR_TOKEN/PUCKY_API_TOKEN for hosted write-enabled proofs",
    };
  }

  appendLog(consoleLogPath, `[proof:${lane.id}] starting ${lane.script}`);
  const completed = spawnSync(process.execPath, [lane.script, ...lane.args(config, reportDir)], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: Math.max(config.timeoutMs * 4, 120_000),
  });
  if (completed.stdout) {
    appendLog(consoleLogPath, `[proof:${lane.id}:stdout]\n${completed.stdout.trimEnd()}`);
  }
  if (completed.stderr) {
    appendLog(consoleLogPath, `[proof:${lane.id}:stderr]\n${completed.stderr.trimEnd()}`);
  }

  const summaryPath = path.join(reportDir, "summary.json");
  const networkPath = path.join(reportDir, "network.json");
  const summary = loadJsonIfExists(summaryPath);
  const screenshots = deepFileList(reportDir, target => target.endsWith(".png"));
  const timeoutError = completed.error?.message || "";
  const hasOk = typeof summary?.ok === "boolean";
  const suspicious = !completed.error && completed.status === 0 && (!summary || (hasOk && summary.ok !== true));
  const status = completed.error
    ? "failed"
    : completed.status === 0
    ? suspicious ? "suspicious" : "passed"
    : "failed";
  return {
    id: lane.id,
    label: lane.label,
    type: lane.type,
    status,
    classification: laneClassification(lane, status),
    report_dir: reportDir,
    summary_path: fs.existsSync(summaryPath) ? summaryPath : "",
    network_path: fs.existsSync(networkPath) ? networkPath : "",
    screenshots,
    exit_code: Number(completed.status || 0),
    error: status === "failed"
      ? String(summary?.error || timeoutError || completed.stderr || completed.stdout || `exit ${completed.status}`)
      : suspicious
        ? "proof completed without a clean summary contract"
        : "",
    summary,
  };
}

function manualFindingsSummary(findings) {
  return findings.reduce((bucket, finding) => {
    bucket.total += 1;
    bucket[finding.severity] += 1;
    return bucket;
  }, { total: 0, P0: 0, P1: 0, P2: 0, P3: 0 });
}

function renderSummaryMarkdown(summary) {
  const lines = [
    "# Hosted-First Bug Hunt",
    "",
    `- Schema: ${summary.schema}`,
    `- Base URL: ${summary.base_url}`,
    `- Report dir: ${summary.report_dir}`,
    `- Generated at: ${summary.generated_at}`,
    `- High-severity findings: ${summary.finding_counts.P0 + summary.finding_counts.P1}`,
    "",
    "## Baseline Proofs",
    "",
  ];

  for (const proof of summary.baseline_proofs) {
    lines.push(
      `- ${proof.label}: ${proof.status}. Classification: ${proof.classification}. Report: ${proof.report_dir}${proof.error ? ` Error: ${proof.error}` : ""}`
    );
  }

  lines.push("", "## Manual Sweep", "");
  for (const result of summary.manual_sweep.results) {
    lines.push(
      `- ${result.surface} [${result.theme}/${result.viewport}]: ${result.status}. ${result.note} Screenshot: ${result.screenshot_path}`
    );
  }

  lines.push("", "## Findings", "");
  if (!summary.findings.length) {
    lines.push("- None recorded by the automated sweep. Screenshots still need human review for taste-level issues.");
  } else {
    for (const finding of summary.findings) {
      lines.push(
        `- ${finding.id} (${finding.severity}, ${finding.class}, ${finding.source}): ${finding.surface} on ${finding.theme}/${finding.viewport}. Expected: ${finding.expected} Actual: ${finding.actual}`
      );
    }
  }

  lines.push("", "## Coverage Gaps", "");
  if (!summary.coverage_gaps.length) {
    lines.push("- None.");
  } else {
    for (const gap of summary.coverage_gaps) {
      lines.push(`- ${gap.surface} on ${gap.theme}/${gap.viewport}: ${gap.reason}`);
    }
  }

  lines.push("", "## Automation Backlog", "");
  lines.push("- Fast smoke checks for every home-tile route load and non-blank surface.");
  lines.push("- Workflow proofs for opening first-row details and enforcing the note-only rich HTML rule.");
  lines.push("- Visual contract checks for header crowding, horizontal overflow, spacing, and section presence.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  ensureDir(path.join(config.reportDir, "proofs"));
  ensureDir(path.join(config.reportDir, "screenshots"));
  const consoleLogPath = path.join(config.reportDir, "console.log");
  const findings = [];
  const proofNetworkPaths = [];
  let browser = null;

  const summary = {
    schema: RESULT_SCHEMA,
    ok: true,
    generated_at: new Date().toISOString(),
    report_dir: config.reportDir,
    base_url: config.baseUrl,
    refresh_key: config.refreshKey,
    baseline_proofs: [],
    manual_sweep: {
      results: [],
    },
    coverage_gaps: [],
    findings: [],
    finding_counts: { total: 0, P0: 0, P1: 0, P2: 0, P3: 0 },
    network: {
      schema: "pucky.hosted_bug_hunt_network.v1",
      events: [],
      proof_network_reports: [],
    },
  };

  try {
    if (!config.skipProofs) {
      const proofsDir = path.join(config.reportDir, "proofs");
      for (const lane of BASELINE_PROOFS) {
        const result = runProofLane(lane, config, proofsDir, consoleLogPath);
        summary.baseline_proofs.push(result);
        if (result.network_path) {
          proofNetworkPaths.push({ id: result.id, path: result.network_path });
        }
        if (result.status === "failed" || result.status === "suspicious") {
          pushFinding(findings, {
            id: `proof-${result.id}`,
            surface: result.label,
            route: result.id,
            theme: "mixed",
            viewport: "proof",
            severity: result.status === "failed" ? "P1" : "P2",
            class: "functional",
            expected: "Baseline hosted proof lane should finish with a clean summary.",
            actual: result.error || `Proof ended in ${result.status}.`,
            repro_steps: [`Run ${lane.script} against ${config.baseUrl}`],
            screenshot_paths: result.screenshots.slice(0, 3),
            automation_candidate: "yes",
            source: proofFailureKind(result),
          });
        }
      }
    }

    if (!config.skipManualSweep) {
      browser = await chromium.launch({
        executablePath: resolveChromePath(),
        headless: true,
      });
      const manual = await runManualSweep(browser, config, config.reportDir, consoleLogPath, findings);
      summary.manual_sweep = {
        results: manual.results,
      };
      summary.coverage_gaps = manual.coverageGaps;
      summary.network.events = manual.network.events;
    }
  } catch (error) {
    summary.ok = false;
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    summary.findings = findings.slice().sort((left, right) => {
      const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return severityOrder[left.severity] - severityOrder[right.severity];
    });
    summary.finding_counts = manualFindingsSummary(summary.findings);
    summary.network.proof_network_reports = proofNetworkPaths;
    summary.ok = summary.ok
      && summary.finding_counts.P0 === 0
      && summary.finding_counts.P1 === 0
      && !summary.baseline_proofs.some(proof => proof.status === "failed");
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    writeJsonFile(path.join(config.reportDir, "findings.json"), summary.findings);
    writeJsonFile(path.join(config.reportDir, "network.json"), summary.network);
    fs.writeFileSync(path.join(config.reportDir, "summary.md"), renderSummaryMarkdown(summary), "utf8");
  }

  console.log(JSON.stringify({
    schema: RESULT_SCHEMA,
    ok: summary.ok,
    report_dir: config.reportDir,
    findings: summary.finding_counts,
  }, null, 2));

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
