import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  buildPageTracking,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile,
} from "../../support/cover_shared.mjs";
import {
  loadProofRuntimeEnv,
  resolveWriteToken,
} from "../../support/proof_runtime_env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
loadProofRuntimeEnv({ rootDir: repoRoot });

const RESULT_SCHEMA = "pucky.cover_speed_loop_browser_proof.v1";
const DEFAULT_BASE_URL = process.env.PUCKY_SPEED_LOOP_BASE_URL || "https://pucky.fly.dev";
const DEFAULT_ROUTE_TIMEOUT_MS = 30000;
const DEFAULT_ITERATIONS = 3;
const VIEWPORTS = {
  desktop: { width: 1440, height: 980 },
  mobile: { width: 430, height: 932 },
};
const HOME_ROUTE_MATRIX = [
  { key: "inbox", label: "Inbox" },
  { key: "meetings", label: "Meetings" },
  { key: "meeting-notes", label: "Meeting Notes" },
  { key: "reminders", label: "Reminders" },
  { key: "notes", label: "Notes" },
  { key: "tasks", label: "Tasks" },
  { key: "calendar", label: "Calendar" },
  { key: "projects", label: "Projects" },
  { key: "contacts", label: "Contacts" },
  { key: "connect", label: "Connect" },
  { key: "settings", label: "Settings" },
];

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiBaseUrl: process.env.PUCKY_SPEED_LOOP_API_BASE_URL || "",
    reportDir: path.resolve(repoRoot, ".tmp", "cover-speed-loop"),
    timeoutMs: DEFAULT_ROUTE_TIMEOUT_MS,
    iterations: DEFAULT_ITERATIONS,
    viewport: "desktop",
    appSlug: process.env.PUCKY_CONNECT_APP_SLUG || "slack",
    apiToken: "",
    refreshKey: process.env.PUCKY_SPEED_LOOP_REFRESH || "",
    baseline: "",
    perfRunId: process.env.PUCKY_PERF_RUN_ID || "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--base-url" && next) {
      config.baseUrl = next;
      index += 1;
      continue;
    }
    if (arg === "--report-dir" && next) {
      config.reportDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--api-base-url" && next) {
      config.apiBaseUrl = String(next || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      config.timeoutMs = Math.max(1000, Number(next) || DEFAULT_ROUTE_TIMEOUT_MS);
      index += 1;
      continue;
    }
    if (arg === "--iterations" && next) {
      config.iterations = Math.max(1, Number(next) || DEFAULT_ITERATIONS);
      index += 1;
      continue;
    }
    if (arg === "--viewport" && next) {
      config.viewport = VIEWPORTS[next] ? next : config.viewport;
      index += 1;
      continue;
    }
    if (arg === "--app-slug" && next) {
      config.appSlug = String(next || "slack").trim().toLowerCase() || "slack";
      index += 1;
      continue;
    }
    if (arg === "--api-token" && next) {
      config.apiToken = String(next || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--refresh-key" && next) {
      config.refreshKey = String(next || "").trim();
      index += 1;
      continue;
    }
    if (arg === "--baseline" && next) {
      config.baseline = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--perf-run-id" && next) {
      config.perfRunId = String(next || "").trim();
      index += 1;
      continue;
    }
  }
  config.baseUrl = String(config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  config.apiBaseUrl = String(config.apiBaseUrl || "").trim().replace(/\/+$/, "");
  if (!config.apiBaseUrl) {
    const isLocalDocument = /^file:/i.test(config.baseUrl);
    const isLoopbackHost = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(config.baseUrl);
    if (isLocalDocument || isLoopbackHost) {
      config.apiBaseUrl = DEFAULT_BASE_URL;
    }
  }
  config.viewportSize = VIEWPORTS[config.viewport] || VIEWPORTS.desktop;
  return config;
}

function resolveApiToken(config) {
  if (config.apiToken) {
    return config.apiToken;
  }
  return resolveWriteToken({
    rootDir: repoRoot,
    envKeys: ["PUCKY_API_TOKEN", "PUCKY_SPEED_LOOP_TOKEN", "PUCKY_LIVE_USER_SESSION_TOKEN"],
    sharedKeys: ["PUCKY_API_TOKEN"],
  });
}

function buildRouteUrl(config, route) {
  const isDirectDocument = /^file:/i.test(config.baseUrl) || /\.html?(?:[?#].*)?$/i.test(config.baseUrl);
  const url = isDirectDocument
    ? new URL(config.baseUrl)
    : new URL("/ui/pucky/latest/", `${config.baseUrl}/`);
  url.searchParams.set("theme", "light");
  url.searchParams.set("route", String(route || "home"));
  url.searchParams.set("reset_nav", "1");
  url.searchParams.set("debug_perf", "1");
  if (config.apiToken) {
    url.searchParams.set("api_token", config.apiToken);
  }
  if (config.apiBaseUrl) {
    url.searchParams.set("api_base_url", config.apiBaseUrl);
  }
  if (config.refreshKey) {
    url.searchParams.set("_pucky_refresh", config.refreshKey);
  }
  if (config.perfRunId) {
    url.searchParams.set("perf_run_id", config.perfRunId);
  }
  return url.toString();
}

function percentile(samples, fraction) {
  const values = Array.isArray(samples) ? samples.slice().sort((a, b) => a - b) : [];
  if (!values.length) {
    return 0;
  }
  const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1));
  return Number(values[index].toFixed(1));
}

function median(samples) {
  return percentile(samples, 0.5);
}

function screenshotKey(prefix, config) {
  return `${prefix}-${config.viewport}`;
}

async function perfMetrics(page) {
  return page.evaluate(() => {
    return window.PuckyUiDebug?.perfMetrics?.() || null;
  });
}

async function linksMetrics(page) {
  return page.evaluate(() => {
    return window.PuckyUiDebug?.linksMetrics?.() || null;
  });
}

async function waitForPerfRouteReady(page, route, timeoutMs) {
  await page.waitForFunction(
    targetRoute => {
      const metrics = window.PuckyUiDebug?.perfMetrics?.();
      return Boolean(metrics && metrics.route === targetRoute && metrics.route_ready);
    },
    route,
    { timeout: timeoutMs }
  );
  return perfMetrics(page);
}

async function waitForHomeReady(page, timeoutMs) {
  await waitForPerfRouteReady(page, "home", timeoutMs);
  await page.waitForFunction(
    requiredRoutes => {
      const routes = Array.from(document.querySelectorAll(".light-app-tile[data-light-app-route]"))
        .map(node => String(node.getAttribute("data-light-app-route") || "").trim())
        .filter(Boolean);
      return requiredRoutes.every(route => routes.includes(route));
    },
    HOME_ROUTE_MATRIX.map(item => item.key),
    { timeout: timeoutMs }
  );
}

async function goHome(page, config) {
  await page.goto(buildRouteUrl(config, "home"), {
    waitUntil: "domcontentloaded",
    timeout: config.timeoutMs,
  });
  await waitForHomeReady(page, config.timeoutMs);
}

async function clickSelectorViaDom(page, selector) {
  const clicked = await page.evaluate(targetSelector => {
    const node = document.querySelector(targetSelector);
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    node.click();
    return true;
  }, selector);
  if (!clicked) {
    throw new Error(`Could not find selector ${selector}.`);
  }
}

async function clickFirstVisibleSelectorViaDom(page, selector) {
  const clicked = await page.evaluate(targetSelector => {
    const isVisibleElement = node => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      const style = window.getComputedStyle(node);
      if (!style || style.display === "none" || style.visibility === "hidden") {
        return false;
      }
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const node = Array.from(document.querySelectorAll(targetSelector)).find(isVisibleElement);
    if (!(node instanceof HTMLElement)) {
      return false;
    }
    node.click();
    return true;
  }, selector);
  if (!clicked) {
    throw new Error(`Could not find a visible selector ${selector}.`);
  }
}

async function waitForVisibleDomSelector(page, selector, timeoutMs) {
  await page.waitForFunction(
    targetSelector => {
      const isVisibleElement = node => {
        if (!(node instanceof HTMLElement)) {
          return false;
        }
        const style = window.getComputedStyle(node);
        if (!style || style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      return Array.from(document.querySelectorAll(targetSelector)).some(isVisibleElement);
    },
    selector,
    { timeout: timeoutMs }
  );
}

async function clickCalendarDayWithEvents(page) {
  return page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll(".light-calendar-day-chip"));
    const selectable = chips.find(node => {
      if (!(node instanceof HTMLButtonElement)) {
        return false;
      }
      if (node.getAttribute("aria-pressed") === "true") {
        return false;
      }
      return Boolean(node.querySelector(".light-calendar-day-dot"));
    });
    const fallback = chips.find(node => {
      return node instanceof HTMLButtonElement && Boolean(node.querySelector(".light-calendar-day-dot"));
    });
    const target = selectable || fallback;
    if (!(target instanceof HTMLButtonElement)) {
      return "";
    }
    target.click();
    return String(target.dataset.day || "").trim();
  });
}

