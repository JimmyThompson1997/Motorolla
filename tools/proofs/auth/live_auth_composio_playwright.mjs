import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile,
} from "../../support/cover_shared.mjs";
import {
  DEFAULT_OTP_CODE,
  captureBodyText,
  fillEmailAddress,
  fillOtpCode,
  maskEmail,
  maybeClickOneOf,
  pageApiJson,
  pageFetchMeta,
  primeBrowserPreviewToken,
  requireValue,
  safeOrigin,
  waitForOtpInput,
  waitForWorkspaceReady,
} from "../../support/auth_release_shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RESULT_SCHEMA = "pucky.live_auth_composio_proof.v1";
const DEFAULT_BASE_URL = process.env.PUCKY_AUTH_BASE_URL || "https://pucky.fly.dev";
const DEFAULT_LOGIN_URL = process.env.PUCKY_AUTH_LOGIN_URL || `${String(DEFAULT_BASE_URL || "").replace(/\/+$/, "")}/sign-in`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function truthy(value, fallback = false) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return fallback;
  }
  return !["0", "false", "no", "off"].includes(text);
}

function envValue(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function interpolateTemplate(template, values) {
  let output = String(template || "");
  for (const [key, value] of Object.entries(values || {})) {
    output = output.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return output;
}

function buildUserConfig(prefix) {
  const normalized = prefix.toUpperCase();
  return {
    label: prefix.toLowerCase() === "a" ? "User A" : "User B",
    email: envValue(`PUCKY_AUTH_USER_${normalized}_EMAIL`),
    otpCode: envValue(`PUCKY_AUTH_USER_${normalized}_OTP_CODE`),
    otpCommand: envValue(`PUCKY_AUTH_USER_${normalized}_OTP_COMMAND`, "PUCKY_AUTH_OTP_COMMAND"),
  };
}

function parseJsonEnv(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const config = {
    baseUrl: String(DEFAULT_BASE_URL || "").replace(/\/+$/, ""),
    loginUrl: String(DEFAULT_LOGIN_URL || "").trim(),
    browserPreviewToken: envValue("PUCKY_AUTH_COMPOSIO_BROWSER_PREVIEW_TOKEN", "PUCKY_AUTH_BROWSER_PREVIEW_TOKEN"),
    workspaceHostPattern: envValue("PUCKY_AUTH_WORKSPACE_HOST_PATTERN"),
    appSlug: envValue("PUCKY_COMPOSIO_APP_SLUG", "PUCKY_AUTH_COMPOSIO_APP_SLUG") || "gmail",
    timeoutMs: Math.max(15000, Number(process.env.PUCKY_COMPOSIO_TIMEOUT_MS || "60000") || 60000),
    connectWaitMs: Math.max(10000, Number(process.env.PUCKY_COMPOSIO_CONNECT_WAIT_MS || "120000") || 120000),
    reportDir: path.resolve(".tmp", "live-auth-composio-proof", timestampSlug()),
    connectViaUi: truthy(process.env.PUCKY_COMPOSIO_CONNECT_VIA_UI, true),
    requireUserBOwnConnection: truthy(process.env.PUCKY_COMPOSIO_REQUIRE_USER_B_OWN_CONNECTION, false),
    requireVerificationCommand: truthy(process.env.PUCKY_COMPOSIO_REQUIRE_VERIFICATION_COMMAND, false),
    headed: false,
    userA: buildUserConfig("A"),
    userB: buildUserConfig("B"),
    userAAction: parseJsonEnv("PUCKY_COMPOSIO_USER_A_ACTION_JSON"),
    userBAction: parseJsonEnv("PUCKY_COMPOSIO_USER_B_ACTION_JSON"),
    userAVerifyCommand: envValue("PUCKY_COMPOSIO_USER_A_VERIFY_COMMAND"),
    userBVerifyCommand: envValue("PUCKY_COMPOSIO_USER_B_VERIFY_COMMAND"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).replace(/\/+$/, "");
    } else if (arg === "--login-url" && argv[index + 1]) {
      config.loginUrl = String(argv[++index] || config.loginUrl).trim();
    } else if (arg === "--app-slug" && argv[index + 1]) {
      config.appSlug = String(argv[++index] || config.appSlug).trim().toLowerCase() || config.appSlug;
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(15000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--connect-wait-ms" && argv[index + 1]) {
      config.connectWaitMs = Math.max(10000, Number(argv[++index] || config.connectWaitMs) || config.connectWaitMs);
    } else if (arg === "--headed") {
      config.headed = true;
    }
  }
  config.userA.email = requireValue(config.userA.email, "PUCKY_AUTH_USER_A_EMAIL");
  config.userB.email = requireValue(config.userB.email, "PUCKY_AUTH_USER_B_EMAIL");
  if (config.requireVerificationCommand) {
    assert(config.userAAction, "PUCKY_COMPOSIO_REQUIRE_VERIFICATION_COMMAND requires PUCKY_COMPOSIO_USER_A_ACTION_JSON.");
    assert(config.userAVerifyCommand, "PUCKY_COMPOSIO_REQUIRE_VERIFICATION_COMMAND requires PUCKY_COMPOSIO_USER_A_VERIFY_COMMAND.");
  }
  return config;
}

function resolveOtpCode(userConfig) {
  if (String(userConfig.otpCode || "").trim()) {
    return String(userConfig.otpCode || "").trim();
  }
  if (String(userConfig.otpCommand || "").trim()) {
    const command = interpolateTemplate(userConfig.otpCommand, {
      email: userConfig.email,
      label: userConfig.label,
    });
    const shell = process.env.SHELL || "/bin/zsh";
    const completed = spawnSync(shell, ["-lc", command], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30000,
    });
    const stdout = String(completed.stdout || "").trim();
    if (completed.status === 0 && stdout) {
      return stdout.split(/\r?\n/).at(-1)?.trim() || stdout;
    }
    throw new Error(
      `${userConfig.label}: OTP command failed (${completed.status ?? "unknown"}): ${String(completed.stderr || completed.stdout || "").trim()}`
    );
  }
  if (truthy(process.env.PUCKY_AUTH_ALLOW_DEFAULT_TEST_OTP, false)) {
    return DEFAULT_OTP_CODE;
  }
  throw new Error(`${userConfig.label}: missing OTP source. Set PUCKY_AUTH_USER_*_OTP_CODE or PUCKY_AUTH_OTP_COMMAND.`);
}

function expandNodeModuleCandidates(basePath) {
  const candidates = [basePath];
  const pnpmRoot = path.join(basePath, ".pnpm");
  if (!fs.existsSync(pnpmRoot)) {
    return candidates;
  }
  for (const entry of fs.readdirSync(pnpmRoot)) {
    if (!String(entry || "").startsWith("playwright")) {
      continue;
    }
    candidates.push(path.join(pnpmRoot, entry, "node_modules"));
  }
  return candidates;
}

let playwrightBrowsersPromise = null;

async function loadPlaywrightBrowsers() {
  if (playwrightBrowsersPromise) {
    return playwrightBrowsersPromise;
  }
  playwrightBrowsersPromise = (async () => {
    const require = createRequire(import.meta.url);
    const candidates = [];
    if (process.env.CODEX_NODE_MODULES) {
      candidates.push(process.env.CODEX_NODE_MODULES);
    }
    candidates.push(path.join(ROOT, "tools", "node_modules"));
    candidates.push(path.join(ROOT, "node_modules"));
    for (const candidateRoot of candidates) {
      for (const candidate of expandNodeModuleCandidates(candidateRoot)) {
        try {
          const resolved = require.resolve("playwright-core", { paths: [candidate] });
          const mod = await import(pathToFileURL(resolved).href);
          const chromium = mod?.chromium || mod?.default?.chromium;
          if (chromium) {
            return { chromium };
          }
        } catch (_error) {
          // Try the next candidate.
        }
      }
    }
    throw new Error("Could not resolve playwright-core from bundled or local node_modules");
  })();
  return playwrightBrowsersPromise;
}

async function launchBrowser(headed) {
  const { chromium } = await loadPlaywrightBrowsers();
  return chromium.launch({
    executablePath: resolveChromePath(),
    headless: !headed,
  });
}

async function buildContext(browser, reportDir, browserPreviewToken) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    screen: { width: 1440, height: 980 },
    deviceScaleFactor: 2,
    recordVideo: {
      dir: path.join(reportDir, "videos"),
      size: { width: 1440, height: 980 },
    },
  });
  if (browserPreviewToken) {
    await primeBrowserPreviewToken(context, browserPreviewToken);
  }
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  return context;
}

