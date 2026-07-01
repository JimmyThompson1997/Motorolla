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
  pageApiMultipartJson,
  pageFetchMeta,
  primeBrowserPreviewToken,
  requireValue,
  safeOrigin,
  splitCsv,
  waitForOtpInput,
  waitForWorkspaceReady,
} from "../../support/auth_release_shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RESULT_SCHEMA = "pucky.live_auth_browser_proof.v1";
const DEFAULT_BASE_URL = process.env.PUCKY_AUTH_BASE_URL || "https://pucky.fly.dev";
const DEFAULT_LOGIN_URL = process.env.PUCKY_AUTH_LOGIN_URL || `${String(DEFAULT_BASE_URL || "").replace(/\/+$/, "")}/sign-in`;
const DEFAULT_MAJOR_ROUTES = [
  "home",
  "inbox",
  "meetings",
  "meeting-notes",
  "reminders",
  "notes",
  "tasks",
  "calendar",
  "projects",
  "contacts",
  "connect",
  "settings",
];
const DEFAULT_LOGOUT_LABELS = ["Sign out", "Log out", "Logout"];
const HOME_TILE_ROUTES = ["inbox", "notes", "tasks", "contacts", "projects", "reminders", "settings"];
const CURRENT_AUTH_BUNDLE_SCRIPTS = ["pucky-browser-state.js", "pucky-browser-unlock.js"];
const LEGACY_BUNDLE_SCRIPTS = ["pucky-ui-state.js"];
const HOME_TILE_LABELS = {
  inbox: "Inbox",
  notes: "Notes",
  tasks: "Tasks",
  contacts: "Contacts",
  projects: "Projects",
  reminders: "Reminders",
  settings: "Settings",
};
const DEFAULT_MATRIX = [
  { label: "chromium-desktop", browserName: "chromium", viewport: { width: 1440, height: 980 }, primaryIsolationLane: true },
  { label: "webkit-desktop", browserName: "webkit", viewport: { width: 1440, height: 980 } },
  { label: "chromium-tablet", browserName: "chromium", viewport: { width: 834, height: 1194 }, hasTouch: true },
  { label: "chromium-mobile-390x844", browserName: "chromium", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  { label: "chromium-mobile-412x915", browserName: "chromium", viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true },
  { label: "chromium-narrow-375x667", browserName: "chromium", viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true },
  { label: "chromium-fold-344x882", browserName: "chromium", viewport: { width: 344, height: 882 }, hasTouch: true, isMobile: true },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "proof";
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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

function truthy(value, fallback = false) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return fallback;
  }
  return !["0", "false", "no", "off"].includes(text);
}

function defaultOtpAllowed() {
  return truthy(process.env.PUCKY_AUTH_ALLOW_DEFAULT_TEST_OTP, false);
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

function parseArgs(argv) {
  const config = {
    baseUrl: String(DEFAULT_BASE_URL || "").replace(/\/+$/, ""),
    loginUrl: String(DEFAULT_LOGIN_URL || "").trim(),
    browserPreviewToken: envValue("PUCKY_AUTH_BROWSER_PREVIEW_TOKEN"),
    workspaceHostPattern: envValue("PUCKY_AUTH_WORKSPACE_HOST_PATTERN"),
    composioDetailsSlug: envValue("PUCKY_AUTH_COMPOSIO_DETAILS_SLUG", "PUCKY_COMPOSIO_APP_SLUG") || "gmail",
    timeoutMs: Math.max(15000, Number(process.env.PUCKY_AUTH_TIMEOUT_MS || "45000") || 45000),
    reportDir: path.resolve(".tmp", "live-auth-browser-proof", timestampSlug()),
    runId: `auth-proof-${Date.now()}`,
    requireDistinctWorkspaceHost: truthy(process.env.PUCKY_AUTH_REQUIRE_DISTINCT_WORKSPACE_HOST, false),
    logoutLabels: DEFAULT_LOGOUT_LABELS.slice(),
    majorRoutes: DEFAULT_MAJOR_ROUTES.slice(),
    matrixFilter: splitCsv(process.env.PUCKY_AUTH_BROWSER_MATRIX || ""),
    userA: buildUserConfig("A"),
    userB: buildUserConfig("B"),
    headed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).replace(/\/+$/, "");
    } else if (arg === "--login-url" && argv[index + 1]) {
      config.loginUrl = String(argv[++index] || config.loginUrl).trim();
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(15000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--run-id" && argv[index + 1]) {
      config.runId = String(argv[++index] || config.runId).trim() || config.runId;
    } else if (arg === "--workspace-host-pattern" && argv[index + 1]) {
      config.workspaceHostPattern = String(argv[++index] || config.workspaceHostPattern).trim();
    } else if (arg === "--user-a-email" && argv[index + 1]) {
      config.userA.email = String(argv[++index] || config.userA.email).trim();
    } else if (arg === "--user-b-email" && argv[index + 1]) {
      config.userB.email = String(argv[++index] || config.userB.email).trim();
    } else if (arg === "--user-a-otp" && argv[index + 1]) {
      config.userA.otpCode = String(argv[++index] || config.userA.otpCode).trim();
    } else if (arg === "--user-b-otp" && argv[index + 1]) {
      config.userB.otpCode = String(argv[++index] || config.userB.otpCode).trim();
    } else if (arg === "--major-routes" && argv[index + 1]) {
      config.majorRoutes = splitCsv(argv[++index]);
    } else if (arg === "--logout-labels" && argv[index + 1]) {
      config.logoutLabels = splitCsv(argv[++index]);
    } else if (arg === "--browser-matrix" && argv[index + 1]) {
      config.matrixFilter = splitCsv(argv[++index]);
    } else if (arg === "--headed") {
      config.headed = true;
    }
  }
  config.userA.email = requireValue(config.userA.email, "PUCKY_AUTH_USER_A_EMAIL");
  config.userB.email = requireValue(config.userB.email, "PUCKY_AUTH_USER_B_EMAIL");
  config.matrix = DEFAULT_MATRIX.filter(item => !config.matrixFilter.length || config.matrixFilter.includes(item.label));
  assert(config.matrix.length > 0, "No browser matrix entries selected.");
  return config;
}