async function openRouteFromHome(page, route, timeoutMs) {
  const selector = `.light-app-tile[data-light-app-route="${route}"]`;
  await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
  await clickSelectorViaDom(page, selector);
  await waitForPerfRouteReady(page, route, timeoutMs);
}

async function measureScenario(fn) {
  const startedAt = Date.now();
  const payload = await fn();
  return {
    elapsed_ms: Number((Date.now() - startedAt).toFixed(1)),
    ...payload,
  };
}

async function captureNamedScreenshot(page, reportDir, config, prefix, summary) {
  const key = screenshotKey(prefix, config);
  const targetName = `${key}`;
  await saveScreenshot(page, reportDir, targetName);
  summary.screenshots[key] = path.join(reportDir, `${targetName}.png`);
}

async function readDetailState(page) {
  return page.evaluate(() => ({
    route: document.querySelector(".app-shell")?.getAttribute("data-view") || "",
    task_detail_visible: Boolean(document.querySelector(".light-task-detail-surface")),
    contact_detail_visible: Boolean(document.querySelector(".light-contact-detail-page")),
    calendar_detail_visible: Boolean(document.querySelector(".light-event-detail-page, .light-event-document")),
  }));
}

async function openFirstTaskDetail(page, timeoutMs) {
  await page.locator(".light-task-row-main").first().waitFor({ state: "visible", timeout: timeoutMs });
  await clickFirstVisibleSelectorViaDom(page, ".light-task-row-main");
  await page.waitForFunction(() => Boolean(document.querySelector(".light-task-detail-surface")), undefined, { timeout: timeoutMs });
  return {
    perf: await perfMetrics(page),
    detail: await readDetailState(page),
  };
}

