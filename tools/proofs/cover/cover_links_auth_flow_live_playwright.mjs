import path from "node:path";

import { chromium } from "playwright-core";

import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile,
} from "../../support/cover_shared.mjs";

const RESULT_SCHEMA = "pucky.links_auth_flow_live_browser_proof.v1";
const DEFAULT_BASE_URL = process.env.PUCKY_LINKS_AUTH_BASE_URL || "https://pucky.fly.dev";
const DEFAULT_APP_SLUG = process.env.PUCKY_CONNECT_APP_SLUG || "slack";

function resolveApiToken() {
  const candidates = [
    process.env.PUCKY_WEB_UI_TOKEN,
    process.env.PUCKY_API_TOKEN,
    process.env.PUCKY_OPERATOR_TOKEN,
  ];
  for (const candidate of candidates) {
    const token = String(candidate || "").trim();
    if (token) {
      return token;
    }
  }
  return "";
}

function parseArgs(argv) {
  const args = {
    baseUrl: String(DEFAULT_BASE_URL || "").replace(/\/+$/, ""),
    apiToken: resolveApiToken(),
    appSlug: String(DEFAULT_APP_SLUG || "slack").trim().toLowerCase() || "slack",
    reportDir: path.resolve(".tmp", "links-auth-flow-live-browser"),
    timeoutMs: 45000,
    refreshKey: String(process.env.PUCKY_REFRESH_KEY || "").trim(),
    viewportWidth: 430,
    viewportHeight: 932,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || "");
    if (value === "--base-url" && argv[index + 1]) {
      args.baseUrl = String(argv[index + 1] || args.baseUrl).replace(/\/+$/, "");
      index += 1;
    } else if (value === "--api-token" && argv[index + 1]) {
      args.apiToken = String(argv[index + 1] || args.apiToken).trim();
      index += 1;
    } else if (value === "--app-slug" && argv[index + 1]) {
      args.appSlug = String(argv[index + 1] || args.appSlug).trim().toLowerCase() || args.appSlug;
      index += 1;
    } else if (value === "--report-dir" && argv[index + 1]) {
      args.reportDir = path.resolve(String(argv[index + 1] || args.reportDir));
      index += 1;
    } else if (value === "--timeout-ms" && argv[index + 1]) {
      args.timeoutMs = Math.max(1000, Number(argv[index + 1]) || args.timeoutMs);
      index += 1;
    } else if (value === "--refresh-key" && argv[index + 1]) {
      args.refreshKey = String(argv[index + 1] || "").trim();
      index += 1;
    } else if (value === "--viewport-width" && argv[index + 1]) {
      args.viewportWidth = Math.max(320, Number(argv[index + 1]) || args.viewportWidth);
      index += 1;
    } else if (value === "--viewport-height" && argv[index + 1]) {
      args.viewportHeight = Math.max(480, Number(argv[index + 1]) || args.viewportHeight);
      index += 1;
    }
  }
  if (!args.apiToken) {
    throw new Error("Live Connect browser proof requires --api-token or PUCKY_API_TOKEN/PUCKY_WEB_UI_TOKEN.");
  }
  return args;
}

function buildConnectUrl(config) {
  const url = new URL("/ui/pucky/latest/index.html", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  url.searchParams.set("theme", "light");
  url.searchParams.set("route", "connect");
  url.searchParams.set("reset_nav", "1");
  url.searchParams.set("api_token", String(config.apiToken || "").trim());
  if (String(config.refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(config.refreshKey || "").trim());
  }
  return url.toString();
}

function isIgnorableAuthUrl(url, connectUrl) {
  const text = String(url || "").trim();
  if (!text || text === "about:blank" || text === connectUrl) {
    return true;
  }
  return /\/ui\/pucky\/latest\/?/i.test(text) && /route=connect/i.test(text);
}

async function safeText(page) {
  try {
    const text = await page.locator("body").first().textContent({ timeout: 5000 });
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
  } catch (_error) {
    return "";
  }
}

async function safeSnapshot(page) {
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    body_text: await safeText(page),
  };
}

async function readConnectState(page) {
  return page.evaluate(() => {
    const metrics = window.PuckyUiDebug?.linksMetrics?.() || null;
    const debugRoot = window.__PUCKY_LINKS_DEBUG__ || null;
    const rows = Array.from(document.querySelectorAll(".links-app-row")).slice(0, 12).map(node => ({
      slug: String(node.getAttribute("data-links-slug") || ""),
      text: String(node.textContent || "").replace(/\s+/g, " ").trim(),
    }));
    return {
      url: window.location.href,
      title: document.title,
      metrics,
      last_handoff: debugRoot?.last_handoff || null,
      last_event: debugRoot?.last_event || null,
      rows,
      body_text: String(document.body?.innerText || "").replace(/\s+/g, " ").trim(),
    };
  });
}