function buildRouteUrl(landingUrl, route) {
  const url = new URL(String(landingUrl || ""));
  url.searchParams.set("route", String(route || "connect"));
  url.searchParams.set("reset_nav", "1");
  return url.toString();
}

async function performOtpLogin(page, userConfig, config, reportDir, screenshotPrefix) {
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  const signedOut = await saveScreenshot(page, reportDir, `${screenshotPrefix}-signed-out`);
  await fillEmailAddress(page, userConfig.email, config.timeoutMs);
  await maybeClickOneOf(page, ["Continue", "Send code", "Send Code", "Sign in", "Sign up", "Create account"], 2500);
  await waitForOtpInput(page, config.timeoutMs);
  const otpScreenshot = await saveScreenshot(page, reportDir, `${screenshotPrefix}-otp`);
  await fillOtpCode(page, resolveOtpCode(userConfig), config.timeoutMs);
  await maybeClickOneOf(page, ["Continue", "Verify", "Verify code", "Sign in", "Submit"], 2500);
  const landing = await waitForWorkspaceReady(page, {
    timeoutMs: config.timeoutMs,
    workspaceHostPattern: config.workspaceHostPattern,
    loginUrl: config.loginUrl,
  });
  const landingScreenshot = await saveScreenshot(page, reportDir, `${screenshotPrefix}-landing`);
  return {
    signedOut,
    otpScreenshot,
    landingScreenshot,
    landing,
  };
}

