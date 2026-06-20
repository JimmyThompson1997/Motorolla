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
import {
  NOTES_DETAIL_FLASH_CAPTURE_AFTER_READY_MS,
  NOTES_DETAIL_FLASH_CAPTURE_MAX_MS,
  NOTES_DETAIL_FLASH_CAPTURE_MIN_MS,
  NOTES_DETAIL_FLASH_DARK_BRIGHT_PIXEL_RATIO_MAX,
  NOTES_DETAIL_FLASH_DARK_MEAN_LUMA_MAX,
  NOTES_DETAIL_FLASH_FAIL_OPEN_MS,
  NOTES_DETAIL_FLASH_FAILURE_CATEGORIES,
  NOTES_DETAIL_FLASH_IFRAME_DELAY_MS,
  NOTES_DETAIL_FLASH_LANES,
  NOTES_DETAIL_FLASH_LIGHT_DARK_PIXEL_RATIO_MAX,
  NOTES_DETAIL_FLASH_LIGHT_MEAN_LUMA_MIN,
  NOTES_DETAIL_FLASH_OFFSETS_MS,
  NOTES_DETAIL_FLASH_REQUIRED_PHASES,
  NOTES_DETAIL_FLASH_RESULT_SCHEMA_V2,
  NOTES_DETAIL_FLASH_ROUTE_DELAY_MS,
  NOTES_DETAIL_FLASH_TRACE_SAMPLE_LIMIT,
  NOTES_DETAIL_FLASH_VIEWPORT,
  buildScoreCrop,
  chooseWorstFrame,
  classifyLaneMetrics,
  orderedObservedPhases,
} from "./notes_detail_flash_scoring.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_BASE_URL = process.env.PUCKY_NOTES_FLASH_BASE_URL || "https://pucky.fly.dev";
const VIEWPORT = NOTES_DETAIL_FLASH_VIEWPORT;
const SCORE_CROP = buildScoreCrop(VIEWPORT);
const LANE_DEBUG_DEFAULTS = Object.freeze({
  natural_click: { routeDelayMs: 0, iframeDelayMs: 0 },
  route_delay: { routeDelayMs: NOTES_DETAIL_FLASH_ROUTE_DELAY_MS, iframeDelayMs: 0 },
  iframe_delay: { routeDelayMs: 0, iframeDelayMs: NOTES_DETAIL_FLASH_IFRAME_DELAY_MS },
});

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
  const webToken = String(process.env.PUCKY_WEB_UI_TOKEN || "").trim();
  if (webToken) {
    return webToken;
  }
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
    runId: `notes-flash-proof-v2-${Date.now()}`,
    keepSeed: false,
    requiredCommit: "",
    reportDir: path.resolve(".tmp", "notes-detail-flash-proof-v2", timestampSlug()),
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
    } else if (arg === "--required-commit" && argv[index + 1]) {
      config.requiredCommit = String(argv[++index] || "");
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
      dirty: runGit(["status", "--short"]).length > 0,
    };
  } catch (_error) {
    return {
      head: "",
      headShort: "",
      branch: "",
      dirty: false,
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

function isLocalProofBaseUrl(baseUrl) {
  try {
    const hostname = new URL(String(baseUrl || "")).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch (_error) {
    return false;
  }
}

function targetKindForBaseUrl(baseUrl) {
  if (isLocalProofBaseUrl(baseUrl)) {
    return "local_proof_server";
  }
  if (isHostedDeployBaseUrl(baseUrl)) {
    return "hosted_vm";
  }
  return "custom_browser_target";
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
  const bodyText = "Notes flash proof content.";
  return {
    id,
    title,
    body_text: bodyText,
    summary: "Seeded note for note-detail flash browser proof v2.",
    pinned: true,
    updated_at_ms: Date.now(),
    metadata: {
      context: "Notes flash proof v2",
    },
    html: `<!doctype html><html><body><h1>${title}</h1><p>${bodyText}</p></body></html>`,
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

function attachRequestLogging(context, requestLog) {
  context.on("request", request => {
    requestLog.push({
      at: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      resource_type: request.resourceType(),
    });
  });
}

function laneDebugConfig(lane) {
  return LANE_DEBUG_DEFAULTS[lane] || LANE_DEBUG_DEFAULTS.natural_click;
}

function buildRouteUrl(config, theme, lane) {
  const laneConfig = laneDebugConfig(lane);
  const url = new URL("/ui/pucky/latest/index.html", `${String(config.baseUrl || "").replace(/\/+$/, "")}/`);
  url.searchParams.set("theme", theme);
  url.searchParams.set("route", "home");
  url.searchParams.set("reset_nav", "1");
  url.searchParams.set("debug_note_flash", "1");
  url.searchParams.set("debug_note_flash_delay_route_ms", String(laneConfig.routeDelayMs || 0));
  url.searchParams.set("debug_note_flash_delay_iframe_ms", String(laneConfig.iframeDelayMs || 0));
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
  await page.waitForFunction(() => Boolean(document.querySelector('.light-app-tile[data-light-app-route="notes"]')), undefined, {
    timeout: timeoutMs,
  });
}

async function openRouteFromHome(page, route, timeoutMs) {
  const tile = page.locator(`.light-app-tile[data-light-app-route="${route}"]`).first();
  await tile.waitFor({ state: "visible", timeout: timeoutMs });
  await tile.click();
  await waitForRoute(page, route, timeoutMs);
}

async function expectPreviewApiTokenLock(page, timeoutMs) {
  await page.waitForFunction(() => {
    const shell = document.querySelector(".light-shell");
    const title = document.querySelector(".light-empty-state h2");
    const detail = document.querySelector(".light-empty-state p");
    const action = document.querySelector(".light-empty-state .light-empty-state-action");
    return shell?.getAttribute("data-light-route") === "notes"
      && String(title?.textContent || "").trim() === "Preview needs api_token"
      && String(detail?.textContent || "").trim() === "Web preview is locked. Use Unlock web preview to load live Notes from the VM in this browser."
      && String(action?.textContent || "").trim() === "Unlock web preview";
  }, undefined, { timeout: timeoutMs });
}

async function unlockBrowserPreview(page, apiToken, timeoutMs) {
  assert(String(apiToken || "").trim(), "Expected PUCKY_WEB_UI_TOKEN or --api-token to unlock Notes preview");
  await page.getByRole("button", { name: "Unlock web preview" }).click();
  await page.getByPlaceholder("Paste PUCKY_WEB_UI_TOKEN").waitFor({ state: "visible", timeout: timeoutMs });
  await page.getByPlaceholder("Paste PUCKY_WEB_UI_TOKEN").fill(String(apiToken || "").trim());
  await page.getByRole("button", { name: "Save token" }).click();
  await page.waitForFunction(() => !document.querySelector(".browser-unlock-sheet"), undefined, { timeout: timeoutMs });
  await page.waitForFunction(() => Boolean(localStorage.getItem("pucky.cover.browser_api_token.v1")), undefined, { timeout: timeoutMs });
}

async function ensureNotesUnlocked(page, config) {
  const locked = await page.waitForFunction(() => {
    const shell = document.querySelector(".light-shell");
    const title = document.querySelector(".light-empty-state h2");
    return shell?.getAttribute("data-light-route") === "notes"
      && String(title?.textContent || "").trim() === "Preview needs api_token";
  }, undefined, { timeout: 1200 }).then(() => true).catch(() => false);
  if (!locked) {
    return;
  }
  await expectPreviewApiTokenLock(page, config.timeoutMs);
  await unlockBrowserPreview(page, config.apiToken, config.timeoutMs);
}

async function waitForSeededNote(page, noteId, timeoutMs) {
  const row = page.locator(`.light-note-row[data-note-id="${noteId}"]`).first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });
  return row;
}

async function waitForSettledNote(page, note, timeoutMs) {
  await page.waitForFunction(({ title, bodyText }) => {
    const wrapper = document.querySelector(".light-detail-html-body");
    const shell = document.querySelector(".light-shell");
    const frame = wrapper?.querySelector(".light-html-frame");
    if (!wrapper || !frame || shell?.getAttribute("data-light-route") !== "note-detail") {
      return false;
    }
    if (wrapper.getAttribute("data-html-frame-state") !== "ready") {
      return false;
    }
    try {
      const text = String(frame.contentDocument?.body?.textContent || "").replace(/\s+/g, " ").trim();
      return text.includes(title) && text.includes(bodyText);
    } catch (_) {
      return false;
    }
  }, {
    title: note.title,
    bodyText: String(note.body_text || "").trim(),
  }, { timeout: timeoutMs });
  return readSettledNoteState(page);
}

async function readSettledNoteState(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const shell = document.querySelector(".light-shell");
    const wrapper = document.querySelector(".light-detail-html-body");
    const frame = wrapper?.querySelector(".light-html-frame");
    const wrapperStyle = wrapper ? getComputedStyle(wrapper) : null;
    const frameStyle = frame ? getComputedStyle(frame) : null;
    let iframeReadyState = "";
    let iframeDocumentTheme = "";
    let iframeBodyBackground = "";
    let iframeBodyText = "";
    try {
      iframeReadyState = String(frame?.contentDocument?.readyState || "");
      iframeDocumentTheme = String(frame?.contentDocument?.documentElement?.getAttribute("data-pucky-embedded-theme") || "");
      iframeBodyBackground = frame?.contentDocument?.body ? getComputedStyle(frame.contentDocument.body).backgroundColor || "" : "";
      iframeBodyText = normalize(frame?.contentDocument?.body?.textContent || "");
    } catch (_) {
      iframeReadyState = "";
    }
    return {
      route: shell?.getAttribute("data-light-route") || "",
      app_theme: document.querySelector(".app-shell")?.getAttribute("data-theme") || "",
      title: normalize(document.querySelector(".light-page-title-detail, .light-page-title")?.textContent || ""),
      wrapper_state: wrapper?.getAttribute("data-html-frame-state") || "",
      wrapper_aria_busy: wrapper?.getAttribute("aria-busy") || "",
      wrapper_background: wrapperStyle?.backgroundColor || "",
      iframe_present: Boolean(frame),
      iframe_visibility: frameStyle?.visibility || "",
      iframe_background: frameStyle?.backgroundColor || "",
      iframe_ready_state: iframeReadyState,
      iframe_document_theme: iframeDocumentTheme,
      iframe_body_background: iframeBodyBackground,
      iframe_body_text: iframeBodyText,
    };
  });
}

async function preparePage(page, config, theme, lane) {
  await page.goto(buildRouteUrl(config, theme, lane), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForHomeReady(page, config.timeoutMs);
  await openRouteFromHome(page, "notes", config.timeoutMs);
  await ensureNotesUnlocked(page, config);
  await waitForSeededNote(page, config.seed.id, config.timeoutMs);
}

async function installTimelineCapture(page, noteId) {
  await page.evaluate(({ noteId, scoreCrop, maxMs, minMs, afterReadyMs, sampleLimit }) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const parseRgb = (value) => {
      const match = String(value || "").match(/rgba?\(([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
      if (!match) {
        return null;
      }
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
      };
    };
    const channelToLinear = (value) => {
      const normalized = Math.max(0, Math.min(255, Number(value || 0))) / 255;
      if (normalized <= 0.04045) {
        return normalized / 12.92;
      }
      return ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const lumaFromRgb = (value) => {
      const rgb = parseRgb(value);
      if (!rgb) {
        return null;
      }
      return Number((0.2126 * channelToLinear(rgb.r) + 0.7152 * channelToLinear(rgb.g) + 0.0722 * channelToLinear(rgb.b)).toFixed(6));
    };
    const backgroundColor = (node) => {
      if (!(node instanceof Element)) {
        return "";
      }
      return String(window.getComputedStyle(node).backgroundColor || "").trim();
    };
    const backgroundImage = (node) => {
      if (!(node instanceof Element)) {
        return "";
      }
      return String(window.getComputedStyle(node).backgroundImage || "").trim();
    };
    const visibleColor = (value) => {
      const normalizedValue = String(value || "").trim().toLowerCase();
      return Boolean(normalizedValue && normalizedValue !== "transparent" && normalizedValue !== "rgba(0, 0, 0, 0)");
    };
    const readFrameState = (frame) => {
      try {
        return {
          readyState: String(frame?.contentDocument?.readyState || ""),
          bodyBackground: frame?.contentDocument?.body ? backgroundColor(frame.contentDocument.body) : "",
        };
      } catch (_) {
        return {
          readyState: "",
          bodyBackground: "",
        };
      }
    };
    const chooseVisibleSurface = ({ frame, frameVisibility, frameBodyBackground, frameBackground, noteWrapperBackground, notePageBackground, lightShellBackground, feedBackground, shellBackground, bodyBackground, htmlBackground }) => {
      const candidates = [
        ["iframe_body", frameVisibility !== "hidden" && visibleColor(frameBodyBackground) ? frameBodyBackground : ""],
        ["iframe", frameVisibility !== "hidden" && visibleColor(frameBackground) ? frameBackground : ""],
        ["note_wrapper", visibleColor(noteWrapperBackground) ? noteWrapperBackground : ""],
        ["note_page", visibleColor(notePageBackground) ? notePageBackground : ""],
        ["light_shell", visibleColor(lightShellBackground) ? lightShellBackground : ""],
        ["feed", visibleColor(feedBackground) ? feedBackground : ""],
        ["app_shell", visibleColor(shellBackground) ? shellBackground : ""],
        ["body", visibleColor(bodyBackground) ? bodyBackground : ""],
        ["html", visibleColor(htmlBackground) ? htmlBackground : ""],
      ];
      for (const [source, color] of candidates) {
        if (color) {
          return { visible_surface_source: source, visible_surface_rgb: color, visible_surface_luma: lumaFromRgb(color) };
        }
      }
      return { visible_surface_source: "unknown", visible_surface_rgb: "", visible_surface_luma: null };
    };

    delete window.__puckyNoteFlashTimelinePromise;
    const row = Array.from(document.querySelectorAll(".light-note-row")).find((node) => String(node.getAttribute("data-note-id") || "") === String(noteId || ""));
    if (!row) {
      window.__puckyNoteFlashTimelinePromise = Promise.resolve([]);
      return;
    }

    window.__puckyNoteFlashTimelinePromise = new Promise((resolve) => {
      const state = {
        active: false,
        startedAt: 0,
        readyAt: null,
        samples: [],
        resolved: false,
      };
      const begin = () => {
        if (state.active) {
          return;
        }
        state.active = true;
        state.startedAt = performance.now();
      };
      row.addEventListener("pointerdown", begin, { capture: true, once: true });
      row.addEventListener("click", begin, { capture: true, once: true });

      const step = (timestamp) => {
        if (!state.active) {
          window.requestAnimationFrame(step);
          return;
        }
        const elapsedMs = Math.max(0, Math.round(timestamp - state.startedAt));
        const appShell = document.querySelector(".app-shell");
        const feed = document.getElementById("feed");
        const lightShell = document.querySelector(".light-shell");
        const notePage = document.querySelector(".light-note-detail-page");
        const wrapper = notePage?.querySelector(".light-detail-html-body");
        const frame = wrapper?.querySelector(".light-html-frame");
        const frameState = readFrameState(frame);
        const frameVisibility = frame instanceof Element ? String(window.getComputedStyle(frame).visibility || "").trim() : "";
        const sample = {
          elapsed_ms: elapsedMs,
          route: String(lightShell?.getAttribute("data-light-route") || ""),
          theme: String(appShell?.getAttribute("data-theme") || ""),
          wrapper_state: String(wrapper?.getAttribute("data-html-frame-state") || ""),
          iframe_visibility: frameVisibility,
          iframe_ready_state: frameState.readyState,
          shell_background_color: backgroundColor(appShell),
          shell_background_image: backgroundImage(appShell),
          feed_background_color: backgroundColor(feed),
          light_shell_background_color: backgroundColor(lightShell),
          note_page_background_color: backgroundColor(notePage),
          note_wrapper_background_color: backgroundColor(wrapper),
          iframe_background_color: backgroundColor(frame),
        };
        const visible = chooseVisibleSurface({
          frame,
          frameVisibility,
          frameBodyBackground: frameState.bodyBackground,
          frameBackground: sample.iframe_background_color,
          noteWrapperBackground: sample.note_wrapper_background_color,
          notePageBackground: sample.note_page_background_color,
          lightShellBackground: sample.light_shell_background_color,
          feedBackground: sample.feed_background_color,
          shellBackground: sample.shell_background_color,
          bodyBackground: backgroundColor(document.body),
          htmlBackground: backgroundColor(document.documentElement),
        });
        sample.visible_surface_source = visible.visible_surface_source;
        sample.visible_surface_rgb = visible.visible_surface_rgb;
        sample.visible_surface_luma = visible.visible_surface_luma;
        state.samples.push(sample);
        if (sample.wrapper_state === "ready" && state.readyAt === null) {
          state.readyAt = elapsedMs;
        }
        const targetMs = state.readyAt === null
          ? maxMs
          : Math.min(maxMs, Math.max(minMs, state.readyAt + afterReadyMs));
        if (state.samples.length >= sampleLimit || elapsedMs >= targetMs) {
          if (!state.resolved) {
            state.resolved = true;
            resolve(state.samples);
          }
          return;
        }
        window.requestAnimationFrame(step);
      };

      window.requestAnimationFrame(step);
    });
  }, {
    noteId,
    scoreCrop: SCORE_CROP,
    maxMs: NOTES_DETAIL_FLASH_CAPTURE_MAX_MS,
    minMs: NOTES_DETAIL_FLASH_CAPTURE_MIN_MS,
    afterReadyMs: NOTES_DETAIL_FLASH_CAPTURE_AFTER_READY_MS,
    sampleLimit: NOTES_DETAIL_FLASH_TRACE_SAMPLE_LIMIT,
  });
}

async function readDebugTrace(page) {
  return page.evaluate(() => {
    const api = window.__puckyNoteFlashDebug;
    if (!api || typeof api.getTrace !== "function") {
      return [];
    }
    return api.getTrace();
  });
}

async function clearDebugTrace(page) {
  await page.evaluate(() => {
    const api = window.__puckyNoteFlashDebug;
    if (api && typeof api.clearTrace === "function") {
      api.clearTrace();
    }
  });
}

async function readDebugState(page) {
  return page.evaluate(() => {
    const api = window.__puckyNoteFlashDebug;
    if (!api || typeof api.getState !== "function") {
      return null;
    }
    return api.getState();
  });
}

async function scoreScreenshotInBrowser(scorerPage, screenshotPath) {
  const imageBuffer = fs.readFileSync(screenshotPath);
  const dataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`;
  return scorerPage.evaluate(async ({ targetDataUrl, crop }) => {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode screenshot for scoring"));
      img.src = targetDataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(crop.x, crop.y, crop.width, crop.height).data;
    const channelToLinear = (value) => {
      const normalized = Math.max(0, Math.min(255, Number(value || 0))) / 255;
      if (normalized <= 0.04045) {
        return normalized / 12.92;
      }
      return ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const lumaFromRgb = (red, green, blue) => (
      0.2126 * channelToLinear(red)
      + 0.7152 * channelToLinear(green)
      + 0.0722 * channelToLinear(blue)
    );
    let totalLuma = 0;
    let maxLuma = 0;
    let minLuma = 1;
    let brightPixels = 0;
    let darkPixels = 0;
    let pixels = 0;
    for (let index = 0; index < imageData.length; index += 4) {
      const luma = lumaFromRgb(imageData[index], imageData[index + 1], imageData[index + 2]);
      totalLuma += luma;
      maxLuma = Math.max(maxLuma, luma);
      minLuma = Math.min(minLuma, luma);
      if (luma >= 0.9) {
        brightPixels += 1;
      }
      if (luma <= 0.2) {
        darkPixels += 1;
      }
      pixels += 1;
    }
    const denominator = Math.max(1, pixels);
    return {
      crop,
      pixel_count: pixels,
      mean_luma: Number((totalLuma / denominator).toFixed(6)),
      max_luma: Number(maxLuma.toFixed(6)),
      min_luma: Number((pixels ? minLuma : 0).toFixed(6)),
      bright_pixel_ratio: Number((brightPixels / denominator).toFixed(6)),
      dark_pixel_ratio: Number((darkPixels / denominator).toFixed(6)),
    };
  }, {
    targetDataUrl: dataUrl,
    crop: SCORE_CROP,
  });
}

function hasTransitionConsoleErrors(consoleEntries = []) {
  return (Array.isArray(consoleEntries) ? consoleEntries : []).some((entry) => {
    const level = String(entry?.level || "").trim().toLowerCase();
    if (level !== "error" && level !== "pageerror") {
      return false;
    }
    const text = String(entry?.text || "").trim();
    if (text.includes("Blocked script execution in 'about:blank' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.")) {
      return false;
    }
    if (text.includes("Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.")) {
      return false;
    }
    return true;
  });
}

function buildAttemptName(theme, lane, label) {
  return `${theme}-${lane}-${label}`;
}

async function captureCanonicalAttempt(browser, scorerPage, config, theme, lane, note, laneDir) {
  const requestLog = [];
  const consoleEntries = [];
  const context = await browser.newContext({
    viewport: VIEWPORT,
    screen: VIEWPORT,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir: path.join(laneDir, "video"), size: VIEWPORT },
  });
  attachRequestLogging(context, requestLog);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const consoleLogPath = path.join(laneDir, "console.log");
  attachPageLogging(page, consoleLogPath);
  page.on("console", (message) => {
    consoleEntries.push({
      level: message.type(),
      text: message.text(),
      at: new Date().toISOString(),
    });
  });
  page.on("pageerror", (error) => {
    consoleEntries.push({
      level: "pageerror",
      text: error.message,
      at: new Date().toISOString(),
    });
  });

  let traceZipPath = path.join(laneDir, "trace.zip");
  try {
    await preparePage(page, config, theme, lane);
    await saveScreenshot(page, laneDir, buildAttemptName(theme, lane, "preclick"));
    await clearDebugTrace(page);
    await installTimelineCapture(page, note.id);
    await page.locator(`.light-note-row[data-note-id="${note.id}"]`).first().click();
    await waitForRoute(page, "note-detail", config.timeoutMs);
    const firstRouteFramePath = await saveScreenshot(page, laneDir, buildAttemptName(theme, lane, "first-route-frame"));
    const settledState = await waitForSettledNote(page, note, config.timeoutMs);
    const settledPath = await saveScreenshot(page, laneDir, buildAttemptName(theme, lane, "settled"));
    const debugTrace = await readDebugTrace(page);
    const debugState = await readDebugState(page);
    const timeline = await page.evaluate(() => window.__puckyNoteFlashTimelinePromise || []);
    const settledScore = await scoreScreenshotInBrowser(scorerPage, settledPath);
    const firstRouteScore = await scoreScreenshotInBrowser(scorerPage, firstRouteFramePath);
    const artifacts = {
      preclick_screenshot: path.join(laneDir, `${buildAttemptName(theme, lane, "preclick")}.png`),
      first_route_frame_screenshot: firstRouteFramePath,
      settled_screenshot: settledPath,
      console_log: consoleLogPath,
      requests_json: path.join(laneDir, "requests.json"),
      console_entries_json: path.join(laneDir, "console.json"),
      debug_trace_json: path.join(laneDir, "debug-trace.json"),
      timeline_json: path.join(laneDir, "timeline.json"),
      trace_zip: traceZipPath,
      video_dir: path.join(laneDir, "video"),
    };
    writeJsonFile(artifacts.requests_json, requestLog);
    writeJsonFile(artifacts.console_entries_json, consoleEntries);
    writeJsonFile(artifacts.debug_trace_json, debugTrace);
    writeJsonFile(artifacts.timeline_json, timeline);
    return {
      ok: true,
      settled_state: settledState,
      debug_state: debugState,
      debug_phase_order: orderedObservedPhases(debugTrace),
      debug_trace_count: Array.isArray(debugTrace) ? debugTrace.length : 0,
      timeline_samples: Array.isArray(timeline) ? timeline.length : 0,
      first_route_frame_score: firstRouteScore,
      settled_score: settledScore,
      console_entries: consoleEntries,
      request_count: requestLog.length,
      artifacts,
    };
  } finally {
    await context.tracing.stop({ path: traceZipPath }).catch(() => {});
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function captureOffsetAttempt(browser, scorerPage, config, theme, lane, note, laneDir, offsetMs, index) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    screen: VIEWPORT,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    await preparePage(page, config, theme, lane);
    await page.locator(`.light-note-row[data-note-id="${note.id}"]`).first().click();
    if (offsetMs > 0) {
      await page.waitForTimeout(offsetMs);
    }
    const stem = `${theme}-${lane}-offset-${String(offsetMs).padStart(3, "0")}ms`;
    const screenshotPath = await saveScreenshot(page, laneDir, stem);
    const score = await scoreScreenshotInBrowser(scorerPage, screenshotPath);
    const classification = classifyLaneMetrics({ theme, lane, metrics: score });
    const settledState = await waitForSettledNote(page, note, config.timeoutMs);
    return {
      ok: classification.ok,
      index,
      offset_ms: offsetMs,
      screenshot: screenshotPath,
      score,
      classification,
      settled_state: settledState,
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

function verifySettledState(theme, lane, settledState, note) {
  const failures = [];
  if (String(settledState?.route || "") !== "note-detail") {
    failures.push(`route:${settledState?.route || "missing"}`);
  }
  if (String(settledState?.wrapper_state || "") !== "ready") {
    failures.push(`wrapper_state:${settledState?.wrapper_state || "missing"}`);
  }
  if (!Boolean(settledState?.iframe_present)) {
    failures.push("iframe_present:false");
  }
  if (String(settledState?.iframe_visibility || "") === "hidden") {
    failures.push("iframe_visibility:hidden");
  }
  if (!String(settledState?.iframe_body_text || "").includes(note.title)) {
    failures.push("iframe_body_text:missing_seed_title");
  }
  if (String(settledState?.iframe_document_theme || "") && String(settledState.iframe_document_theme) !== theme) {
    failures.push(`iframe_document_theme:${settledState.iframe_document_theme}`);
  }
  return {
    ok: failures.length === 0,
    failures,
    lane,
  };
}

function summarizeLane(theme, lane, canonical, attempts, note) {
  const laneCategories = new Set();
  const settledVerification = verifySettledState(theme, lane, canonical.settled_state || {}, note);
  if (!settledVerification.ok) {
    laneCategories.add("note_never_ready");
  }
  if (hasTransitionConsoleErrors(canonical.console_entries)) {
    laneCategories.add("console_error_during_transition");
  }
  const requiredPhases = new Set(NOTES_DETAIL_FLASH_REQUIRED_PHASES);
  const observedPhases = new Set(canonical.debug_phase_order || []);
  const missingPhases = Array.from(requiredPhases).filter((phase) => {
    if (phase === "note_iframe_fail_open") {
      return false;
    }
    if (phase === "note_iframe_ready") {
      return !(observedPhases.has("note_iframe_ready") || observedPhases.has("note_iframe_fail_open"));
    }
    return !observedPhases.has(phase);
  });
  if (missingPhases.length) {
    laneCategories.add("instrumentation_gap");
  }
  if (!attempts.length) {
    laneCategories.add("seed_note_missing");
  }
  for (const attempt of attempts) {
    for (const category of attempt.classification?.categories || []) {
      laneCategories.add(category);
    }
  }
  const worstFrame = chooseWorstFrame(theme, attempts.map((attempt) => ({
    offset_ms: attempt.offset_ms,
    screenshot: attempt.screenshot,
    score: attempt.score,
    classification: attempt.classification,
  })));
  const worstFramePath = worstFrame ? path.join(path.dirname(worstFrame.screenshot), `${theme}-${lane}-worst-frame.png`) : "";
  if (worstFrame) {
    fs.copyFileSync(worstFrame.screenshot, worstFramePath);
  }
  const ok = laneCategories.size === 0;
  return {
    ok,
    attempts,
    settled_state: canonical.settled_state,
    settled_verification: settledVerification,
    worst_frame: worstFrame ? {
      offset_ms: worstFrame.offset_ms,
      screenshot: worstFramePath,
      source_screenshot: worstFrame.screenshot,
      score: worstFrame.score,
      classification: worstFrame.classification,
    } : null,
    failure_categories: Array.from(laneCategories),
    missing_phases: missingPhases,
    debug_phase_order: canonical.debug_phase_order,
    artifacts: canonical.artifacts,
  };
}

async function runLane(browser, scorerPage, config, theme, lane, note) {
  const laneDir = path.join(config.reportDir, theme, lane);
  ensureDir(laneDir);
  logStep(config, `running ${theme}/${lane}`);
  const canonical = await captureCanonicalAttempt(browser, scorerPage, config, theme, lane, note, laneDir);
  const attempts = [];
  for (let index = 0; index < NOTES_DETAIL_FLASH_OFFSETS_MS.length; index += 1) {
    const offsetMs = NOTES_DETAIL_FLASH_OFFSETS_MS[index];
    logStep(config, `capturing ${theme}/${lane} offset ${offsetMs}ms`);
    attempts.push(await captureOffsetAttempt(browser, scorerPage, config, theme, lane, note, laneDir, offsetMs, index));
  }
  return summarizeLane(theme, lane, canonical, attempts, note);
}

function buildThemeSummary(theme, lanes) {
  return {
    theme,
    natural_click: lanes.natural_click,
    route_delay: lanes.route_delay,
    iframe_delay: lanes.iframe_delay,
  };
}

function buildManifestVerdict(config, localGit, remoteManifest) {
  const manifest = remoteManifest?.manifest || {};
  const requiredCommit = String(config.requiredCommit || localGit.head || "").trim();
  const buildDirty = Boolean(manifest.source_dirty);
  const buildVerified = !buildDirty && (
    requiredCommit
      ? String(manifest.source_commit_full || "") === requiredCommit
      : true
  );
  return {
    build_dirty: buildDirty,
    build_verified: buildVerified,
    required_commit: requiredCommit,
  };
}

function writeReport(config, summary) {
  const manifest = summary.remote_manifest?.manifest || {};
  const lines = [
    "# Notes Fast-Twitch Browser Proof v2",
    "",
    `- Schema: ${summary.schema}`,
    `- Base URL: ${summary.base_url}`,
    `- Target kind: ${summary.target_kind}`,
    `- Seeded note: ${summary.seeded_note.title} (${summary.seeded_note.id})`,
    `- Build verified: ${summary.build_verified}`,
    `- Build dirty: ${summary.build_dirty}`,
    `- Remote manifest: ${manifest.source_commit_full || "unknown"} (${manifest.ui_version || "unknown"})`,
    "",
  ];
  for (const theme of ["light", "dark"]) {
    lines.push(`## ${theme[0].toUpperCase()}${theme.slice(1)}`);
    lines.push("");
    for (const lane of NOTES_DETAIL_FLASH_LANES) {
      const entry = summary.themes?.[theme]?.[lane];
      lines.push(`### ${lane}`);
      lines.push("");
      lines.push(`- ok: ${Boolean(entry?.ok)}`);
      lines.push(`- worst frame: ${entry?.worst_frame?.screenshot || "none"}`);
      lines.push(`- worst offset: ${entry?.worst_frame?.offset_ms ?? "n/a"}ms`);
      lines.push(`- score: mean=${entry?.worst_frame?.score?.mean_luma ?? "n/a"} bright=${entry?.worst_frame?.score?.bright_pixel_ratio ?? "n/a"} dark=${entry?.worst_frame?.score?.dark_pixel_ratio ?? "n/a"}`);
      lines.push(`- failures: ${(entry?.failure_categories || []).join(", ") || "none"}`);
      lines.push(`- phase order: ${(entry?.debug_phase_order || []).join(" -> ") || "none"}`);
      lines.push(`- settled route/state: ${entry?.settled_state?.route || "missing"} / ${entry?.settled_state?.wrapper_state || "missing"}`);
      lines.push("");
    }
  }
  fs.writeFileSync(path.join(config.reportDir, "report.md"), `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (!String(config.apiToken || "").trim()) {
    throw new Error("Notes detail flash browser proof requires --api-token or PUCKY_WEB_UI_TOKEN/PUCKY_WORKSPACE_PROOF_TOKEN/PUCKY_API_TOKEN");
  }
  ensureDir(config.reportDir);
  const localGit = localGitState();
  config.refreshKey = localGit.headShort || config.runId;
  config.seed = buildSeed(config.runId);
  const summary = {
    schema: NOTES_DETAIL_FLASH_RESULT_SCHEMA_V2,
    created_at: new Date().toISOString(),
    base_url: config.baseUrl,
    target_kind: targetKindForBaseUrl(config.baseUrl),
    local_git: localGit,
    remote_manifest: null,
    build_verified: false,
    build_dirty: false,
    viewport: VIEWPORT,
    seeded_note: {
      id: config.seed.id,
      title: config.seed.title,
    },
    debug_defaults: {
      debug_note_flash: true,
      route_delay_ms: NOTES_DETAIL_FLASH_ROUTE_DELAY_MS,
      iframe_delay_ms: NOTES_DETAIL_FLASH_IFRAME_DELAY_MS,
      fail_open_ms: NOTES_DETAIL_FLASH_FAIL_OPEN_MS,
      offsets_ms: NOTES_DETAIL_FLASH_OFFSETS_MS.slice(),
      score_crop: SCORE_CROP,
      dark_thresholds: {
        mean_luma_max: NOTES_DETAIL_FLASH_DARK_MEAN_LUMA_MAX,
        bright_pixel_ratio_max: NOTES_DETAIL_FLASH_DARK_BRIGHT_PIXEL_RATIO_MAX,
      },
      light_thresholds: {
        mean_luma_min: NOTES_DETAIL_FLASH_LIGHT_MEAN_LUMA_MIN,
        dark_pixel_ratio_max: NOTES_DETAIL_FLASH_LIGHT_DARK_PIXEL_RATIO_MAX,
      },
      required_phases: NOTES_DETAIL_FLASH_REQUIRED_PHASES.slice(),
      failure_categories: NOTES_DETAIL_FLASH_FAILURE_CATEGORIES.slice(),
    },
    themes: {},
  };

  let browser;
  let scorerContext;
  try {
    logStep(config, `seeding note ${config.seed.id}`);
    await seedNoteRecord(config, config.seed);
    summary.remote_manifest = await fetchRemoteManifest(config.baseUrl, config.refreshKey);
    const verdict = buildManifestVerdict(config, localGit, summary.remote_manifest);
    summary.build_dirty = verdict.build_dirty;
    summary.build_verified = verdict.build_verified;
    if (summary.target_kind === "hosted_vm") {
      assert(summary.build_verified, `Hosted manifest commit ${summary.remote_manifest.manifest?.source_commit_full || "empty"} did not match required commit ${verdict.required_commit || "empty"}`);
      assert(shortCommitMatches(verdict.required_commit, summary.remote_manifest.manifest?.source_commit_short), "Hosted manifest short commit did not match the required commit");
    }

    const chromium = await loadChromium();
    browser = await chromium.launch({
      headless: true,
      executablePath: resolveChromePath(),
    });
    scorerContext = await browser.newContext({ viewport: VIEWPORT });
    const scorerPage = await scorerContext.newPage();
    await scorerPage.setContent("<!doctype html><html><body></body></html>");

    for (const theme of ["light", "dark"]) {
      const lanes = {};
      for (const lane of NOTES_DETAIL_FLASH_LANES) {
        lanes[lane] = await runLane(browser, scorerPage, config, theme, lane, config.seed);
      }
      summary.themes[theme] = buildThemeSummary(theme, lanes);
    }

    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    writeReport(config, summary);

    const failingLanes = [];
    for (const theme of ["light", "dark"]) {
      for (const lane of NOTES_DETAIL_FLASH_LANES) {
        if (!summary.themes?.[theme]?.[lane]?.ok) {
          failingLanes.push(`${theme}/${lane}`);
        }
      }
    }
    if (failingLanes.length) {
      throw new Error(`Notes fast-twitch browser proof failed for ${failingLanes.join(", ")}`);
    }
  } catch (error) {
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    writeReport(config, summary);
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    if (scorerContext) {
      await scorerContext.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (!config.keepSeed) {
      await cleanupNoteRecord(config, config.seed.id).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