function runGit(args) {
  const completed = spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30000,
  });
  if (completed.status === 0) {
    return String(completed.stdout || "").trim();
  }
  return "";
}

function localGitState() {
  return {
    head: runGit(["rev-parse", "HEAD"]),
    headShort: runGit(["rev-parse", "--short", "HEAD"]),
  };
}

function expectedBundleScripts() {
  const indexPath = path.join(ROOT, "pucky_vm", "ui_src", "index.html");
  const source = fs.readFileSync(indexPath, "utf8");
  const scripts = Array.from(source.matchAll(/<script\s+src="\.\/([^"]+)"/g))
    .map(match => String(match[1] || "").trim())
    .filter(Boolean);
  for (const script of CURRENT_AUTH_BUNDLE_SCRIPTS) {
    assert(scripts.includes(script), `Local auth bundle contract is missing required script ${script}`);
  }
  return scripts;
}

async function fetchRemoteManifest(baseUrl, refreshKey = "") {
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
  assert(response.ok, `Could not load remote manifest from ${url.toString()} (${response.status})`);
  const payload = await response.json().catch(() => ({}));
  assert(payload && typeof payload === "object", `Remote manifest from ${url.toString()} was not valid JSON`);
  return {
    manifestUrl: url.toString(),
    manifest: payload,
  };
}

async function fetchNoRedirect(url) {
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
  return {
    status: response.status,
    location: String(response.headers.get("location") || ""),
  };
}

async function readLoadedBundleScripts(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("script[src]"))
      .map(node => {
        const raw = String(node.getAttribute("src") || "").trim();
        const clean = raw.split("?")[0];
        const parts = clean.split("/");
        return String(parts.at(-1) || "").trim();
      })
      .filter(Boolean)
  );
}

