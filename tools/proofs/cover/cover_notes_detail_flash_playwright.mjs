import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_BASE_URL = process.env.PUCKY_NOTES_FLASH_BASE_URL || "https://pucky.fly.dev";
const RESULT_SCHEMA = "pucky.notes_detail_flash_browser_proof.v1";
const VIEWPORT = { width: 430, height: 932 };
const TRANSITION_DELAY_MS = 450;
const FAIL_OPEN_MS = 1500;

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

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logStep(config, message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  fs.appendFileSync(path.join(config.reportDir, "progress.log"), `${line}\n`, "utf8");
  console.log(line);
}

function resolveApiToken() {
  const proofToken = String(process.env.PUCKY_WORKSPACE_PROOF_TOKEN || "").trim();
  if (proofToken) {
    return proofToken;
  }
  const liveToken = String(process.env.PUCKY_LIVE_USER_SESSION_TOKEN || "").trim();
  if (liveToken) {
    return liveToken;
  }
  const operatorToken = String(process.env.PUCKY_OPERATOR_TOKEN || "").trim();
  if (operatorToken) {
    return operatorToken;
  }
  return String(process.env.PUCKY_API_TOKEN || "").trim();
}

function parseArgs(argv) {
  const config = {
    baseUrl: DEFAULT_BASE_URL,
    apiToken: resolveApiToken(),
    timeoutMs: 30000,
    runId: `notes-flash-proof-${Date.now()}`,
    keepSeed: false,
    reportDir: path.resolve(".tmp", "notes-detail-flash-proof", timestampSlug()),
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
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
    };
  } catch (_error) {
    return {
      head: "",
      headShort: "",
      branch: "",
    };
  }
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

function shortCommitMatches(fullCommit, shortCommit) {
  const full = String(fullCommit || "").trim();
  const short = String(shortCommit || "").trim();
  return Boolean(full && short && full.startsWith(short));
}

function isHostedDeployBaseUrl(baseUrl) {
  try {
    return /(^|\.)pucky\.fly\.dev$/i.test(new URL(String(baseUrl || "")).hostname);
  } catch (_error) {
    return false;
  }
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
      "node_modules",
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
      // Try the next candidate.
    }
  }
  throw new Error("Could not resolve playwright-core from bundled or local node_modules");
}