async function openFirstContactDetail(page, timeoutMs) {
  await page.locator(".light-contact-row").first().waitFor({ state: "visible", timeout: timeoutMs });
  await clickFirstVisibleSelectorViaDom(page, ".light-contact-row");
  await page.waitForFunction(() => Boolean(document.querySelector(".light-contact-detail-page")), undefined, { timeout: timeoutMs });
  return {
    perf: await perfMetrics(page),
    detail: await readDetailState(page),
  };
}

async function openFirstCalendarDetail(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const metrics = window.PuckyUiDebug?.perfMetrics?.();
      return Boolean(document.querySelector(".light-calendar-page"))
        && Number(metrics?.render_count || 0) > 0;
    },
    undefined,
    { timeout: timeoutMs }
  ).catch(() => {});
  await waitForVisibleDomSelector(page, ".light-calendar-day-chip", timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = Math.max(250, deadline - Date.now());
    try {
      await waitForVisibleDomSelector(page, ".light-event-block", Math.min(remainingMs, 2500));
      break;
    } catch (_) {
      const switchedDay = await clickCalendarDayWithEvents(page);
      if (switchedDay) {
        await page.waitForFunction(
          targetDay => {
            const node = document.querySelector(`.light-calendar-day-chip[data-day="${targetDay}"]`);
            return node instanceof HTMLElement && node.getAttribute("aria-pressed") === "true";
          },
          switchedDay,
          { timeout: Math.min(remainingMs, 1000) }
        ).catch(() => {});
      } else {
        await page.waitForTimeout(Math.min(remainingMs, 250));
      }
    }
  }
  await waitForVisibleDomSelector(page, ".light-event-block", Math.max(250, deadline - Date.now()));
  await clickFirstVisibleSelectorViaDom(page, ".light-event-block");
  await page.waitForFunction(() => Boolean(document.querySelector(".light-event-detail-page, .light-event-document")), undefined, { timeout: timeoutMs });
  return {
    perf: await perfMetrics(page),
    detail: await readDetailState(page),
  };
}

async function waitForConnectSearch(page, slug, timeoutMs) {
  await page.locator(".links-search").fill(slug, { timeout: timeoutMs });
  await page.waitForFunction(
    targetSlug => {
      const metrics = window.PuckyUiDebug?.linksMetrics?.();
      return Array.isArray(metrics?.filtered_slugs) && metrics.filtered_slugs.includes(targetSlug);
    },
    slug,
    { timeout: timeoutMs }
  );
  return linksMetrics(page);
}