async function ensureConnectPage(page, landingUrl, config, reportDir, screenshotPrefix) {
  const connectUrl = buildRouteUrl(landingUrl, "connect");
  await page.goto(connectUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await page.waitForFunction(
    () => Boolean(document.querySelector(".links-search") || document.querySelector(".links-empty") || document.querySelector(".links-message")),
    null,
    { timeout: config.timeoutMs }
  );
  const screenshot = await saveScreenshot(page, reportDir, `${screenshotPrefix}-connect`);
  return {
    connectUrl,
    screenshot,
  };
}

async function readConnectState(page) {
  return page.evaluate(() => {
    const metrics = window.PuckyUiDebug?.linksMetrics?.() || null;
    const chips = Array.from(document.querySelectorAll(".links-connected-chip")).map(node => ({
      slug: String(node.getAttribute("data-links-connected-slug") || "").trim().toLowerCase(),
      text: String(node.textContent || "").replace(/\s+/g, " ").trim(),
    }));
    const rows = Array.from(document.querySelectorAll(".links-app-row")).slice(0, 16).map(node => ({
      slug: String(node.getAttribute("data-links-slug") || "").trim().toLowerCase(),
      text: String(node.textContent || "").replace(/\s+/g, " ").trim(),
    }));
    return {
      url: window.location.href,
      title: document.title,
      metrics,
      chips,
      rows,
      body: String(document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1200),
    };
  });
}

async function fetchPortalInfo(page, baseUrl) {
  const result = await pageApiJson(page, `${baseUrl}/api/links/composio/portal-url?auth_mode=browser`);
  assert(result.ok, `Could not mint a Composio portal token: ${JSON.stringify(result.payload)}`);
  const portalUrl = String(result.payload?.portal_url || "").trim();
  const token = new URL(portalUrl).searchParams.get("token") || "";
  assert(token, "Portal URL did not include a token.");
  return {
    portalUrl,
    token,
  };
}

async function fetchMyApps(page, baseUrl, token = "") {
  const suffix = token ? `?token=${encodeURIComponent(token)}` : "";
  const result = await pageApiJson(page, `${baseUrl}/api/links/composio/my-apps${suffix}`);
  assert(result.ok, `Could not fetch my apps: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function fetchAppDetails(page, baseUrl, slug, token = "") {
  const params = new URLSearchParams({ slug: String(slug || "") });
  if (token) {
    params.set("token", token);
  }
  const result = await pageApiJson(page, `${baseUrl}/api/links/composio/app-details?${params.toString()}`);
  assert(result.ok, `Could not fetch app details for ${slug}: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function waitForConnection(page, baseUrl, portalToken, appSlug, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readConnectState(page);
    const chips = Array.isArray(state.chips) ? state.chips : [];
    if (chips.some(item => item.slug === appSlug)) {
      return {
        by: "ui-chip",
        state,
      };
    }
    const payload = await fetchMyApps(page, baseUrl, portalToken);
    const match = Array.isArray(payload.apps)
      ? payload.apps.find(item => String(item?.slug || "").trim().toLowerCase() === appSlug && Number(item?.counts?.active || 0) > 0)
      : null;
    if (match) {
      return {
        by: "api-my-apps",
        state,
        payload,
      };
    }
    await page.waitForTimeout(1500);
  }
  throw new Error(`Timed out waiting for ${appSlug} to appear as connected.`);
}

async function maybeConnectViaUi(page, config, reportDir, appSlug) {
  const before = await readConnectState(page);
  const search = page.locator(".links-search").first();
  await search.fill("");
  await search.fill(appSlug);
  const row = page.locator(`.links-app-row[data-links-slug="${appSlug}"]`).first();
  await row.waitFor({ state: "visible", timeout: config.timeoutMs });
  const afterSearch = await saveScreenshot(page, reportDir, "connect-search");
  if (!config.connectViaUi) {
    return {
      before,
      afterSearch,
      triggered: false,
      authSurface: null,
    };
  }
  const popupPromise = page.context().waitForEvent("page", { timeout: 7000 }).catch(() => null);
  await row.click();
  let popup = await popupPromise;
  let authSurface = null;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    authSurface = {
      kind: "popup",
      url: popup.url(),
      screenshot: await saveScreenshot(popup, reportDir, "connect-auth-surface"),
    };
  } else {
    await page.waitForTimeout(1500);
    const currentUrl = page.url();
    if (safeOrigin(currentUrl) !== safeOrigin(config.baseUrl) || !currentUrl.includes("/ui/pucky/latest")) {
      authSurface = {
        kind: "same_tab",
        url: currentUrl,
        screenshot: await saveScreenshot(page, reportDir, "connect-auth-surface"),
      };
    }
  }
  return {
    before,
    afterSearch,
    triggered: true,
    authSurface,
  };
}

function findAppRow(payload, appSlug) {
  return Array.isArray(payload?.apps)
    ? payload.apps.find(item => String(item?.slug || "").trim().toLowerCase() === appSlug)
    : null;
}

function connectionIdsFromApp(row) {
  return Array.isArray(row?.details)
    ? row.details.map(item => String(item?.id || "").trim()).filter(Boolean)
    : [];
}

async function executeAction(page, baseUrl, payload) {
  const result = await pageApiJson(page, `${baseUrl}/api/links/composio/actions/execute`, {
    method: "POST",
    body: payload,
  });
  return result;
}

function writeActionResult(reportDir, label, payload) {
  const filePath = path.join(reportDir, `${label}.json`);
  writeJsonFile(filePath, payload);
  return filePath;
}

function runVerificationCommand(template, values) {
  const command = interpolateTemplate(template, values);
  const shell = process.env.SHELL || "/bin/zsh";
  const completed = spawnSync(shell, ["-lc", command], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
  return {
    command,
    status: completed.status ?? 1,
    stdout: String(completed.stdout || ""),
    stderr: String(completed.stderr || ""),
  };
}

async function finalizeContext(context, reportDir, traceName) {
  const tracePath = path.join(reportDir, `${traceName}.zip`);
  await context.tracing.stop({ path: tracePath }).catch(() => {});
  return {
    trace: tracePath,
  };
}

function renderReport(summary) {
  const lines = [
    "# Live Auth Composio Proof",
    "",
    `- Verdict: ${summary.ok ? "pass" : "fail"}`,
    `- App slug: ${summary.app_slug}`,
    `- User A: ${maskEmail(summary.user_a?.email || "")}`,
    `- User B: ${maskEmail(summary.user_b?.email || "")}`,
    "",
    "## Highlights",
    "",
    `- User A connection id: ${summary.user_a?.connection_id || "<none>"}`,
    `- User B connection id: ${summary.user_b?.connection_id || "<none>"}`,
    `- Foreign execute status: ${summary.negative_checks?.foreign_execute?.status ?? "<none>"}`,
    `- Foreign disconnect status: ${summary.negative_checks?.foreign_disconnect?.status ?? "<none>"}`,
    "",
  ];
  if (summary.error) {
    lines.push("## Error", "", "```", String(summary.error || ""), "```");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const summary = {
    schema: RESULT_SCHEMA,
    ok: false,
    base_url: config.baseUrl,
    login_url: config.loginUrl,
    app_slug: config.appSlug,
    report_dir: config.reportDir,
    user_a: { email: config.userA.email },
    user_b: { email: config.userB.email },
    negative_checks: {},
  };
  const browser = await launchBrowser(config.headed);
  try {
    const userAContext = await buildContext(browser, path.join(config.reportDir, "user-a"), config.browserPreviewToken);
    const userAPage = await userAContext.newPage();
    attachPageLogging(userAPage, path.join(config.reportDir, "user-a", "browser-console.log"));
    const userALogin = await performOtpLogin(userAPage, config.userA, config, path.join(config.reportDir, "user-a"), "user-a");
    summary.user_a.login = userALogin;
    const userAConnect = await ensureConnectPage(userAPage, userALogin.landing.url, config, path.join(config.reportDir, "user-a"), "user-a");
    summary.user_a.connect = userAConnect;
    const userAPortal = await fetchPortalInfo(userAPage, config.baseUrl);
    summary.user_a.portal_url = userAPortal.portalUrl;
    const userABefore = await fetchMyApps(userAPage, config.baseUrl, userAPortal.token);
    summary.user_a.before = userABefore;
    const connectAttempt = await maybeConnectViaUi(userAPage, config, path.join(config.reportDir, "user-a"), config.appSlug);
    summary.user_a.connect_attempt = connectAttempt;
    const userAWait = await waitForConnection(userAPage, config.baseUrl, userAPortal.token, config.appSlug, config.connectWaitMs);
    summary.user_a.connection_ready = userAWait;
    summary.user_a.connected_screenshot = await saveScreenshot(userAPage, path.join(config.reportDir, "user-a"), "user-a-connected");
    const userAAfter = await fetchMyApps(userAPage, config.baseUrl, userAPortal.token);
    const userAApp = findAppRow(userAAfter, config.appSlug);
    assert(userAApp, `User A my-apps did not include ${config.appSlug}`);
    const userAConnectionIds = connectionIdsFromApp(userAApp);
    assert(userAConnectionIds.length > 0, `User A connection ids missing for ${config.appSlug}`);
    summary.user_a.after = userAAfter;
    summary.user_a.connection_id = userAConnectionIds[0];
    summary.user_a.app_details = await fetchAppDetails(userAPage, config.baseUrl, config.appSlug, userAPortal.token);
    if (config.userAAction) {
      const actionResult = await executeAction(userAPage, config.baseUrl, config.userAAction);
      summary.user_a.action = actionResult;
      assert(actionResult.ok, `User A action failed: ${JSON.stringify(actionResult.payload)}`);
      const resultPath = writeActionResult(path.join(config.reportDir, "user-a"), "action-result", actionResult.payload);
      summary.user_a.action_result_path = resultPath;
      if (config.userAVerifyCommand) {
        const verification = runVerificationCommand(config.userAVerifyCommand, {
          result_json_path: resultPath,
          connection_id: summary.user_a.connection_id,
          app_slug: config.appSlug,
          user_email: config.userA.email,
        });
        summary.user_a.action_verification = verification;
        if (config.requireVerificationCommand) {
          assert(verification.status === 0, `User A verification command failed: ${verification.stderr || verification.stdout}`);
        }
      }
    }
    summary.user_a.artifacts = await finalizeContext(userAContext, path.join(config.reportDir, "user-a"), "trace-user-a");
    await userAContext.close().catch(() => {});

    const userBContext = await buildContext(browser, path.join(config.reportDir, "user-b"), config.browserPreviewToken);
    const userBPage = await userBContext.newPage();
    attachPageLogging(userBPage, path.join(config.reportDir, "user-b", "browser-console.log"));
    const userBLogin = await performOtpLogin(userBPage, config.userB, config, path.join(config.reportDir, "user-b"), "user-b");
    summary.user_b.login = userBLogin;
    const userBConnect = await ensureConnectPage(userBPage, userBLogin.landing.url, config, path.join(config.reportDir, "user-b"), "user-b");
    summary.user_b.connect = userBConnect;
    const userBPortal = await fetchPortalInfo(userBPage, config.baseUrl);
    summary.user_b.portal_url = userBPortal.portalUrl;
    const userBBefore = await fetchMyApps(userBPage, config.baseUrl, userBPortal.token);
    summary.user_b.before = userBBefore;
    const userBBeforeApp = findAppRow(userBBefore, config.appSlug);
    if (userBBeforeApp) {
      const foreignIds = connectionIdsFromApp(userBBeforeApp);
      assert(!foreignIds.includes(summary.user_a.connection_id), "User B my-apps exposed User A's connection id.");
    }

    if (config.userAAction) {
      const noConnectionResult = await executeAction(userBPage, config.baseUrl, config.userAAction);
      summary.negative_checks.no_connection_execute = noConnectionResult;
      assert(!noConnectionResult.ok, "User B action unexpectedly succeeded without its own connection.");
    }

    const foreignExecute = await executeAction(userBPage, config.baseUrl, {
      ...(config.userAAction || {
        action_slug: "GMAIL_FETCH_EMAILS",
        parameters: {},
      }),
      connected_account_id: summary.user_a.connection_id,
    });
    summary.negative_checks.foreign_execute = foreignExecute;
    assert(!foreignExecute.ok, "Foreign connected_account_id execute unexpectedly succeeded.");

    const foreignDisconnect = await pageFetchMeta(
      userBPage,
      `${config.baseUrl}/api/links/composio/disconnect?token=${encodeURIComponent(userBPortal.token)}&connection_id=${encodeURIComponent(summary.user_a.connection_id)}`,
      { expectJson: true }
    );
    summary.negative_checks.foreign_disconnect = foreignDisconnect;
    assert(!foreignDisconnect.ok, "Foreign disconnect unexpectedly succeeded.");

    const foreignDetails = await fetchAppDetails(userBPage, config.baseUrl, config.appSlug, userBPortal.token);
    summary.negative_checks.foreign_details = foreignDetails;
    const foreignDetailIds = Array.isArray(foreignDetails.details)
      ? foreignDetails.details.map(item => String(item?.id || "").trim()).filter(Boolean)
      : [];
    assert(!foreignDetailIds.includes(summary.user_a.connection_id), "User B app details exposed User A connection details.");

    if (config.requireUserBOwnConnection) {
      const userBConnectAttempt = await maybeConnectViaUi(userBPage, config, path.join(config.reportDir, "user-b"), config.appSlug);
      summary.user_b.connect_attempt = userBConnectAttempt;
      const userBWait = await waitForConnection(userBPage, config.baseUrl, userBPortal.token, config.appSlug, config.connectWaitMs);
      summary.user_b.connection_ready = userBWait;
    }

    const userBAfter = await fetchMyApps(userBPage, config.baseUrl, userBPortal.token);
    summary.user_b.after = userBAfter;
    const userBApp = findAppRow(userBAfter, config.appSlug);
    if (userBApp) {
      const userBIds = connectionIdsFromApp(userBApp);
      summary.user_b.connection_id = userBIds[0] || "";
      assert(!userBIds.includes(summary.user_a.connection_id), "User B active connections still included User A's id.");
      if (config.userBAction && summary.user_b.connection_id) {
        const userBActionResult = await executeAction(userBPage, config.baseUrl, {
          ...config.userBAction,
          connected_account_id: summary.user_b.connection_id,
        });
        summary.user_b.action = userBActionResult;
        assert(userBActionResult.ok, `User B action failed: ${JSON.stringify(userBActionResult.payload)}`);
        const resultPath = writeActionResult(path.join(config.reportDir, "user-b"), "action-result", userBActionResult.payload);
        summary.user_b.action_result_path = resultPath;
        if (config.userBVerifyCommand) {
          const verification = runVerificationCommand(config.userBVerifyCommand, {
            result_json_path: resultPath,
            connection_id: summary.user_b.connection_id,
            app_slug: config.appSlug,
            user_email: config.userB.email,
          });
          summary.user_b.action_verification = verification;
          if (config.requireVerificationCommand) {
            assert(verification.status === 0, `User B verification command failed: ${verification.stderr || verification.stdout}`);
          }
        }
      }
    }
    summary.user_b.connected_screenshot = await saveScreenshot(userBPage, path.join(config.reportDir, "user-b"), "user-b-connected");
    summary.user_b.connect_state = await readConnectState(userBPage);
    summary.user_b.body_after = await captureBodyText(userBPage);
    summary.user_b.artifacts = await finalizeContext(userBContext, path.join(config.reportDir, "user-b"), "trace-user-b");
    await userBContext.close().catch(() => {});

    summary.ok = true;
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    fs.writeFileSync(path.join(config.reportDir, "report.md"), renderReport(summary), "utf8");
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    summary.error = String(error?.stack || error?.message || error);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    fs.writeFileSync(path.join(config.reportDir, "report.md"), renderReport(summary), "utf8");
    throw error;
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