async function verifyBundleFreshness(page, baseUrl, gitState, expectedScripts) {
  const remoteManifest = await fetchRemoteManifest(baseUrl, gitState.headShort || "");
  const observedScripts = await readLoadedBundleScripts(page);
  const missingScripts = expectedScripts.filter(script => !observedScripts.includes(script));
  const unexpectedLegacyScripts = observedScripts.filter(script => LEGACY_BUNDLE_SCRIPTS.includes(script));
  if (gitState.head) {
    assert(
      String(remoteManifest.manifest?.source_commit_full || "") === String(gitState.head),
      `Live manifest commit ${remoteManifest.manifest?.source_commit_full || "<empty>"} does not match release commit ${gitState.head}`
    );
  }
  assert(missingScripts.length === 0, `Live bundle is missing expected scripts: ${missingScripts.join(", ")}`);
  assert(unexpectedLegacyScripts.length === 0, `Live bundle is still serving legacy scripts: ${unexpectedLegacyScripts.join(", ")}`);
  return {
    "manifest_url": remoteManifest.manifestUrl,
    "manifest": remoteManifest.manifest,
    "expected_scripts": expectedScripts,
    "observed_scripts": observedScripts,
    "missing_scripts": missingScripts,
    "unexpected_legacy_scripts": unexpectedLegacyScripts,
  };
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
    for (const candidateRoot of candidates) {
      for (const candidate of expandNodeModuleCandidates(candidateRoot)) {
        try {
          const resolved = require.resolve("playwright-core", { paths: [candidate] });
          const mod = await import(pathToFileURL(resolved).href);
          const chromium = mod?.chromium || mod?.default?.chromium;
          const webkit = mod?.webkit || mod?.default?.webkit;
          if (chromium && webkit) {
            return { chromium, webkit };
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

async function launchConfiguredBrowser(browserName, headed) {
  const { chromium, webkit } = await loadPlaywrightBrowsers();
  if (browserName === "webkit") {
    return webkit.launch({ headless: !headed });
  }
  return chromium.launch({
    executablePath: resolveChromePath(),
    headless: !headed,
  });
}

function interpolateTemplate(template, values) {
  let output = String(template || "");
  for (const [key, value] of Object.entries(values || {})) {
    output = output.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return output;
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
  if (defaultOtpAllowed()) {
    return DEFAULT_OTP_CODE;
  }
  throw new Error(`${userConfig.label}: missing OTP source. Set PUCKY_AUTH_USER_*_OTP_CODE or PUCKY_AUTH_OTP_COMMAND.`);
}

function buildRouteUrl(landingUrl, route) {
  const url = new URL(String(landingUrl || ""));
  url.searchParams.set("route", String(route || "home"));
  url.searchParams.set("reset_nav", "1");
  return url.toString();
}

async function waitForRouteReady(page, route, timeoutMs) {
  const expected = String(route || "home").trim();
  await page.waitForFunction(
    targetRoute => {
      const appShell = document.querySelector(".app-shell");
      const dataView = String(appShell?.getAttribute("data-view") || "").trim();
      const lightShell = document.querySelector(`.light-shell[data-light-route="${targetRoute}"]`);
      if (lightShell) {
        return true;
      }
      if (targetRoute === "home") {
        return dataView === "home" || Boolean(document.querySelector('.light-shell[data-light-route="home"]'));
      }
      return dataView === targetRoute;
    },
    expected,
    { timeout: timeoutMs }
  );
  await page.waitForTimeout(200);
}

function maskCookies(cookies) {
  return (cookies || []).map(cookie => ({
    name: String(cookie.name || ""),
    domain: String(cookie.domain || ""),
    path: String(cookie.path || ""),
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: String(cookie.sameSite || ""),
    expires: Number(cookie.expires || 0),
    value: `${String(cookie.value || "").slice(0, 2)}***`,
  }));
}

async function readRouteSnapshot(page) {
  return page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    route: String(document.querySelector(".app-shell")?.getAttribute("data-view") || document.querySelector(".light-shell")?.getAttribute("data-light-route") || "").trim(),
    bodySnippet: String(document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1200),
  }));
}

function buildSeed(runId, laneLabel) {
  const prefix = slug(`${runId}-${laneLabel}`);
  const nowMs = Date.now();
  return {
    prefix,
    noteId: `${prefix}-note`,
    noteTitle: `Auth Proof Note ${prefix}`,
    taskId: `${prefix}-task`,
    taskTitle: `Auth Proof Task ${prefix}`,
    projectId: `${prefix}-project`,
    projectTitle: `Auth Proof Project ${prefix}`,
    contactId: `${prefix}-contact`,
    contactTitle: `Auth Proof Contact ${prefix}`,
    reminderId: `${prefix}-reminder`,
    reminderTitle: `Auth Proof Reminder ${prefix}`,
    uploadTurnId: `${prefix}-upload`,
    uploadFileName: `${prefix}.txt`,
    uploadText: `Auth artifact upload for ${prefix}`,
    dueAtMs: nowMs + 60 * 60 * 1000,
  };
}

async function seedWorkspaceRecords(page, baseUrl, seed) {
  const ownerSummary = [];
  const contactBody = {
    id: seed.contactId,
    title: seed.contactTitle,
    summary: "Isolation proof contact",
    metadata: {
      email: `${seed.prefix}@example.com`,
      phone: "+1 (415) 555-0177",
      activity: ["Created from auth proof"],
    },
  };
  const projectBody = {
    id: seed.projectId,
    title: seed.projectTitle,
    summary: "Isolation proof project",
    metadata: {
      threads: ["Auth proof thread", "Follow-up"],
    },
  };
  const noteBody = {
    id: seed.noteId,
    title: seed.noteTitle,
    summary: "Isolation proof note",
    html: `<!doctype html><html><body><h1>${seed.noteTitle}</h1><p>Isolation proof note body.</p></body></html>`,
  };
  const taskBody = {
    id: seed.taskId,
    title: seed.taskTitle,
    status: "todo",
    summary: "Isolation proof task",
    description: "Created through the authenticated auth proof lane.",
    due_at_ms: seed.dueAtMs,
    created_by: "Auth Proof",
    created_at_ms: seed.dueAtMs - 15 * 60 * 1000,
  };
  const reminderBody = {
    id: seed.reminderId,
    title: seed.reminderTitle,
    summary: "Isolation proof reminder",
    status: "open",
    due_at_ms: seed.dueAtMs,
    metadata: {
      source_kind: "task",
      source_id: seed.taskId,
    },
  };
  const createSpecs = [
    ["/api/workspace/contacts", contactBody],
    ["/api/workspace/projects", projectBody],
    ["/api/workspace/notes", noteBody],
    ["/api/workspace/tasks", taskBody],
    ["/api/workspace/reminders", reminderBody],
  ];
  for (const [apiPath, body] of createSpecs) {
    const result = await pageApiJson(page, `${baseUrl}${apiPath}`, { method: "POST", body });
    ownerSummary.push({ apiPath, status: result.status, ok: result.ok });
    assert(result.ok, `Seed create failed for ${apiPath}: ${JSON.stringify(result.payload)}`);
  }
  const upload = await pageApiMultipartJson(page, `${baseUrl}/api/turn/text`, {
    fields: {
      text: `Upload ${seed.prefix}`,
      turn_id: seed.uploadTurnId,
    },
    files: [
      {
        fieldName: "files",
        fileName: seed.uploadFileName,
        contentType: "text/plain",
        text: seed.uploadText,
      },
    ],
  });
  ownerSummary.push({ apiPath: "/api/turn/text", status: upload.status, ok: upload.ok });
  assert(upload.ok, `Artifact upload failed: ${JSON.stringify(upload.payload)}`);
  const uploadedAttachments = Array.isArray(upload.payload?.transcript_messages?.[0]?.attachments)
    ? upload.payload.transcript_messages[0].attachments
    : [];
  const uploadedAttachment = uploadedAttachments.find(item => String(item?.title || "").trim() === seed.uploadFileName) || uploadedAttachments[0] || {};
  const artifactId = String(uploadedAttachment?.artifact || "").trim();
  assert(artifactId, "Artifact upload did not return an artifact id.");
  return {
    ownerSummary,
    artifactId,
    uploadedAttachment,
  };
}

async function verifyOwnerApiAssertions(page, baseUrl, seed, artifactId, composioSlug) {
  const checks = [];
  const requests = [
    ["/api/feed?limit=25&compact=1", true],
    ["/api/meetings?compact=1", true],
    [`/api/workspace/notes/${encodeURIComponent(seed.noteId)}`, true],
    [`/api/workspace/tasks/${encodeURIComponent(seed.taskId)}`, true],
    [`/api/workspace/projects/${encodeURIComponent(seed.projectId)}`, true],
    [`/api/workspace/contacts/${encodeURIComponent(seed.contactId)}`, true],
    [`/api/workspace/reminders/${encodeURIComponent(seed.reminderId)}`, true],
    ["/api/links/composio/my-apps", true],
    ["/api/links/composio/catalog", true],
    [`/api/links/composio/all-apps?q=${encodeURIComponent(composioSlug)}&limit=20`, true],
    [`/api/links/composio/app-details?slug=${encodeURIComponent(composioSlug)}`, true],
  ];
  for (const [pathName, shouldSucceed] of requests) {
    const result = await pageFetchMeta(page, `${baseUrl}${pathName}`, { expectJson: true });
    checks.push({ path: pathName, status: result.status, ok: result.ok });
    assert(result.ok === shouldSucceed, `Owner API assertion failed for ${pathName}: ${JSON.stringify(result.json || result.textSnippet)}`);
  }
  const artifact = await pageFetchMeta(page, `${baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}`);
  checks.push({ path: `/api/artifacts/${artifactId}`, status: artifact.status, ok: artifact.ok, byteLength: artifact.byteLength });
  assert(artifact.ok, `Owner artifact read failed: ${artifact.status}`);
  return checks;
}

async function verifyForeignApiAssertions(page, baseUrl, seed, artifactId) {
  const checks = [];
  const requests = [
    `/api/workspace/notes/${encodeURIComponent(seed.noteId)}`,
    `/api/workspace/tasks/${encodeURIComponent(seed.taskId)}`,
    `/api/workspace/projects/${encodeURIComponent(seed.projectId)}`,
    `/api/workspace/contacts/${encodeURIComponent(seed.contactId)}`,
    `/api/workspace/reminders/${encodeURIComponent(seed.reminderId)}`,
  ];
  for (const pathName of requests) {
    const result = await pageFetchMeta(page, `${baseUrl}${pathName}`, { expectJson: true });
    checks.push({ path: pathName, status: result.status, ok: result.ok });
    assert(!result.ok && [401, 403, 404].includes(result.status), `Foreign API unexpectedly succeeded for ${pathName}`);
  }
  const artifact = await pageFetchMeta(page, `${baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}`);
  checks.push({ path: `/api/artifacts/${artifactId}`, status: artifact.status, ok: artifact.ok });
  assert(!artifact.ok && [401, 403, 404].includes(artifact.status), "Foreign artifact read unexpectedly succeeded.");
  return checks;
}

async function cleanupSeed(page, baseUrl, seed) {
  const targets = [
    ["reminders", seed.reminderId],
    ["tasks", seed.taskId],
    ["contacts", seed.contactId],
    ["projects", seed.projectId],
    ["notes", seed.noteId],
  ];
  const results = [];
  for (const [collection, recordId] of targets) {
    const response = await pageFetchMeta(page, `${baseUrl}/api/workspace/${collection}/${encodeURIComponent(recordId)}`, { method: "DELETE" });
    results.push({ collection, recordId, status: response.status, ok: response.ok });
  }
  return results;
}

async function waitForSignedOut(page, loginUrl, timeoutMs) {
  const loginOrigin = safeOrigin(loginUrl);
  await page.waitForFunction(
    origin => {
      const currentOrigin = (() => {
        try {
          return new URL(window.location.href).origin;
        } catch (_error) {
          return "";
        }
      })();
      return document.querySelector('input[type="email"], input[name*="email" i], input[autocomplete="email"]') || (origin && currentOrigin === origin);
    },
    loginOrigin,
    { timeout: timeoutMs }
  );
}

async function logout(page, landingUrl, loginUrl, logoutLabels, timeoutMs) {
  let label = await maybeClickOneOf(page, logoutLabels, 4000);
  if (!label && landingUrl) {
    const settingsUrl = buildRouteUrl(landingUrl, "settings");
    await page.goto(settingsUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForRouteReady(page, "settings", timeoutMs);
    label = await maybeClickOneOf(page, logoutLabels, 4000);
  }
  assert(label, `Could not find a logout control matching: ${logoutLabels.join(", ")}`);
  await waitForSignedOut(page, loginUrl, timeoutMs);
  return {
    label,
    url: page.url(),
    body: await captureBodyText(page),
  };
}

async function performOtpLoginWithArtifacts(page, userConfig, config, screenshotDir, screenshotPrefix) {
  const steps = [];
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  steps.push({ action: "goto_login", url: page.url() });
  const signedOutScreenshot = await saveScreenshot(page, screenshotDir, `${screenshotPrefix}-signed-out-landing`);
  const emailSelector = await fillEmailAddress(page, userConfig.email, config.timeoutMs);
  steps.push({ action: "fill_email", selector: emailSelector, email: maskEmail(userConfig.email) });
  const emailSubmit = await maybeClickOneOf(page, [
    "Continue",
    "Send code",
    "Send Code",
    "Sign in",
    "Sign up",
    "Create account",
  ], 2500);
  if (emailSubmit) {
    steps.push({ action: "submit_email", label: emailSubmit });
  }
  await waitForOtpInput(page, config.timeoutMs);
  const otpScreenshot = await saveScreenshot(page, screenshotDir, `${screenshotPrefix}-otp-entry`);
  const otpCode = resolveOtpCode(userConfig);
  const otpMode = await fillOtpCode(page, otpCode, config.timeoutMs);
  steps.push({ action: "fill_otp", mode: otpMode });
  const otpSubmit = await maybeClickOneOf(page, ["Continue", "Verify", "Verify code", "Sign in", "Submit"], 2500);
  if (otpSubmit) {
    steps.push({ action: "submit_otp", label: otpSubmit });
  }
  const landing = await waitForWorkspaceReady(page, {
    timeoutMs: config.timeoutMs,
    workspaceHostPattern: config.workspaceHostPattern,
    loginUrl: config.loginUrl,
  });
  const landingScreenshot = await saveScreenshot(page, screenshotDir, `${screenshotPrefix}-workspace-landing`);
  const landingState = await readRouteSnapshot(page);
  return {
    steps,
    signedOutScreenshot,
    otpScreenshot,
    landingScreenshot,
    landing,
    landingState,
  };
}

async function captureRouteSweep(page, landingUrl, routes, routeDir, timeoutMs) {
  const entries = [];
  for (const route of routes) {
    const routeUrl = buildRouteUrl(landingUrl, route);
    await page.goto(routeUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForRouteReady(page, route, timeoutMs);
    const screenshot = await saveScreenshot(page, routeDir, `route-${route}`);
    const snapshot = await readRouteSnapshot(page);
    entries.push({
      route,
      url: routeUrl,
      screenshot,
      snapshot,
    });
  }
  return entries;
}

async function verifySignedOutDirectEntryRedirect(page, config, routeDir, timeoutMs) {
  const checks = [];
  const attempts = [
    { label: "root", path: "/ui/pucky/latest/?route=home" },
    { label: "index", path: "/ui/pucky/latest/index.html?route=inbox" },
  ];
  for (const attempt of attempts) {
    const url = new URL(attempt.path, `${String(config.baseUrl || "").replace(/\/+$/, "")}/`).toString();
    const transport = await fetchNoRedirect(url);
    assert(
      transport.status >= 300 && transport.status < 400,
      `Signed-out direct app entry for ${attempt.path} did not return an HTTP redirect. Saw status ${transport.status}`
    );
    assert(
      String(transport.location || "").includes("/sign-in"),
      `Signed-out direct app entry for ${attempt.path} did not point at /sign-in. Saw location ${transport.location || "<empty>"}`
    );
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForSignedOut(page, config.loginUrl, timeoutMs);
    const currentUrl = page.url();
    const currentPath = (() => {
      try {
        return new URL(currentUrl).pathname;
      } catch (_error) {
        return "";
      }
    })();
    assert(
      safeOrigin(currentUrl) === safeOrigin(config.loginUrl) || currentPath === "/sign-in",
      `Signed-out direct app entry for ${attempt.path} did not redirect to sign-in. Saw ${currentUrl}`
    );
    checks.push({
      label: attempt.label,
      attempted_url: url,
      transport,
      final_url: currentUrl,
      screenshot: await saveScreenshot(page, routeDir, `signed-out-direct-${attempt.label}`),
      body: await captureBodyText(page),
    });
  }
  return checks;
}

async function clickHomeTileAndVerify(page, landingUrl, route, routeDir, timeoutMs) {
  const label = HOME_TILE_LABELS[route] || route;
  await page.goto(buildRouteUrl(landingUrl, "home"), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForRouteReady(page, "home", timeoutMs);
  const events = [];
  const listener = response => {
    try {
      const url = String(response.url() || "");
      if (url.includes("/api/")) {
        events.push({
          url,
          status: response.status(),
          resource_type: response.request().resourceType(),
        });
      }
    } catch (_error) {
      // Best effort only.
    }
  };
  page.on("response", listener);
  try {
    const tile = page.locator(`.light-app-tile[data-light-app-route="${route}"]`).first();
    await tile.click({ timeout: timeoutMs });
    await waitForRouteReady(page, route, timeoutMs);
    await page.waitForLoadState("networkidle", { timeout: Math.min(10_000, timeoutMs) }).catch(() => {});
  } finally {
    page.off("response", listener);
  }
  const snapshot = await readRouteSnapshot(page);
  const body = await captureBodyText(page);
  const unauthorizedEvents = events.filter(item => Number(item.status || 0) === 401);
  assert(unauthorizedEvents.length === 0, `Home tile ${route} triggered 401 API responses.`);
  assert(!/could not load|unauthorized/i.test(body), `Home tile ${route} landed in an unauthorized error state.`);
  return {
    route,
    label,
    url: page.url(),
    snapshot,
    screenshot: await saveScreenshot(page, routeDir, `home-tile-${route}`),
    api_events: events.slice(-30),
  };
}

async function verifyHomeTileLoads(page, landingUrl, routeDir, timeoutMs) {
  const entries = [];
  for (const route of HOME_TILE_ROUTES) {
    entries.push(await clickHomeTileAndVerify(page, landingUrl, route, routeDir, timeoutMs));
  }
  return entries;
}

async function buildContext(browser, matrixEntry, laneDir, browserPreviewToken) {
  const context = await browser.newContext({
    viewport: matrixEntry.viewport,
    screen: matrixEntry.viewport,
    deviceScaleFactor: 2,
    hasTouch: Boolean(matrixEntry.hasTouch),
    isMobile: Boolean(matrixEntry.isMobile),
    recordVideo: {
      dir: path.join(laneDir, "videos"),
      size: matrixEntry.viewport,
    },
  });
  if (browserPreviewToken) {
    await primeBrowserPreviewToken(context, browserPreviewToken);
  }
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  return context;
}

async function snapshotSession(context) {
  return {
    cookies: maskCookies(await context.cookies().catch(() => [])),
    origins: (await context.storageState().catch(() => ({ origins: [] }))).origins?.map(origin => ({
      origin: origin.origin,
      localStorage: Array.isArray(origin.localStorage)
        ? origin.localStorage.map(item => ({
            name: String(item?.name || ""),
            value: String(item?.value || "").slice(0, 2) + "***",
          }))
        : [],
    })) || [],
  };
}

async function finalizeContextArtifacts(context, laneDir, traceName) {
  const tracePath = path.join(laneDir, `${traceName}.zip`);
  await context.tracing.stop({ path: tracePath }).catch(() => {});
  return {
    trace: tracePath,
    session: await snapshotSession(context),
  };
}

async function verifyLoggedOutAccess(browser, matrixEntry, config, laneDir, workspaceUrl, screenshotPrefix, savedState = null) {
  const context = await browser.newContext({
    viewport: matrixEntry.viewport,
    screen: matrixEntry.viewport,
    deviceScaleFactor: 2,
    hasTouch: Boolean(matrixEntry.hasTouch),
    isMobile: Boolean(matrixEntry.isMobile),
    ...(savedState ? { storageState: savedState } : {}),
  });
  const page = await context.newPage();
  await page.goto(workspaceUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await page.waitForTimeout(1200);
  const screenshot = await saveScreenshot(page, laneDir, screenshotPrefix);
  const snapshot = await readRouteSnapshot(page);
  const body = await captureBodyText(page);
  await context.close().catch(() => {});
  return {
    screenshot,
    snapshot,
    body,
    unauthorized: safeOrigin(snapshot.url) === safeOrigin(config.loginUrl) || body.toLowerCase().includes("sign in") || body.toLowerCase().includes("continue"),
  };
}

async function runIsolationChecks(browser, matrixEntry, config, laneDir, ownerWorkspaceUrl, seed, artifactId, ownerPreLogoutState) {
  const ownerBrowser = await buildContext(browser, matrixEntry, path.join(laneDir, "owner"), config.browserPreviewToken);
  const ownerPage = await ownerBrowser.newPage();
  attachPageLogging(ownerPage, path.join(laneDir, "owner", "browser-console.log"));
  const ownerLogin = await performOtpLoginWithArtifacts(ownerPage, config.userA, config, path.join(laneDir, "owner"), "owner");
  const ownerApiChecks = await verifyOwnerApiAssertions(ownerPage, config.baseUrl, seed, artifactId, config.composioDetailsSlug);

  const refreshedUrl = buildRouteUrl(ownerLogin.landing.url, "notes");
  await ownerPage.goto(refreshedUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForRouteReady(ownerPage, "notes", config.timeoutMs);
  const afterRefresh = await readRouteSnapshot(ownerPage);
  assert(afterRefresh.bodySnippet.includes(seed.noteTitle), "User A note did not persist after refresh.");
  const reloginState = await ownerBrowser.storageState();
  const logoutResult = await logout(ownerPage, ownerLogin.landing.url, config.loginUrl, config.logoutLabels, config.timeoutMs);
  const logoutScreenshot = await saveScreenshot(ownerPage, path.join(laneDir, "owner"), "owner-logout-result");
  const staleReplay = await verifyLoggedOutAccess(
    browser,
    matrixEntry,
    config,
    path.join(laneDir, "negative"),
    ownerWorkspaceUrl,
    "stale-owner-session-replay",
    reloginState
  );
  assert(staleReplay.unauthorized, "Stale owner session replay revived an authenticated workspace.");
  const ownerArtifacts = await finalizeContextArtifacts(ownerBrowser, path.join(laneDir, "owner"), "trace-owner");
  await ownerBrowser.close().catch(() => {});

  const userBContext = await buildContext(browser, matrixEntry, path.join(laneDir, "user-b"), config.browserPreviewToken);
  const userBPage = await userBContext.newPage();
  attachPageLogging(userBPage, path.join(laneDir, "user-b", "browser-console.log"));
  const userBLogin = await performOtpLoginWithArtifacts(userBPage, config.userB, config, path.join(laneDir, "user-b"), "user-b");
  if (config.requireDistinctWorkspaceHost) {
    assert(
      new URL(ownerLogin.landing.url).host !== new URL(userBLogin.landing.url).host,
      `Expected distinct workspace hosts for User A and User B, but both resolved to ${new URL(ownerLogin.landing.url).host}`
    );
  }
  const userBApiChecks = await verifyForeignApiAssertions(userBPage, config.baseUrl, seed, artifactId);
  const directOwnerUrl = await verifyLoggedOutAccess(
    browser,
    matrixEntry,
    { ...config, loginUrl: config.loginUrl },
    path.join(laneDir, "negative"),
    ownerWorkspaceUrl,
    "user-b-direct-owner-workspace"
  );
  assert(directOwnerUrl.unauthorized, "Logged-out browser reached owner workspace instead of being bounced to auth.");

  await userBPage.goto(ownerWorkspaceUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await userBPage.waitForTimeout(1200);
  const crossUserRoute = {
    screenshot: await saveScreenshot(userBPage, path.join(laneDir, "negative"), "user-b-owner-workspace-attempt"),
    url: userBPage.url(),
    body: await captureBodyText(userBPage),
  };
  assert(
    !crossUserRoute.body.includes(seed.noteTitle) && !crossUserRoute.body.includes(seed.taskTitle),
    "User B saw User A workspace data while visiting the owner workspace URL directly."
  );

  const wrongHostReplay = await verifyLoggedOutAccess(
    browser,
    matrixEntry,
    config,
    path.join(laneDir, "negative"),
    userBLogin.landing.url,
    "wrong-host-owner-cookie-replay",
    ownerPreLogoutState
  );
  assert(wrongHostReplay.unauthorized || !String(wrongHostReplay.body || "").includes(seed.noteTitle), "Wrong-host owner cookie replay exposed data.");

  const userBArtifacts = await finalizeContextArtifacts(userBContext, path.join(laneDir, "user-b"), "trace-user-b");
  await userBContext.close().catch(() => {});

  return {
    ownerLogin: {
      ...ownerLogin,
      ownerApiChecks,
      afterRefresh,
      logoutResult: {
        ...logoutResult,
        screenshot: logoutScreenshot,
      },
      artifacts: ownerArtifacts,
    },
    userBLogin: {
      ...userBLogin,
      userBApiChecks,
      artifacts: userBArtifacts,
    },
    negativeChecks: {
      loggedOutWorkspaceAttempt: directOwnerUrl,
      staleReplay,
      crossUserRoute,
      wrongHostReplay,
    },
  };
}

function renderReport(summary) {
  const lines = [
    "# Live Auth Browser Proof",
    "",
    `- Verdict: ${summary.ok ? "pass" : "fail"}`,
    `- Base URL: ${summary.base_url}`,
    `- Login URL: ${summary.login_url}`,
    `- Release commit: ${summary.bundle_contract?.release_commit || ""}`,
    `- User A: ${maskEmail(summary.user_a?.email || "")}`,
    `- User B: ${maskEmail(summary.user_b?.email || "")}`,
    `- Matrix lanes: ${summary.lanes.length}`,
    "",
  ];
  for (const lane of summary.lanes) {
    lines.push(`## ${lane.label}`);
    lines.push(`- Browser: ${lane.browser_name}`);
    lines.push(`- Primary isolation lane: ${lane.primary_isolation_lane ? "yes" : "no"}`);
    lines.push(`- Landing URL: ${lane.user_a?.landing?.url || ""}`);
    lines.push(`- Major routes captured: ${(lane.user_a?.routes || []).map(item => item.route).join(", ")}`);
    lines.push(`- Home tile routes verified: ${(lane.user_a?.home_tile_routes || []).map(item => item.route).join(", ")}`);
    lines.push(`- Bundle commit: ${lane.bundle_contract?.manifest?.source_commit_full || ""}`);
    if (lane.primary_isolation_lane) {
      lines.push(`- Distinct workspace hosts: ${lane.isolation?.userBLogin ? "verified" : "not run"}`);
      lines.push(`- Negative checks: ${Object.keys(lane.isolation?.negativeChecks || {}).join(", ")}`);
    }
    lines.push("");
  }
  if (summary.error) {
    lines.push("## Error");
    lines.push("");
    lines.push("```");
    lines.push(String(summary.error || ""));
    lines.push("```");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const gitState = localGitState();
  const expectedScripts = expectedBundleScripts();
  ensureDir(config.reportDir);
  const summary = {
    schema: RESULT_SCHEMA,
    ok: false,
    base_url: config.baseUrl,
    login_url: config.loginUrl,
    report_dir: config.reportDir,
    bundle_contract: {
      release_commit: gitState.head,
      release_commit_short: gitState.headShort,
      expected_scripts: expectedScripts,
    },
    user_a: { email: config.userA.email },
    user_b: { email: config.userB.email },
    lanes: [],
    generated_at: new Date().toISOString(),
  };
  try {
    for (const matrixEntry of config.matrix) {
      const laneDir = path.join(config.reportDir, matrixEntry.label);
      ensureDir(laneDir);
      const browser = await launchConfiguredBrowser(matrixEntry.browserName, config.headed);
      try {
        const lane = {
          label: matrixEntry.label,
          browser_name: matrixEntry.browserName,
          viewport: matrixEntry.viewport,
          primary_isolation_lane: Boolean(matrixEntry.primaryIsolationLane),
          user_a: {},
        };
        const context = await buildContext(browser, matrixEntry, laneDir, config.browserPreviewToken);
        const page = await context.newPage();
        attachPageLogging(page, path.join(laneDir, "browser-console.log"));
        lane.signed_out_redirects = await verifySignedOutDirectEntryRedirect(
          page,
          config,
          path.join(laneDir, "signed-out"),
          config.timeoutMs
        );
        const loginResult = await performOtpLoginWithArtifacts(page, config.userA, config, laneDir, "user-a");
        lane.bundle_contract = await verifyBundleFreshness(page, config.baseUrl, gitState, expectedScripts);
        lane.user_a = {
          email: config.userA.email,
          signed_out_screenshot: loginResult.signedOutScreenshot,
          otp_screenshot: loginResult.otpScreenshot,
          landing: loginResult.landingState,
          landing_artifact: loginResult.landingScreenshot,
        };
        const routes = await captureRouteSweep(page, loginResult.landing.url, config.majorRoutes, path.join(laneDir, "routes"), config.timeoutMs);
        lane.user_a.routes = routes;
        lane.user_a.home_tile_routes = await verifyHomeTileLoads(
          page,
          loginResult.landing.url,
          path.join(laneDir, "home-tiles"),
          config.timeoutMs
        );

        let seed = null;
        let artifactId = "";
        let ownerPreLogoutState = null;
        if (matrixEntry.primaryIsolationLane) {
          seed = buildSeed(config.runId, matrixEntry.label);
          const seeded = await seedWorkspaceRecords(page, config.baseUrl, seed);
          artifactId = seeded.artifactId;
          lane.user_a.seed = { ...seeded, seed };
          lane.user_a.owner_api_checks = await verifyOwnerApiAssertions(page, config.baseUrl, seed, artifactId, config.composioDetailsSlug);
          ownerPreLogoutState = await context.storageState();
        }

        lane.user_a.session = await snapshotSession(context);
        const logoutResult = await logout(page, loginResult.landing.url, config.loginUrl, config.logoutLabels, config.timeoutMs);
        lane.user_a.logout = {
          ...logoutResult,
          screenshot: await saveScreenshot(page, laneDir, "user-a-logout-result"),
        };
        lane.user_a.artifacts = await finalizeContextArtifacts(context, laneDir, "trace-user-a");
        await context.close().catch(() => {});

        if (matrixEntry.primaryIsolationLane && seed && artifactId && ownerPreLogoutState) {
          lane.isolation = await runIsolationChecks(
            browser,
            matrixEntry,
            config,
            path.join(laneDir, "isolation"),
            loginResult.landing.url,
            seed,
            artifactId,
            ownerPreLogoutState
          );
          lane.cleanup = await (async () => {
            const cleanupBrowser = await launchConfiguredBrowser(matrixEntry.browserName, config.headed);
            try {
              const cleanupContext = await buildContext(cleanupBrowser, matrixEntry, path.join(laneDir, "cleanup"), config.browserPreviewToken);
              const cleanupPage = await cleanupContext.newPage();
              await performOtpLoginWithArtifacts(cleanupPage, config.userA, config, path.join(laneDir, "cleanup"), "cleanup-user-a");
              const results = await cleanupSeed(cleanupPage, config.baseUrl, seed);
              await cleanupContext.close().catch(() => {});
              return results;
            } finally {
              await cleanupBrowser.close().catch(() => {});
            }
          })();
        }
        summary.lanes.push(lane);
      } finally {
        await browser.close().catch(() => {});
      }
    }
    summary.ok = true;
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    fs.writeFileSync(path.join(config.reportDir, "report.md"), renderReport(summary), "utf8");
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    summary.error = String(error?.stack || error?.message || error);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    fs.writeFileSync(path.join(config.reportDir, "report.md"), renderReport(summary), "utf8");
    throw error;
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