async function waitForPopupAuthPage(context, sourcePage, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const candidate of context.pages()) {
      if (candidate === sourcePage) {
        continue;
      }
      const candidateUrl = String(candidate.url() || "").trim();
      if (candidateUrl && candidateUrl !== "about:blank" && !/\/ui\/pucky\/latest/i.test(candidateUrl)) {
        return candidate;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return null;
}

async function waitForSameTabAuthPage(page, timeoutMs) {
  try {
    await page.waitForFunction(
      () => {
        const href = String(window.location.href || "").trim();
        return Boolean(href) && !/\/ui\/pucky\/latest/i.test(href);
      },
      undefined,
      { timeout: timeoutMs }
    );
    return page;
  } catch (_) {
    return null;
  }
}

async function triggerConnectAuth(page, config) {
  const context = page.context();
  const popupPromise = context.waitForEvent("page", { timeout: Math.min(config.timeoutMs, 8000) }).catch(() => null);
  const selector = `.links-app-row[data-links-slug="${config.appSlug}"]`;
  await page.locator(selector).first().waitFor({ state: "visible", timeout: config.timeoutMs });
  await clickSelectorViaDom(page, selector);
  const popup = await popupPromise;
  const sameTabAuthPage = await waitForSameTabAuthPage(page, Math.min(config.timeoutMs, 5000));
  if (sameTabAuthPage) {
    return {
      surface: "same_tab",
      url: sameTabAuthPage.url(),
      title: await sameTabAuthPage.title().catch(() => ""),
      page: sameTabAuthPage,
    };
  }
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: config.timeoutMs }).catch(() => {});
    await popup.waitForFunction(
      () => {
        const href = String(window.location.href || "").trim();
        return Boolean(href) && href !== "about:blank" && !/\/ui\/pucky\/latest/i.test(href);
      },
      undefined,
      { timeout: config.timeoutMs }
    ).catch(() => {});
    const authPopup = await waitForPopupAuthPage(context, page, Math.min(config.timeoutMs, 5000)) || popup;
    const popupUrl = authPopup.url();
    if (!popupUrl || popupUrl === "about:blank" || /\/ui\/pucky\/latest/i.test(popupUrl)) {
      throw new Error(`Connect popup never navigated to a real auth target for ${config.appSlug}.`);
    }
    return {
      surface: "popup",
      url: popupUrl,
      title: await authPopup.title().catch(() => ""),
      page: authPopup,
    };
  }
  await page.waitForFunction(() => {
    const metrics = window.PuckyUiDebug?.linksMetrics?.();
    const sameTab = Boolean(metrics?.last_handoff_same_tab_navigation);
    const launched = Boolean(metrics?.last_handoff_launched);
    return sameTab || launched || !/\/ui\/pucky\/latest/i.test(window.location.href);
  }, undefined, { timeout: config.timeoutMs });
  const handoff = await linksMetrics(page);
  const url = page.url();
  if (/\/ui\/pucky\/latest/i.test(url) && !handoff?.last_handoff_same_tab_navigation && !handoff?.last_handoff_popup_opened) {
    throw new Error(`Connect auth never left the Connect page for ${config.appSlug}.`);
  }
  return {
    surface: handoff?.last_handoff_same_tab_navigation ? "same_tab" : "hosted_page",
    url,
    title: await page.title().catch(() => ""),
    page,
    handoff,
  };
}

function metricsValue(sample, key) {
  return Number(sample?.perf?.[key] || 0);
}

function summarizeSamples(samples) {
  const values = Array.isArray(samples) ? samples.map(item => Number(item.elapsed_ms || 0)).filter(value => Number.isFinite(value) && value >= 0) : [];
  const routeReadyValues = Array.isArray(samples) ? samples.map(item => metricsValue(item, "route_ready_elapsed_ms")).filter(value => Number.isFinite(value) && value >= 0) : [];
  const bridgeValues = Array.isArray(samples) ? samples.map(item => metricsValue(item, "bridge_total_ms")).filter(value => Number.isFinite(value) && value >= 0) : [];
  const shellValues = Array.isArray(samples) ? samples.map(item => metricsValue(item, "shell_launch_elapsed_ms")).filter(value => Number.isFinite(value) && value >= 0) : [];
  const webviewValues = Array.isArray(samples) ? samples.map(item => metricsValue(item, "webview_load_elapsed_ms")).filter(value => Number.isFinite(value) && value >= 0) : [];
  const assetFailures = Array.isArray(samples) ? samples.map(item => metricsValue(item, "asset_delivery_failures")) : [];
  const reloadAttempts = Array.isArray(samples) ? samples.map(item => metricsValue(item, "hosted_reload_attempts")) : [];
  return {
    samples,
    median_ms: median(values),
    p95_ms: percentile(values, 0.95),
    route_ready_median_ms: median(routeReadyValues),
    bridge_total_median_ms: median(bridgeValues),
    shell_launch_median_ms: median(shellValues),
    webview_load_median_ms: median(webviewValues),
    asset_delivery_failures_max: assetFailures.length ? Math.max(...assetFailures) : 0,
    hosted_reload_attempts_max: reloadAttempts.length ? Math.max(...reloadAttempts) : 0,
    bootstrap_snapshot_used: Array.isArray(samples)
      ? samples.some(item => Boolean(item?.perf?.bootstrap_snapshot_used))
      : false,
  };
}

