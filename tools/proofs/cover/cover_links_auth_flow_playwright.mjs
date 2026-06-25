import http from "node:http";
import path from "node:path";

import { chromium } from "playwright-core";

import {
  attachPageLogging,
  ensureDir,
  fileUrl,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile,
} from "../../support/cover_shared.mjs";

const RESULT_SCHEMA = "pucky.links_auth_flow_browser_proof.v1";
const DEFAULT_UI_PATH = process.env.PUCKY_LINKS_AUTH_UI_PATH
  ? path.resolve(process.env.PUCKY_LINKS_AUTH_UI_PATH)
  : path.resolve(process.cwd(), "..", "pucky_vm", "ui_src", "index.html");
const VIEWPORT = { width: 430, height: 932 };
const BROWSER_API_TOKEN = "browser-proof-token";
const PORTAL_TOKEN = "portal-proof-token";
const SEARCH_QUERY = "slack";

function parseArgs(argv) {
  const args = {
    uiPath: DEFAULT_UI_PATH,
    reportDir: path.resolve(".tmp", "links-auth-flow-browser"),
    timeoutMs: 30000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--ui-path" && argv[index + 1]) {
      args.uiPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === "--report-dir" && argv[index + 1]) {
      args.reportDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (value === "--timeout-ms" && argv[index + 1]) {
      args.timeoutMs = Math.max(1000, Number(argv[index + 1]) || args.timeoutMs);
      index += 1;
    }
  }
  args.uiPath = path.resolve(args.uiPath);
  return args;
}

function buildConnectUrl(uiPath) {
  return `${fileUrl(uiPath)}?theme=light&route=connect&reset_nav=1&api_token=${encodeURIComponent(BROWSER_API_TOKEN)}`;
}

function jsonResponse(statusCode, payload) {
  return {
    status: statusCode,
    contentType: "application/json",
    body: JSON.stringify(payload),
  };
}