async function apiRequest(config, method, apiPath, body = undefined) {
  const headers = { Accept: "application/json" };
  if (String(config.apiToken || "").trim()) {
    headers.Authorization = `Bearer ${String(config.apiToken || "").trim()}`;
  }
  const response = await fetch(`${config.baseUrl}${apiPath}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${apiPath} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

function buildSeed(runId) {
  const id = `proof-note-flash-${slug(runId)}`;
  const title = `Notes Flash Proof ${slug(runId)}`;
  return {
    id,
    title,
    summary: "Seeded note for note-detail flash proof.",
    pinned: true,
    updated_at_ms: Date.now(),
    metadata: {
      context: "Notes flash proof",
    },
    html: `<!doctype html><html><body><h1>${title}</h1><p>Notes flash proof content.</p></body></html>`,
  };
}

async function cleanupNoteRecord(config, noteId) {
  try {
    await apiRequest(config, "DELETE", `/api/workspace/notes/${encodeURIComponent(noteId)}`);
  } catch (error) {
    if (String(error?.message || "").includes("(404)")) {
      return;
    }
    throw error;
  }
}

async function seedNoteRecord(config, note) {
  await cleanupNoteRecord(config, note.id);
  await apiRequest(config, "POST", "/api/workspace/notes", note);
  return apiRequest(config, "GET", `/api/workspace/notes/${encodeURIComponent(note.id)}`);
}

function buildRouteUrl(config, theme) {
  const url = new URL("/ui/pucky/latest/index.html", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  url.searchParams.set("theme", theme);
  url.searchParams.set("route", "home");
  url.searchParams.set("reset_nav", "1");
  if (String(config.refreshKey || "").trim()) {
    url.searchParams.set("_pucky_refresh", String(config.refreshKey || "").trim());
  }
  return url.toString();
}

async function waitForRoute(page, route, timeoutMs) {
  await page.waitForFunction(
    expectedRoute => document.querySelector(".light-shell")?.getAttribute("data-light-route") === expectedRoute,
    route,
    { timeout: timeoutMs },
  );
}

async function waitForHomeReady(page, timeoutMs) {
  await waitForRoute(page, "home", timeoutMs);
  await page.waitForFunction(() => {
    return Boolean(document.querySelector('.light-app-tile[data-light-app-route="notes"]'));
  }, undefined, { timeout: timeoutMs });
}

async function openRouteFromHome(page, route, timeoutMs) {
  const tile = page.locator(`.light-app-tile[data-light-app-route="${route}"]`).first();
  await tile.waitFor({ state: "visible", timeout: timeoutMs });
  await tile.click();
  await waitForRoute(page, route, timeoutMs);
}

async function waitForSeededNote(page, noteId, timeoutMs) {
  const row = page.locator(`.light-note-row[data-note-id="${noteId}"]`).first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });
  return row;
}

async function waitForSettledNoteFrame(page, noteTitle, timeoutMs) {
  await page.frameLocator(".light-note-detail-html-body .light-html-frame").locator(`text=${noteTitle}`).first().waitFor({
    state: "visible",
    timeout: timeoutMs,
  });
}

async function readNoteDetailState(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const shell = document.querySelector(".light-shell");
    const wrapper = document.querySelector(".light-note-detail-html-body");
    const frame = wrapper?.querySelector(".light-html-frame");
    const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
    const frameStyle = frame ? getComputedStyle(frame) : null;
    return {
      route: shell?.getAttribute("data-light-route") || "",
      appTheme: document.querySelector(".app-shell")?.getAttribute("data-theme") || "",
      title: normalize(document.querySelector(".light-page-title-detail, .light-page-title")?.textContent || ""),
      wrapperState: wrapper?.getAttribute("data-html-frame-state") || "",
      wrapperBackground: wrapperStyle?.backgroundColor || "",
      wrapperAriaBusy: wrapper?.getAttribute("aria-busy") || "",
      iframePresent: Boolean(frame),
      iframeVisibility: frameStyle?.visibility || "",
      iframeOpacity: frameStyle?.opacity || "",
      iframeBackground: frameStyle?.backgroundColor || "",
      iframeDelayedSrcdoc: frame?.getAttribute("data-delayed-srcdoc") || "",
      iframeReadyState: "",
      iframeDocumentTheme: "",
      iframeBodyBackground: "",
      iframeBodyChildren: 0,
      iframeBodyText: "",
    };
  });
}

async function readNoteFrameDocumentState(page) {
  const iframeHandle = await page.locator(".light-note-detail-html-body .light-html-frame").first().elementHandle();
  if (!iframeHandle) {
    return {
      readyState: "",
      documentTheme: "",
      bodyBackground: "",
      bodyChildren: 0,
      bodyText: "",
    };
  }
  const frame = await iframeHandle.contentFrame();
  if (!frame) {
    return {
      readyState: "",
      documentTheme: "",
      bodyBackground: "",
      bodyChildren: 0,
      bodyText: "",
    };
  }
  return frame.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const bodyStyle = document.body ? getComputedStyle(document.body) : null;
    return {
      readyState: document.readyState || "",
      documentTheme: document.documentElement?.getAttribute("data-pucky-embedded-theme") || "",
      bodyBackground: bodyStyle?.backgroundColor || "",
      bodyChildren: document.body?.children?.length || 0,
      bodyText: normalize(document.body?.textContent || ""),
    };
  });
}

function visibleTransitionBackground(state) {
  if (String(state?.iframeVisibility || "").trim().toLowerCase() === "hidden") {
    return String(state?.wrapperBackground || state?.iframeBackground || "").trim();
  }
  return String(state?.iframeBackground || state?.wrapperBackground || "").trim();
}

function assertTransitionState(theme, state) {
  const background = visibleTransitionBackground(state);
  if (theme === "dark") {
    assert(
      background === "rgb(8, 17, 28)",
      `Expected dark note transition surface rgb(8, 17, 28), got ${background || "empty"}`,
    );
    assert(state.wrapperState === "loading", `Expected dark note wrapper to stay loading during transition, got ${state.wrapperState}`);
    assert(state.iframeVisibility === "hidden", `Expected dark note iframe to stay hidden during transition, got ${state.iframeVisibility}`);
  } else {
    assert(
      background === "rgb(255, 255, 255)",
      `Expected light note transition surface rgb(255, 255, 255), got ${background || "empty"}`,
    );
    assert(state.wrapperState === "loading", `Expected light note wrapper to stay loading during transition, got ${state.wrapperState}`);
    assert(state.iframeVisibility === "hidden", `Expected light note iframe to stay hidden during transition, got ${state.iframeVisibility}`);
  }
}

function assertSettledState(theme, state, note) {
  const expectedBackground = theme === "dark" ? "rgb(8, 17, 28)" : "rgb(255, 255, 255)";
  assert(state.route === "note-detail", `Expected ${theme} settled route note-detail, got ${state.route}`);
  assert(state.title === note.title, `Expected ${theme} settled title ${note.title}, got ${state.title}`);
  assert(state.iframePresent, `Expected ${theme} settled note iframe to exist`);
  assert(state.iframeVisibility !== "hidden", `Expected ${theme} settled note iframe to be visible`);
  assert(state.wrapperState === "ready", `Expected ${theme} settled wrapper state ready, got ${state.wrapperState}`);
  assert(state.wrapperAriaBusy === "false", `Expected ${theme} settled wrapper aria-busy false, got ${state.wrapperAriaBusy}`);
  assert(
    state.iframeDocumentTheme === theme || state.iframeBodyBackground === expectedBackground,
    `Expected ${theme} settled iframe theme/background ${theme}/${expectedBackground}, got ${state.iframeDocumentTheme || "empty"}/${state.iframeBodyBackground || "empty"}`,
  );
  assert(
    String(state.iframeBodyText || "").includes(note.title),
    `Expected ${theme} settled iframe body to include ${note.title}, got ${state.iframeBodyText || "empty"}`,
  );
}

async function preparePage(page, config, theme) {
  await page.goto(buildRouteUrl(config, theme), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForHomeReady(page, config.timeoutMs);
  await openRouteFromHome(page, "notes", config.timeoutMs);
}

async function runImmediatePass(page, config, theme, note, consoleLogPath) {
  attachPageLogging(page, consoleLogPath);
  await preparePage(page, config, theme);
  await waitForSeededNote(page, note.id, config.timeoutMs);
  await page.locator(`.light-note-row[data-note-id="${note.id}"]`).first().click();
  await waitForRoute(page, "note-detail", config.timeoutMs);
  const immediateState = await readNoteDetailState(page);
  const screenshot = await saveScreenshot(page, config.reportDir, `${theme}-immediate`);
  return {
    state: immediateState,
    screenshot,
  };
}

async function runDelayedPass(page, config, theme, note, consoleLogPath) {
  attachPageLogging(page, consoleLogPath);
  await page.addInitScript((delayMs) => {
    const proto = HTMLIFrameElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "srcdoc");
    if (!descriptor || typeof descriptor.set !== "function" || window.__puckyDelayedSrcdocInstalled) {
      return;
    }
    window.__puckyDelayedSrcdocInstalled = true;
    Object.defineProperty(proto, "srcdoc", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return typeof descriptor.get === "function" ? descriptor.get.call(this) : this.getAttribute("srcdoc") || "";
      },
      set(value) {
        const frame = this;
        if (frame instanceof HTMLIFrameElement && frame.classList.contains("light-html-frame") && !frame.dataset.delayedSrcdoc) {
          frame.dataset.delayedSrcdoc = "true";
          window.setTimeout(() => descriptor.set.call(frame, value), delayMs);
          return;
        }
        descriptor.set.call(frame, value);
      },
    });
  }, TRANSITION_DELAY_MS);
  await preparePage(page, config, theme);
  await waitForSeededNote(page, note.id, config.timeoutMs);
  await page.locator(`.light-note-row[data-note-id="${note.id}"]`).first().click();
  await waitForRoute(page, "note-detail", config.timeoutMs);
  await page.waitForTimeout(Math.max(120, Math.floor(TRANSITION_DELAY_MS / 3)));
  const delayedState = await readNoteDetailState(page);
  const transitionScreenshot = await saveScreenshot(page, config.reportDir, `${theme}-transition`);
  assertTransitionState(theme, delayedState);
  await waitForSettledNoteFrame(page, note.title, config.timeoutMs);
  await page.waitForFunction(() => {
    const wrapper = document.querySelector(".light-note-detail-html-body");
    return Boolean(wrapper && wrapper.getAttribute("data-html-frame-state") === "ready");
  }, undefined, { timeout: config.timeoutMs });
  const settledFrameState = await readNoteFrameDocumentState(page);
  const settledState = {
    ...(await readNoteDetailState(page)),
    iframeReadyState: settledFrameState.readyState,
    iframeDocumentTheme: settledFrameState.documentTheme,
    iframeBodyBackground: settledFrameState.bodyBackground,
    iframeBodyChildren: settledFrameState.bodyChildren,
    iframeBodyText: settledFrameState.bodyText,
  };
  const settledScreenshot = await saveScreenshot(page, config.reportDir, `${theme}-settled`);
  assertSettledState(theme, settledState, note);
  return {
    transition_state: delayedState,
    transition_screenshot: transitionScreenshot,
    settled_state: settledState,
    settled_screenshot: settledScreenshot,
  };
}

function buildThemeSummary(theme, immediate, delayed) {
  return {
    theme,
    immediate_state: immediate.state,
    delayed_transition_state: delayed.transition_state,
    settled_state: delayed.settled_state,
    screenshots: {
      immediate: immediate.screenshot,
      transition: delayed.transition_screenshot,
      settled: delayed.settled_screenshot,
    },
  };
}

function writeReport(config, summary) {
  const manifestLine = summary.remote_manifest?.manifest
    ? `- Remote manifest: ${summary.remote_manifest.manifest.source_commit_full || "unknown"} (${summary.remote_manifest.manifest.ui_version || "no ui_version"})`
    : "- Remote manifest: not recorded";
  const content = [
    "# Notes Detail Flash Proof",
    "",
    `- Schema: ${summary.schema}`,
    `- Base URL: ${summary.base_url}`,
    `- Seeded note: ${summary.seeded_note.title} (${summary.seeded_note.id})`,
    manifestLine,
    `- Delay injection: ${TRANSITION_DELAY_MS}ms`,
    `- Fail-open budget: ${FAIL_OPEN_MS}ms`,
    "",
    "## Screenshots",
    "",
    `- Light transition: ${summary.themes.light.screenshots.transition}`,
    `- Light settled: ${summary.themes.light.screenshots.settled}`,
    `- Dark transition: ${summary.themes.dark.screenshots.transition}`,
    `- Dark settled: ${summary.themes.dark.screenshots.settled}`,
    "",
    "## Assertions",
    "",
    "- Light placeholder stayed light before the note iframe painted.",
    "- Dark placeholder stayed dark before the note iframe painted.",
    "- Both themes settled to the seeded note content.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(config.reportDir, "report.md"), `${content}\n`, "utf8");
}

async function runTheme(browser, config, theme, note) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    screen: VIEWPORT,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  try {
    const immediatePage = await context.newPage();
    const immediate = await runImmediatePass(
      immediatePage,
      config,
      theme,
      note,
      path.join(config.reportDir, `${theme}-immediate.console.log`),
    );
    await immediatePage.close();

    const delayedPage = await context.newPage();
    const delayed = await runDelayedPass(
      delayedPage,
      config,
      theme,
      note,
      path.join(config.reportDir, `${theme}-delayed.console.log`),
    );
    await delayedPage.close();

    return buildThemeSummary(theme, immediate, delayed);
  } finally {
    await context.close();
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (!String(config.apiToken || "").trim()) {
    throw new Error("Notes detail flash proof requires --api-token or PUCKY_WORKSPACE_PROOF_TOKEN/PUCKY_LIVE_USER_SESSION_TOKEN/PUCKY_OPERATOR_TOKEN/PUCKY_API_TOKEN");
  }
  ensureDir(config.reportDir);
  const localGit = localGitState();
  config.refreshKey = localGit.headShort || config.runId;
  const seed = buildSeed(config.runId);
  const summary = {
    schema: RESULT_SCHEMA,
    created_at: new Date().toISOString(),
    base_url: config.baseUrl,
    local_git: localGit,
    remote_manifest: null,
    seeded_note: {
      id: seed.id,
      title: seed.title,
    },
    delay_injection_ms: TRANSITION_DELAY_MS,
    fail_open_ms: FAIL_OPEN_MS,
    themes: {},
  };
  let browser;
  try {
    logStep(config, `seeding note ${seed.id}`);
    await seedNoteRecord(config, seed);
    try {
      summary.remote_manifest = await fetchRemoteManifest(config.baseUrl, config.refreshKey);
      const manifest = summary.remote_manifest.manifest || {};
      if (isHostedDeployBaseUrl(config.baseUrl) && localGit.head) {
        assert(
          manifest.source_commit_full === localGit.head,
          `Hosted manifest commit ${manifest.source_commit_full || "empty"} did not match local HEAD ${localGit.head}`,
        );
        assert(
          shortCommitMatches(localGit.head, manifest.source_commit_short),
          `Hosted manifest short commit ${manifest.source_commit_short || "empty"} did not match local HEAD ${localGit.head}`,
        );
      }
    } catch (error) {
      summary.remote_manifest = {
        error: error.message || String(error),
      };
      if (isHostedDeployBaseUrl(config.baseUrl)) {
        throw error;
      }
    }

    const chromium = await loadChromium();
    browser = await chromium.launch({
      headless: true,
      executablePath: resolveChromePath(),
    });

    for (const theme of ["light", "dark"]) {
      logStep(config, `running ${theme} theme proof`);
      summary.themes[theme] = await runTheme(browser, config, theme, seed);
    }

    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    writeReport(config, summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    if (!config.keepSeed) {
      try {
        await cleanupNoteRecord(config, seed.id);
      } catch (cleanupError) {
        fs.appendFileSync(
          path.join(config.reportDir, "progress.log"),
          `[${new Date().toISOString()}] cleanup failed: ${cleanupError.message || String(cleanupError)}\n`,
          "utf8",
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