function summaryHasAssetBootstrapFailure(summary) {
  return Object.values(summary.fresh_loads || {}).some(entry => Number(entry?.asset_delivery_failures_max || 0) > 0)
    || Object.values(summary.fresh_loads || {}).some(entry => Number(entry?.hosted_reload_attempts_max || 0) > 0);
}

function buildDiff(summary, baselinePath) {
  if (!baselinePath || !fs.existsSync(baselinePath)) {
    return null;
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const diff = {
    baseline_path: baselinePath,
    route_open_median_delta_ms: {},
    detail_open_median_delta_ms: {},
  };
  for (const [key, value] of Object.entries(summary.route_opens || {})) {
    const baseMedian = Number(baseline.route_opens?.[key]?.median_ms || 0);
    diff.route_open_median_delta_ms[key] = Number((Number(value.median_ms || 0) - baseMedian).toFixed(1));
  }
  for (const [key, value] of Object.entries(summary.detail_opens || {})) {
    const baseMedian = Number(baseline.detail_opens?.[key]?.median_ms || 0);
    diff.detail_open_median_delta_ms[key] = Number((Number(value.median_ms || 0) - baseMedian).toFixed(1));
  }
  return diff;
}

function telemetryBaseUrl(config) {
  if (config.apiBaseUrl) {
    return String(config.apiBaseUrl || "").replace(/\/+$/, "");
  }
  try {
    return new URL(config.baseUrl).origin.replace(/\/+$/, "");
  } catch (_) {
    return DEFAULT_BASE_URL;
  }
}

async function fetchServerTelemetry(config) {
  if (!config.apiToken || !config.perfRunId) {
    return null;
  }
  const response = await fetch(
    `${telemetryBaseUrl(config)}/api/ui/route-perf-events?run_id=${encodeURIComponent(config.perfRunId)}&limit=500`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
      },
    }
  );
  if (!response.ok) {
    throw new Error(`Telemetry slice request failed (${response.status}).`);
  }
  return response.json();
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  config.apiToken = resolveApiToken(config);
  if (!config.apiToken) {
    throw new Error("Live speed loop proof requires --api-token or PUCKY_API_TOKEN/PUCKY_SPEED_LOOP_TOKEN/PUCKY_LIVE_USER_SESSION_TOKEN.");
  }
  config.refreshKey = config.refreshKey || (process.env.PUCKY_SPEED_LOOP_REFRESH || String(Date.now()));
  config.perfRunId = config.perfRunId || `speed-loop-${config.viewport}-${Date.now()}`;
  ensureDir(config.reportDir);

  const summary = {
    schema: RESULT_SCHEMA,
    ok: false,
    base_url: config.baseUrl,
    api_base_url: config.apiBaseUrl,
    viewport: config.viewport,
    viewport_size: config.viewportSize,
    iterations: config.iterations,
    app_slug: config.appSlug,
    api_token_present: Boolean(config.apiToken),
    perf_run_id: config.perfRunId,
    fresh_loads: {},
    route_opens: {},
    detail_opens: {},
    connect_auth: null,
    screenshots: {},
    failed_requests: [],
    http_error_responses: [],
    console_errors: [],
    page_errors: [],
    console_log_path: "",
    server_telemetry: null,
    server_telemetry_path: "",
    diff: null,
  };

  const chromePath = resolveChromePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });
  const context = await browser.newContext({
    viewport: config.viewportSize,
  });
  const page = await context.newPage();
  const consoleLogPath = path.join(config.reportDir, `console-${config.viewport}.log`);
  attachPageLogging(page, consoleLogPath);
  const tracking = buildPageTracking(page, consoleLogPath);
  summary.console_log_path = consoleLogPath;

  try {
    const homeFreshSamples = [];
    const connectFreshSamples = [];
    for (let iteration = 0; iteration < config.iterations; iteration += 1) {
      homeFreshSamples.push(await measureScenario(async () => {
        await page.goto(buildRouteUrl(config, "home"), {
          waitUntil: "domcontentloaded",
          timeout: config.timeoutMs,
        });
        await waitForHomeReady(page, config.timeoutMs);
        return { perf: await perfMetrics(page) };
      }));
      connectFreshSamples.push(await measureScenario(async () => {
        await page.goto(buildRouteUrl(config, "connect"), {
          waitUntil: "domcontentloaded",
          timeout: config.timeoutMs,
        });
        await waitForPerfRouteReady(page, "connect", config.timeoutMs);
        return {
          perf: await perfMetrics(page),
          links: await linksMetrics(page),
        };
      }));
    }
    summary.fresh_loads.home = summarizeSamples(homeFreshSamples);
    summary.fresh_loads.connect = summarizeSamples(connectFreshSamples);
    if (summaryHasAssetBootstrapFailure(summary)) {
      throw new Error("Hosted asset bootstrap failed while loading /ui/pucky/latest/.");
    }

    for (const routeConfig of HOME_ROUTE_MATRIX) {
      const samples = [];
      for (let iteration = 0; iteration < config.iterations; iteration += 1) {
        await goHome(page, config);
        samples.push(await measureScenario(async () => {
          await openRouteFromHome(page, routeConfig.key, config.timeoutMs);
          return { perf: await perfMetrics(page) };
        }));
        if (iteration === 0 && ["home", "tasks", "contacts", "calendar", "connect"].includes(routeConfig.key)) {
          await captureNamedScreenshot(page, config.reportDir, config, routeConfig.key, summary);
        }
      }
      summary.route_opens[routeConfig.key] = summarizeSamples(samples);
    }

    const taskDetailSamples = [];
    const contactDetailSamples = [];
    const calendarDetailSamples = [];
    for (let iteration = 0; iteration < config.iterations; iteration += 1) {
      await goHome(page, config);
      await openRouteFromHome(page, "tasks", config.timeoutMs);
      taskDetailSamples.push(await measureScenario(async () => openFirstTaskDetail(page, config.timeoutMs)));

      await goHome(page, config);
      await openRouteFromHome(page, "contacts", config.timeoutMs);
      contactDetailSamples.push(await measureScenario(async () => openFirstContactDetail(page, config.timeoutMs)));

      await page.goto(buildRouteUrl(config, "calendar"), {
        waitUntil: "domcontentloaded",
        timeout: config.timeoutMs,
      });
      await waitForPerfRouteReady(page, "calendar", config.timeoutMs);
      calendarDetailSamples.push(await measureScenario(async () => openFirstCalendarDetail(page, config.timeoutMs)));
    }
    summary.detail_opens.task = summarizeSamples(taskDetailSamples);
    summary.detail_opens.contact = summarizeSamples(contactDetailSamples);
    summary.detail_opens.calendar = summarizeSamples(calendarDetailSamples);

    await goHome(page, config);
    await openRouteFromHome(page, "connect", config.timeoutMs);
    await waitForConnectSearch(page, config.appSlug, config.timeoutMs);
    await captureNamedScreenshot(page, config.reportDir, config, "connect-search", summary);
    const authResult = await measureScenario(async () => {
      const auth = await triggerConnectAuth(page, config);
      return {
        auth_surface: auth.surface,
        auth_url: auth.url,
        auth_title: auth.title,
      };
    });
    summary.connect_auth = authResult;
    if (authResult.auth_url) {
      const authTargetPage = Array.from(context.pages()).find(candidate => candidate.url() === authResult.auth_url) || page;
      await captureNamedScreenshot(authTargetPage, config.reportDir, config, "connect-auth", summary);
    }

    summary.failed_requests = tracking.failedRequests;
    summary.http_error_responses = tracking.httpErrorResponses;
    summary.console_errors = tracking.consoleErrors;
    summary.page_errors = tracking.pageErrors;
    summary.server_telemetry = await fetchServerTelemetry(config);
    if (summary.server_telemetry) {
      summary.server_telemetry_path = path.join(config.reportDir, "server-telemetry.json");
      writeJsonFile(summary.server_telemetry_path, summary.server_telemetry);
    }
    summary.diff = buildDiff(summary, config.baseline);
    summary.ok = true;
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    summary.error = String(error?.stack || error?.message || error);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