async function waitForAuthTransition({ page, context, connectUrl, timeoutMs }) {
  let popupPage = null;
  const onPage = nextPage => {
    if (!popupPage) {
      popupPage = nextPage;
    }
  };
  context.on("page", onPage);
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (popupPage) {
        await popupPage.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
        if (!isIgnorableAuthUrl(popupPage.url(), connectUrl)) {
          return { kind: "popup", page: popupPage, snapshot: await safeSnapshot(popupPage) };
        }
      }
      if (!isIgnorableAuthUrl(page.url(), connectUrl)) {
        return { kind: "same_tab", page, snapshot: await safeSnapshot(page) };
      }
      await page.waitForTimeout(250);
    }
    return { kind: "none", page, snapshot: await safeSnapshot(page) };
  } finally {
    context.off("page", onPage);
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);

  const connectUrl = buildConnectUrl(config);
  const viewport = { width: config.viewportWidth, height: config.viewportHeight };
  const browser = await chromium.launch({
    executablePath: resolveChromePath(),
    headless: true,
  });
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    hasTouch: config.viewportWidth <= 500,
    isMobile: config.viewportWidth <= 500,
  });
  const summary = {
    schema: RESULT_SCHEMA,
    ok: false,
    base_url: config.baseUrl,
    connect_url: connectUrl,
    app_slug: config.appSlug,
    viewport,
    debug_contract_present: false,
    auth_transition: null,
    before_click: null,
    after_click: null,
    screenshots: {},
  };

  try {
    const page = await context.newPage();
    attachPageLogging(page, path.join(config.reportDir, "browser-console.log"));

    await page.goto(connectUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await page.waitForSelector(".links-search", { timeout: config.timeoutMs });
    await page.waitForFunction(() => {
      const metrics = window.PuckyUiDebug?.linksMetrics?.();
      return Boolean(metrics?.api_token_present) && (Boolean(metrics?.portal_token_present) || !Boolean(metrics?.loading));
    }, null, { timeout: config.timeoutMs }).catch(() => null);

    const initialState = await readConnectState(page);
    const metrics = initialState.metrics || {};
    const hasDebugContract = Object.prototype.hasOwnProperty.call(metrics, "api_token_present")
      && Object.prototype.hasOwnProperty.call(metrics, "portal_token_present")
      && Object.prototype.hasOwnProperty.call(metrics, "filtered_slugs")
      && Object.prototype.hasOwnProperty.call(metrics, "last_handoff_event");
    summary.before_click = initialState;
    summary.debug_contract_present = hasDebugContract;
    summary.screenshots.connect = await saveScreenshot(page, config.reportDir, "links-auth-live-connect");

    if (hasDebugContract && !metrics.api_token_present) {
      throw new Error("Connect never reported api_token_present=true on the deployed page.");
    }
    if (hasDebugContract && !metrics.portal_token_present) {
      throw new Error(
        `Connect never minted a portal token on the deployed page. inline_message=${String(metrics.inline_message || "").trim() || "<empty>"}`
      );
    }
    if (String(metrics.inline_message || "").trim()) {
      throw new Error(`Connect surfaced an inline error before click: ${metrics.inline_message}`);
    }

    await page.locator(".links-search").fill(config.appSlug);
    if (hasDebugContract) {
      await page.waitForFunction(
        slug => {
          const next = window.PuckyUiDebug?.linksMetrics?.();
          return Boolean(Array.isArray(next?.filtered_slugs) && next.filtered_slugs.includes(slug));
        },
        config.appSlug,
        { timeout: config.timeoutMs }
      );
    }
    const row = page.locator(`.links-app-row[data-links-slug="${config.appSlug}"]`).first();
    await row.waitFor({ state: "visible", timeout: config.timeoutMs });
    summary.screenshots.search = await saveScreenshot(page, config.reportDir, "links-auth-live-search");

    await row.click();
    const transition = await waitForAuthTransition({
      page,
      context,
      connectUrl,
      timeoutMs: config.timeoutMs,
    });
    summary.auth_transition = { kind: transition.kind, ...transition.snapshot };
    summary.after_click = transition.kind === "same_tab" ? null : await readConnectState(page).catch(() => null);

    if (transition.kind === "popup") {
      summary.screenshots.auth = await saveScreenshot(transition.page, config.reportDir, "links-auth-live-popup");
    } else {
      summary.screenshots.auth = await saveScreenshot(page, config.reportDir, "links-auth-live-auth");
    }

    if (transition.kind === "none") {
      const afterState = await readConnectState(page).catch(() => null);
      throw new Error(
        `Clicking ${config.appSlug} never opened an auth surface. Last handoff event was ${afterState?.metrics?.last_handoff_event || "<none>"}.`
      );
    }
    if (transition.kind === "same_tab" && isIgnorableAuthUrl(transition.snapshot.url, connectUrl)) {
      throw new Error(`Same-tab auth handoff never left Connect: ${transition.snapshot.url}`);
    }
    if (transition.kind === "popup" && isIgnorableAuthUrl(transition.snapshot.url, connectUrl)) {
      throw new Error(`Popup auth handoff never reached a real auth URL: ${transition.snapshot.url}`);
    }

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