function makeAuthServer() {
  const state = {
    requests: [],
  };
  const server = http.createServer((request, response) => {
    state.requests.push({
      at: new Date().toISOString(),
      method: request.method || "GET",
      url: request.url || "/",
      headers: request.headers,
    });
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body><h1>Slack Auth Proof</h1><p>Composio auth flow reached.</p></body></html>");
  });
  return {
    state,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not determine auth proof server address");
      }
      return { port: address.port };
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);

  const authServer = makeAuthServer();
  const { port } = await authServer.listen();
  const authUrl = `http://127.0.0.1:${port}/composio-auth/slack`;
  const connectUrl = buildConnectUrl(config.uiPath);
  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    screen: VIEWPORT,
    hasTouch: true,
    isMobile: true,
  });
  const requestLog = [];
  context.on("request", request => {
    requestLog.push({
      at: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      resource_type: request.resourceType(),
    });
  });

  const summary = {
    schema: RESULT_SCHEMA,
    ok: false,
    ui_path: config.uiPath,
    connect_url: connectUrl,
    auth_url: authUrl,
    popup_url: "",
    portal_requests: [],
    oauth_requests: [],
    auth_requests: [],
    links_metrics_before_click: null,
    links_metrics_after_click: null,
    screenshots: {},
  };

  try {
    await context.route("**/api/links/composio/portal-url", async route => {
      const headers = route.request().headers();
      summary.portal_requests.push({
        authorization: String(headers.authorization || ""),
        url: route.request().url(),
      });
      await route.fulfill(jsonResponse(200, {
        ok: true,
        schema: "pucky.links_portal_url.v1",
        portal_url: `https://pucky.test/links/connect/apps?token=${PORTAL_TOKEN}&auth_mode=browser`,
        token: PORTAL_TOKEN,
        auth_mode: "browser",
        user_id: "browser-proof-user",
        available: true,
      }));
    });
    await context.route("**/api/links/composio/my-apps**", async route => {
      await route.fulfill(jsonResponse(200, {
        ok: true,
        schema: "pucky.links_my_apps.v1",
        user_id: "browser-proof-user",
        apps: [],
        summary: { connected: 0, needs_attention: 0, interacted: 0 },
      }));
    });
    await context.route("**/api/links/composio/oauth/start**", async route => {
      const requestUrl = new URL(route.request().url());
      summary.oauth_requests.push({
        url: route.request().url(),
        app: requestUrl.searchParams.get("app") || "",
        token: requestUrl.searchParams.get("token") || "",
        auth_mode: requestUrl.searchParams.get("auth_mode") || "",
      });
      await route.fulfill(jsonResponse(200, {
        ok: true,
        schema: "pucky.links_oauth_start.v1",
        user_id: "browser-proof-user",
        slug: requestUrl.searchParams.get("app") || "",
        auth_mode: "browser",
        auth_url: authUrl,
        redirect_url: "",
        connection_id: "ca_slack_proof",
      }));
    });

    const page = await context.newPage();
    attachPageLogging(page, path.join(config.reportDir, "browser-console.log"));

    await page.goto(connectUrl, { waitUntil: "networkidle", timeout: config.timeoutMs });
    await page.waitForSelector(".links-search", { timeout: config.timeoutMs });
    await page.waitForFunction(
      () => Boolean(window.PuckyUiDebug?.linksMetrics?.().api_token_present),
      null,
      { timeout: config.timeoutMs }
    );
    await page.waitForFunction(
      () => Boolean(window.PuckyUiDebug?.linksMetrics?.().portal_token_present),
      null,
      { timeout: config.timeoutMs }
    );
    summary.links_metrics_before_click = await page.evaluate(() => window.PuckyUiDebug?.linksMetrics?.() || null);
    summary.screenshots.before = await saveScreenshot(page, config.reportDir, "links-auth-before-click");

    await page.locator(".links-search").fill(SEARCH_QUERY);
    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll(".links-app-row"));
      return rows.length > 0 && rows.every(row => /slack/i.test(row.textContent || ""));
    }, null, { timeout: config.timeoutMs });

    let popup = null;
    const onPage = nextPage => {
      if (!popup) {
        popup = nextPage;
      }
    };
    context.on("page", onPage);
    await page.locator('.links-app-row[data-links-slug="slack"]').first().click();
    const deadline = Date.now() + config.timeoutMs;
    while (Date.now() < deadline) {
      if (popup) {
        await popup.waitForLoadState("domcontentloaded", { timeout: Math.min(config.timeoutMs, 5000) }).catch(() => {});
        summary.popup_url = popup.url();
        if (summary.popup_url && summary.popup_url !== "about:blank") {
          break;
        }
      }
      if (page.url() !== connectUrl) {
        break;
      }
      if (authServer.state.requests.some(entry => String(entry.url || "").startsWith("/composio-auth/slack"))) {
        break;
      }
      await page.waitForTimeout(150);
    }
    context.off("page", onPage);
    if (popup) {
      summary.popup_url = popup.url();
      summary.screenshots.popup = await saveScreenshot(popup, config.reportDir, "links-auth-popup");
    }

    const authDeadline = Date.now() + config.timeoutMs;
    while (Date.now() < authDeadline && !authServer.state.requests.some(entry => String(entry.url || "").startsWith("/composio-auth/slack"))) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    summary.auth_requests = authServer.state.requests;
    summary.links_metrics_after_click = await page.evaluate(() => window.PuckyUiDebug?.linksMetrics?.() || null);
    summary.screenshots.after = await saveScreenshot(page, config.reportDir, "links-auth-after-click");

    if (!summary.portal_requests.length) {
      throw new Error("Browser proof never requested /api/links/composio/portal-url.");
    }
    if (summary.portal_requests[0].authorization !== `Bearer ${BROWSER_API_TOKEN}`) {
      throw new Error(`Browser proof used unexpected portal authorization: ${summary.portal_requests[0].authorization || "<missing>"}`);
    }
    if (!summary.oauth_requests.some(entry => entry.app === "slack" && entry.token === PORTAL_TOKEN && entry.auth_mode === "browser")) {
      throw new Error("Browser proof never requested oauth/start for Slack with the minted portal token.");
    }
    if (!summary.auth_requests.some(entry => String(entry.url || "").startsWith("/composio-auth/slack"))) {
      throw new Error("Browser proof never reached the mocked Composio auth URL.");
    }
    if (summary.popup_url && summary.popup_url !== authUrl) {
      throw new Error(`Browser proof opened the wrong popup URL: ${summary.popup_url}`);
    }

    summary.ok = true;
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    writeJsonFile(path.join(config.reportDir, "network.json"), requestLog);
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    summary.error = String(error?.stack || error?.message || error);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    throw error;
  } finally {
    await authServer.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
