import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";
import { loadProofRuntimeEnv, resolveWriteToken } from "../../support/proof_runtime_env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_LIGHT_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=light&reset_nav=1";
const DEFAULT_DARK_FEED_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=dark&route=inbox&reset_nav=1";
const DEFAULT_DARK_MEETINGS_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=dark&route=meetings&reset_nav=1";
const VIEWPORT = { width: 430, height: 932 };
const NARROW_VIEWPORT = { width: 320, height: 932 };
const INBOX_MANAGE_SELECT_SELECTOR = '[data-card-action="manage_select"]';
const INBOX_MANAGE_MENU_SELECTOR = '[data-card-action="manage_menu"]';
const INBOX_MANAGE_BAR_SELECTOR = '.app-shell[data-canonical-route="inbox"] .inbox-manage-bar';
const INBOX_MANAGE_PRIMARY_ACTION_SELECTOR = `${INBOX_MANAGE_BAR_SELECTOR} .inbox-manage-action.is-primary`;
const INBOX_MANAGEMENT_PROCESSING_PROOF_CARD_ID = "proof_card_meeting_processing_escape_hatch";
const INBOX_MANAGEMENT_PROCESSING_PROOF_CARD = {
  card_id: INBOX_MANAGEMENT_PROCESSING_PROOF_CARD_ID,
  session_id: "proof_meeting_processing_escape_hatch",
  title: "Processing meeting recording",
  summary: "Transcribing, diarizing, and checking for follow-up instructions...",
  created_at: "2026-06-23T00:00:00Z",
  updated_at: "2026-06-23T00:00:00Z",
  archived: false,
  card_kind: "meeting_processing",
  meeting_state: "processing",
  accent: "#72c2ff",
  origin: {
    card_kind: "meeting_processing",
    meeting_state: "processing",
    meeting_id: "proof_meeting_processing_escape_hatch"
  }
};

function parseViewport(value, fallback = VIEWPORT) {
  const match = String(value || "").trim().match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) {
    return { ...fallback };
  }
  return {
    width: Math.max(280, Number(match[1]) || fallback.width),
    height: Math.max(480, Number(match[2]) || fallback.height)
  };
}

function parseArgs(argv) {
  const config = {
    lightUrl: process.env.PUCKY_LIGHT_NATIVE_URL || DEFAULT_LIGHT_URL,
    darkFeedUrl: process.env.PUCKY_DARK_FEED_URL || DEFAULT_DARK_FEED_URL,
    darkMeetingsUrl: process.env.PUCKY_DARK_MEETINGS_URL || DEFAULT_DARK_MEETINGS_URL,
    reportDir: path.resolve("artifacts", "light-native-ports"),
    timeoutMs: 30000,
    browserName: "chromium",
    headless: true,
    onlyInboxManagement: false,
    viewport: { ...VIEWPORT },
    liveBackend: false,
    apiToken: process.env.PUCKY_API_TOKEN || process.env.PUCKY_OPERATOR_TOKEN || "",
    expectedSha: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--light-url" && argv[index + 1]) {
      config.lightUrl = String(argv[++index] || config.lightUrl);
    } else if (arg === "--dark-feed-url" && argv[index + 1]) {
      config.darkFeedUrl = String(argv[++index] || config.darkFeedUrl);
    } else if (arg === "--dark-meetings-url" && argv[index + 1]) {
      config.darkMeetingsUrl = String(argv[++index] || config.darkMeetingsUrl);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = String(argv[++index] || config.reportDir);
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--browser" && argv[index + 1]) {
      const browserName = String(argv[++index] || config.browserName).trim().toLowerCase();
      config.browserName = browserName === "webkit" ? "webkit" : "chromium";
    } else if (arg === "--viewport" && argv[index + 1]) {
      config.viewport = parseViewport(argv[++index], config.viewport);
    } else if (arg === "--only-inbox-management") {
      config.onlyInboxManagement = true;
    } else if (arg === "--live-backend") {
      config.liveBackend = true;
    } else if (arg === "--api-token" && argv[index + 1]) {
      config.apiToken = String(argv[++index] || "");
    } else if (arg === "--expected-sha" && argv[index + 1]) {
      config.expectedSha = String(argv[++index] || "").trim();
    } else if (arg === "--headed") {
      config.headless = false;
    }
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isDisposableRouteFetchError(error) {
  const message = String(error && error.message ? error.message : error || "");
  return /target page, context or browser has been closed/i.test(message)
    || /fetch response has been disposed/i.test(message);
}

async function abortRouteIfDisposed(route, error) {
  if (!isDisposableRouteFetchError(error)) {
    return false;
  }
  await route.abort("failed").catch(() => {});
  return true;
}

function authHeaders(token) {
  const cleanToken = String(token || "").trim();
  return cleanToken ? { Authorization: `Bearer ${cleanToken}` } : {};
}

async function fetchTextStrict(url, token = "") {
  const response = await fetch(url, {
    headers: authHeaders(token),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`Could not load ${url} (${response.status})`);
  }
  return response.text();
}

async function fetchJsonStrict(url, init = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed for ${url} (${response.status}): ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Response from ${url} was not valid JSON: ${String(error?.message || error)}`);
  }
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

async function fetchManifestBundle(pageUrl, token = "", refreshValue = "") {
  const manifestUrl = new URL("manifest.json", pageUrl);
  if (refreshValue) {
    manifestUrl.searchParams.set("_pucky_refresh", refreshValue);
  }
  const manifest = await fetchJsonStrict(manifestUrl.toString(), {
    headers: authHeaders(token)
  });
  const fileChecks = {};
  for (const fileName of ["app.js", "styles.css"]) {
    const fileUrl = new URL(fileName, manifestUrl.toString());
    if (refreshValue) {
      fileUrl.searchParams.set("_pucky_refresh", refreshValue);
    }
    const fetched = await fetchTextStrict(fileUrl.toString(), token);
    const fetchedSha256 = sha256Text(fetched);
    const manifestSha256 = String(manifest?.files?.[fileName]?.sha256 || "");
    fileChecks[fileName] = {
      url: fileUrl.toString(),
      manifest_sha256: manifestSha256,
      fetched_sha256: fetchedSha256,
      matches_manifest: manifestSha256 ? manifestSha256 === fetchedSha256 : false
    };
    assert(manifestSha256, `Manifest did not include ${fileName} sha256`);
    assert(manifestSha256 === fetchedSha256, `Live ${fileName} sha256 did not match manifest`);
  }
  return {
    manifest_url: manifestUrl.toString(),
    source_commit_full: String(manifest?.source_commit_full || ""),
    source_dirty: Boolean(manifest?.source_dirty),
    ui_version: String(manifest?.ui_version || ""),
    file_count: manifest?.files && typeof manifest.files === "object" ? Object.keys(manifest.files).length : 0,
    files: fileChecks
  };
}

function installNoAudioGuard(page) {
  const guard = {
    clickedAudioCount: 0,
    mediaRequestCount: 0,
    mediaRequests: []
  };
  page.on("request", request => {
    const url = request.url();
    const resourceType = String(request.resourceType() || "");
    if (
      resourceType === "media"
      || /\.(?:mp3|m4a|wav|aac|ogg|opus|mp4)(?:[?#]|$)/i.test(url)
      || /\/api\/media\/|\/media\//i.test(url)
    ) {
      guard.mediaRequestCount += 1;
      guard.mediaRequests.push({
        url,
        resource_type: resourceType,
        method: request.method()
      });
    }
  });
  return guard;
}

function noAudioSummary(guard) {
  return {
    clicked_audio_count: Number(guard?.clickedAudioCount || 0),
    media_request_count: Number(guard?.mediaRequestCount || 0),
    media_requests: Array.isArray(guard?.mediaRequests) ? guard.mediaRequests.slice() : []
  };
}

function assertNoUnexpectedAudio(guard, label) {
  const summary = noAudioSummary(guard);
  assert(summary.clicked_audio_count === 0, `${label} clicked audio controls ${summary.clicked_audio_count} times`);
  assert(summary.media_request_count === 0, `${label} observed unexpected media requests`);
  return summary;
}

function withInboxManagementProcessingProofCard(items) {
  const currentItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (currentItems.some(item => String(item?.card_id || "").trim() === INBOX_MANAGEMENT_PROCESSING_PROOF_CARD_ID)) {
    return currentItems;
  }
  if (currentItems.length === 0) {
    return [{ ...INBOX_MANAGEMENT_PROCESSING_PROOF_CARD }];
  }
  return [
    currentItems[0],
    { ...INBOX_MANAGEMENT_PROCESSING_PROOF_CARD },
    ...currentItems.slice(1)
  ];
}

function cssAttributeValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function inboxCardWrap(page, cardId) {
  const selector = `article.card[data-card-id="${cssAttributeValue(cardId)}"]`;
  return page.locator(".light-shell[data-light-route=\"inbox\"] .card-wrap")
    .filter({ has: page.locator(selector) })
    .first();
}

async function ensureInboxArchiveFilter(page, showArchived, timeoutMs) {
  const desired = Boolean(showArchived);
  const state = await page.locator(".light-shell[data-light-route=\"inbox\"] .inbox-archive-toggle").first()
    .getAttribute("aria-pressed")
    .catch(() => null);
  const current = state === "true";
  if (current !== desired) {
    await clickLocator(page, page.locator(".light-shell[data-light-route=\"inbox\"] .inbox-archive-toggle").first(), timeoutMs, desired ? "Show archived Inbox" : "Show active Inbox");
  }
  await page.waitForFunction(
    expected => {
      const toggle = document.querySelector(".light-shell[data-light-route=\"inbox\"] .inbox-archive-toggle");
      return toggle?.getAttribute("aria-pressed") === String(expected)
        && toggle?.getAttribute("aria-busy") !== "true"
        && !document.querySelector(".app-shell.is-inbox-archive-filter-loading");
    },
    desired,
    { timeout: timeoutMs }
  );
}

async function exerciseInboxArchiveFilterLoading(page, feedEmulation, showArchived, timeoutMs, reportDir) {
  const desired = Boolean(showArchived);
  const before = await readInboxManagementState(page);
  assert(before.archive_toggle_pressed !== desired, "Archive filter loading proof requires a state transition");
  feedEmulation.delayNextFeedMs = 700;
  await clickLocator(page, page.locator(".light-shell[data-light-route=\"inbox\"] .inbox-archive-toggle").first(), timeoutMs, desired ? "Show archived Inbox with loading proof" : "Show active Inbox with loading proof");
  await page.waitForFunction(
    expected => {
      const toggle = document.querySelector(".light-shell[data-light-route=\"inbox\"] .inbox-archive-toggle");
      const notice = document.querySelector(".light-shell[data-light-route=\"inbox\"] .inbox-archive-loading-notice");
      return toggle?.getAttribute("aria-busy") === "true"
        && toggle?.hasAttribute("disabled")
        && toggle?.getAttribute("data-pending-target") === String(expected)
        && Boolean(document.querySelector(".app-shell.is-inbox-archive-filter-loading"))
        && /Loading (archived|active) replies/.test(String(notice?.textContent || ""));
    },
    desired,
    { timeout: Math.min(1200, timeoutMs) }
  );
  const loading = await readInboxManagementState(page);
  const loadingScreenshot = await saveScreenshot(page, reportDir, desired ? "07a-archive-filter-loading-archived" : "07a-archive-filter-loading-active");
  assert(loading.archive_toggle_busy, "Archive filter should expose aria-busy while loading");
  assert(loading.archive_toggle_disabled, "Archive filter should be disabled while loading");
  assert(loading.archive_loading_shell_active, "App shell should expose archive-filter loading state");
  assert(new RegExp(desired ? "Loading archived replies" : "Loading active replies").test(loading.archive_loading_notice_text), `Archive loading notice had unexpected text: ${loading.archive_loading_notice_text}`);
  await page.waitForFunction(
    expected => {
      const toggle = document.querySelector(".light-shell[data-light-route=\"inbox\"] .inbox-archive-toggle");
      return toggle?.getAttribute("aria-pressed") === String(expected)
        && toggle?.getAttribute("aria-busy") !== "true"
        && !document.querySelector(".app-shell.is-inbox-archive-filter-loading");
    },
    desired,
    { timeout: timeoutMs }
  );
  const loaded = await readInboxManagementState(page);
  return {
    before,
    loading,
    loaded,
    screenshot: loadingScreenshot
  };
}

let playwrightBrowsersPromise = null;

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

async function launchConfiguredBrowser(config) {
  const browserName = String(config.browserName || "chromium").trim().toLowerCase();
  const { chromium, webkit } = await loadPlaywrightBrowsers();
  if (browserName === "webkit") {
    return webkit.launch({ headless: config.headless });
  }
  return chromium.launch({
    executablePath: resolveChromePath(),
    headless: config.headless,
  });
}

function logAction(actions, name, details = {}) {
  actions.push({
    at: new Date().toISOString(),
    action: name,
    ...details
  });
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cssString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

async function waitForLightHome(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const shell = document.querySelector(".light-shell[data-light-route=\"home\"]");
      const grid = shell?.querySelector(".light-app-grid");
      const appShell = document.querySelector(".app-shell");
      const voice = document.querySelector("#voiceStatus");
      return !!shell && !!grid && appShell?.getAttribute("data-theme") === "light" && !!voice;
    },
    undefined,
    { timeout: timeoutMs }
  );
}

async function waitForLightRoute(page, route, selector, timeoutMs) {
  await page.waitForFunction(
    ({ expectedRoute, requiredSelector }) => {
      const shell = document.querySelector(`.light-shell[data-light-route="${expectedRoute}"]`);
      const appShell = document.querySelector(".app-shell");
      const target = requiredSelector ? shell?.querySelector(requiredSelector) : shell;
      const headerTitle = shell?.querySelector(".light-page-title");
      const voice = document.querySelector("#voiceStatus");
      return !!shell
        && !!target
        && !!headerTitle
        && !!voice
        && appShell?.getAttribute("data-theme") === "light";
    },
    { expectedRoute: route, requiredSelector: selector },
    { timeout: timeoutMs }
  );
}

async function waitForDarkRoute(page, route, selector, timeoutMs) {
  await page.waitForFunction(
    ({ expectedRoute, requiredSelector }) => {
      const routeShell = document.querySelector(`.light-shell[data-light-route="${expectedRoute}"]`);
      const headerTitle = routeShell?.querySelector(".light-page-title");
      const voice = document.querySelector("#voiceStatus");
      const shell = document.querySelector(".app-shell");
      const target = requiredSelector ? document.querySelector(requiredSelector) : document.body;
      return shell?.getAttribute("data-theme") === "dark" && !!target && !!headerTitle && !!voice;
    },
    { expectedRoute: route, requiredSelector: selector },
    { timeout: timeoutMs }
  );
}

async function readHiddenState(page, selector) {
  const locator = page.locator(selector);
  if (!await locator.count()) {
    return true;
  }
  return locator.evaluate(node => Boolean(node.hidden) || getComputedStyle(node).display === "none" || getComputedStyle(node).visibility === "hidden");
}

async function assertHidden(page, selector, message) {
  const hidden = await readHiddenState(page, selector);
  assert(hidden, message);
}

async function readLightHeaderTitle(page) {
  return normalizeText(await page.locator(".light-shell .light-page-title").first().textContent());
}

async function extractCardRows(page, selector, limit = 10) {
  return page.locator(selector).evaluateAll((nodes, maxRows) =>
    nodes.slice(0, maxRows).map(node => ({
      card_id: String(node.getAttribute("data-card-id") || "").trim(),
      session_id: String(node.getAttribute("data-card-session-id") || "").trim(),
      title: String(node.querySelector(".title")?.textContent || "").trim(),
      preview: String(node.querySelector(".preview")?.textContent || "").trim(),
      timestamp: String(node.querySelector(".card-timestamp")?.textContent || "").trim(),
      classes: String(node.className || "").trim(),
      unread: node.classList.contains("card-unread"),
      action_count: node.querySelectorAll("[data-card-action]").length
    })),
    limit
  );
}

function rowsMatch(leftRows, rightRows) {
  if (leftRows.length !== rightRows.length) {
    return false;
  }
  return leftRows.every((leftRow, index) => {
    const rightRow = rightRows[index];
    return leftRow.card_id === rightRow.card_id
      && leftRow.session_id === rightRow.session_id
      && leftRow.title === rightRow.title
      && leftRow.preview === rightRow.preview
      && leftRow.timestamp === rightRow.timestamp
      && leftRow.unread === rightRow.unread
      && leftRow.action_count === rightRow.action_count
      && leftRow.classes === rightRow.classes;
  });
}

async function readCardStyle(page, selector) {
  return page.locator(selector).first().evaluate(node => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderTopWidth: style.borderTopWidth,
      borderLeftWidth: style.borderLeftWidth,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      color: style.color
    };
  });
}

async function readMeetingRowLayout(page, selector, limit = 3) {
  return page.locator(selector).evaluateAll((nodes, maxRows) =>
    nodes.slice(0, maxRows).map(node => {
      const style = getComputedStyle(node);
      const cardRect = node.getBoundingClientRect();
      const bodyRect = node.querySelector(".card-body")?.getBoundingClientRect() || null;
      const metaRect = node.querySelector(".card-meeting-meta")?.getBoundingClientRect() || null;
      const titleRect = node.querySelector(".title")?.getBoundingClientRect() || null;
      const titleStyle = node.querySelector(".title") ? getComputedStyle(node.querySelector(".title")) : null;
      const timestampRect = node.querySelector(".card-timestamp")?.getBoundingClientRect() || null;
      const audioRect = node.querySelector('[data-card-action="audio"]')?.getBoundingClientRect() || null;
      const contentBottom = Math.max(
        titleRect?.bottom || cardRect.top,
        timestampRect?.bottom || cardRect.top,
        audioRect?.bottom || cardRect.top
      );
      const gridTemplateRows = String(style.gridTemplateRows || "").trim();
      return {
        title: String(node.querySelector(".title")?.textContent || "").trim(),
        height: Math.round(cardRect.height * 10) / 10,
        gridTemplateRows,
        gridRowCount: gridTemplateRows ? gridTemplateRows.split(/\s+/).filter(Boolean).length : 0,
        bottomSlackPx: Math.round((cardRect.bottom - contentBottom) * 10) / 10,
        bodyMetaGapPx: bodyRect && metaRect ? Math.round((metaRect.left - bodyRect.right) * 10) / 10 : null,
        timestampAboveAudio: Boolean(timestampRect && audioRect && timestampRect.bottom <= audioRect.top + 1.5),
        bodyLeftInset: bodyRect ? Math.round((bodyRect.left - cardRect.left) * 10) / 10 : null,
        titleLeftInset: titleRect ? Math.round((titleRect.left - cardRect.left) * 10) / 10 : null,
        titleHeight: titleRect ? Math.round(titleRect.height * 10) / 10 : null,
        titleLineHeight: titleStyle ? Math.round((Number.parseFloat(titleStyle.lineHeight || "0") || 0) * 10) / 10 : null
      };
    }),
    limit
  );
}

function assertFlatCardShell(style, label) {
  const background = String(style?.backgroundColor || "").trim().toLowerCase();
  const shadow = String(style?.boxShadow || "").trim().toLowerCase();
  const borderTop = Number.parseFloat(String(style?.borderTopWidth || "0")) || 0;
  const borderLeft = Number.parseFloat(String(style?.borderLeftWidth || "0")) || 0;
  const borderRadius = Number.parseFloat(String(style?.borderRadius || "0")) || 0;
  assert(background === "rgba(0, 0, 0, 0)" || background === "transparent", `${label} should keep a flat transparent resting shell`);
  assert(shadow === "none" || shadow === "", `${label} should not keep a boxed shadow`);
  assert(borderTop <= 0.5, `${label} should not keep a boxed top border`);
  assert(borderLeft <= 0.5, `${label} should not keep a boxed left border`);
  assert(borderRadius <= 0.5, `${label} should not keep rounded card chrome`);
}

function assertMeaningfulRows(label, rows) {
  assert(rows.length > 0, `${label} rendered no cards`);
  const meaningfulRows = rows.filter(row => Boolean(row.title || row.preview || row.timestamp));
  assert(
    meaningfulRows.length > 0,
    `${label} cards rendered, but they did not include visible title, preview, or timestamp content`
  );
}

function assertTightMeetingRows(label, rows, { expectedLeftInset = null, requireWrappedRow = false } = {}) {
  assert(rows.length > 0, `${label} did not expose any meeting rows to inspect.`);
  const referenceInset = typeof expectedLeftInset === "number" ? expectedLeftInset : rows[0]?.titleLeftInset;
  rows.forEach((row, index) => {
    assert(row.gridRowCount === 1, `${label} row ${index + 1} should use one effective grid row, got "${row.gridTemplateRows}".`);
    assert(row.bottomSlackPx <= 18, `${label} row ${index + 1} kept ${row.bottomSlackPx}px of dead bottom space.`);
    assert((row.bodyMetaGapPx ?? -1) >= 4, `${label} row ${index + 1} body overlapped or crowded the right rail (gap ${row.bodyMetaGapPx}px).`);
    assert(row.timestampAboveAudio, `${label} row ${index + 1} should keep the timestamp above the mic action.`);
    assert(row.titleLeftInset != null && row.bodyLeftInset != null, `${label} row ${index + 1} did not expose title/body left inset metrics.`);
    assert(Math.abs(row.titleLeftInset - row.bodyLeftInset) <= 1.5, `${label} row ${index + 1} title drifted away from the shared left column (${row.titleLeftInset} vs ${row.bodyLeftInset}).`);
    if (typeof referenceInset === "number") {
      assert(Math.abs(row.titleLeftInset - referenceInset) <= 1.5, `${label} row ${index + 1} changed left inset unexpectedly (${row.titleLeftInset} vs ${referenceInset}).`);
    }
  });
  if (requireWrappedRow) {
    assert(rows.some(row => (row.titleHeight ?? 0) > (row.titleLineHeight ?? 0) * 1.5), `${label} should include a wrapped long title row.`);
  }
}

async function readScrollReachability(page, rowsSelector, preferredContainerSelectors = []) {
  return page.evaluate(({ rowSel, preferredSelectors }) => {
    const rows = Array.from(document.querySelectorAll(rowSel || "*")).filter(node => node instanceof HTMLElement);
    if (!rows.length) {
      return {
        found: false,
        reason: `Missing rows ${rowSel}`
      };
    }
    const candidates = [];
    const seen = new Set();
    const addCandidate = (node, source) => {
      if (!(node instanceof HTMLElement) || seen.has(node)) {
        return;
      }
      seen.add(node);
      candidates.push({ node, source });
    };
    for (const selector of preferredSelectors || []) {
      addCandidate(document.querySelector(selector), `selector:${selector}`);
    }
    let ancestor = rows[0].parentElement;
    while (ancestor) {
      addCandidate(ancestor, `ancestor:${ancestor.tagName.toLowerCase()}${ancestor.id ? `#${ancestor.id}` : ""}`);
      ancestor = ancestor.parentElement;
    }
    addCandidate(document.scrollingElement, "document.scrollingElement");
    const measurements = candidates
      .map(candidate => {
        const containerRows = Array.from(candidate.node.querySelectorAll(rowSel || "*"));
        const scrollHeight = Number(candidate.node.scrollHeight.toFixed(2));
        const clientHeight = Number(candidate.node.clientHeight.toFixed(2));
        return {
          container: candidate.node,
          source: candidate.source,
          row_count: containerRows.length,
          scroll_height: scrollHeight,
          client_height: clientHeight,
          can_scroll: scrollHeight > clientHeight + 1
        };
      })
      .filter(candidate => candidate.row_count > 0);
    const selected = measurements.find(candidate => candidate.can_scroll) || measurements[0];
    if (!selected) {
      return {
        found: false,
        reason: `No container held rows for ${rowSel}`
      };
    }
    selected.container.scrollTop = 0;
    selected.container.scrollTo(0, selected.container.scrollHeight);
    const bottomTop = Number(selected.container.scrollTop.toFixed(2));
    const maxScrollTop = Math.max(0, selected.scroll_height - selected.client_height);
    const reachedBottom = selected.can_scroll ? Math.abs(bottomTop - maxScrollTop) <= 1 : true;
    selected.container.scrollTo(0, 0);
    const returnedTop = Number(selected.container.scrollTop.toFixed(2));
    return {
      found: true,
      source: selected.source,
      row_count: selected.row_count,
      scroll_height: selected.scroll_height,
      client_height: selected.client_height,
      can_scroll: selected.can_scroll,
      reached_bottom: reachedBottom,
      returned_top: returnedTop,
      max_scroll_top: maxScrollTop
    };
  }, { rowSel: rowsSelector, preferredSelectors: preferredContainerSelectors });
}

async function readUnreadMarkerStyle(page) {
  return page.evaluate(() => {
    const marker = document.querySelector(".light-shell[data-light-route=\"inbox\"] .identity.is-unread, .light-shell[data-light-route=\"inbox\"] .action.is-unread");
    if (!(marker instanceof HTMLElement)) {
      return null;
    }
    const style = getComputedStyle(marker);
    const scratch = document.createElement("span");
    scratch.className = marker.classList.contains("identity") ? "identity is-read" : "action is-read";
    scratch.style.position = "absolute";
    scratch.style.visibility = "hidden";
    document.body.append(scratch);
    const readStyle = getComputedStyle(scratch);
    const result = {
      color: style.color,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      readColor: readStyle.color
    };
    scratch.remove();
    return result;
  });
}

async function readInboxActionLayout(page) {
  return page.evaluate(() => {
    const rect = (node) => {
      if (!(node instanceof HTMLElement || node instanceof SVGElement)) {
        return null;
      }
      const bounds = node.getBoundingClientRect();
      return {
        x: Number(bounds.x.toFixed(2)),
        y: Number(bounds.y.toFixed(2)),
        width: Number(bounds.width.toFixed(2)),
        height: Number(bounds.height.toFixed(2)),
        right: Number(bounds.right.toFixed(2)),
        bottom: Number(bounds.bottom.toFixed(2))
      };
    };
    const parseColor = (value) => {
      const match = String(value || "").match(/rgba?\(([^)]+)\)/i);
      if (!match) {
        return null;
      }
      const parts = match[1].split(",").map(part => Number.parseFloat(part.trim()));
      if (parts.length < 3 || parts.slice(0, 3).some(part => Number.isNaN(part))) {
        return null;
      }
      return {
        r: parts[0],
        g: parts[1],
        b: parts[2],
        a: parts.length >= 4 && !Number.isNaN(parts[3]) ? parts[3] : 1
      };
    };
    const luminance = (color) => {
      const channels = [color.r, color.g, color.b].map(channel => {
        const value = Math.max(0, Math.min(255, channel)) / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrastRatio = (foreground, background) => {
      if (!foreground || !background) {
        return 0;
      }
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return Number(((light + 0.05) / (dark + 0.05)).toFixed(2));
    };
    const inheritedSurfaceBackground = (node) => {
      const style = getComputedStyle(node);
      for (const token of ["--surface-card", "--surface-app"]) {
        const value = style.getPropertyValue(token).trim();
        const color = parseColor(value);
        if (color && color.a > 0.05) {
          return {
            color: value,
            source: `token:${token}`
          };
        }
      }
      return null;
    };
    const nearestPaintedBackground = (node) => {
      let current = node;
      while (current instanceof Element) {
        if (current === document.body || current === document.documentElement) {
          break;
        }
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color.a > 0.05) {
          return {
            color: getComputedStyle(current).backgroundColor,
            source: current === node ? "self" : `${current.tagName.toLowerCase()}.${String(current.className || "").trim()}`
          };
        }
        current = current.parentElement;
      }
      const surface = inheritedSurfaceBackground(node);
      if (surface) {
        return surface;
      }
      const bodyColor = parseColor(getComputedStyle(document.body).backgroundColor);
      return {
        color: bodyColor && bodyColor.a > 0.05
          ? getComputedStyle(document.body).backgroundColor
          : "rgb(255, 255, 255)",
        source: bodyColor && bodyColor.a > 0.05 ? "body" : "fallback:white"
      };
    };
    const readButton = (node) => {
      if (!(node instanceof HTMLElement)) {
        return null;
      }
      const style = getComputedStyle(node);
      const icon = node.querySelector(".material-icon");
      const iconStyle = icon ? getComputedStyle(icon) : null;
      const background = nearestPaintedBackground(node);
      const color = style.color;
      return {
        action: String(node.getAttribute("data-card-action") || ""),
        class_name: String(node.className || ""),
        aria_label: String(node.getAttribute("aria-label") || ""),
        rect: rect(node),
        color,
        icon_fill: iconStyle ? iconStyle.fill : "",
        background_color: background.color,
        background_source: background.source,
        contrast_ratio: contrastRatio(parseColor(color), parseColor(background.color))
      };
    };
    const cardTitle = (card) => String(card?.querySelector(".title")?.textContent || "").trim();
    const cardInfo = (card) => card instanceof HTMLElement
      ? {
        title: cardTitle(card),
        class_name: String(card.className || ""),
        grid_template_columns: getComputedStyle(card).gridTemplateColumns,
        rect: rect(card)
      }
      : null;
    const lightCards = Array.from(document.querySelectorAll(".light-shell[data-light-route=\"inbox\"] .card-wrap article.card"));
    const unreadPageAction = document.querySelector(
      ".light-shell[data-light-route=\"inbox\"] article.card .action.is-unread[data-card-action=\"page\"], " +
      ".light-shell[data-light-route=\"inbox\"] article.card .action.is-unread[data-card-action=\"attachment\"]"
    );
    const twoActionCard = unreadPageAction?.closest("article.card") || lightCards.find(card =>
      card.querySelector("[data-card-action=\"audio\"]")
        && card.querySelector("[data-card-action=\"page\"], [data-card-action=\"attachment\"]")
    );
    const audioOnlyCard = lightCards.find(card =>
      card.querySelector("[data-card-action=\"audio\"]")
        && !card.querySelector("[data-card-action=\"page\"], [data-card-action=\"attachment\"]")
    );
    const audioOnlyActions = audioOnlyCard?.querySelector(".card-actions");
    const audioOnlyAudio = audioOnlyCard?.querySelector("[data-card-action=\"audio\"]");
    const audioOnlyActionRect = rect(audioOnlyActions);
    const audioOnlyAudioRect = rect(audioOnlyAudio);
    return {
      unread_page_action: readButton(unreadPageAction),
      two_action_card: cardInfo(twoActionCard),
      two_action_audio: readButton(twoActionCard?.querySelector("[data-card-action=\"audio\"]")),
      two_action_attachment: readButton(twoActionCard?.querySelector("[data-card-action=\"page\"], [data-card-action=\"attachment\"]")),
      audio_only_card: cardInfo(audioOnlyCard),
      audio_only_actions: {
        class_name: String(audioOnlyActions?.className || ""),
        rect: audioOnlyActionRect
      },
      audio_only_audio: readButton(audioOnlyAudio),
      audio_only_mic_right_aligned: Boolean(audioOnlyActionRect && audioOnlyAudioRect && Math.abs(audioOnlyActionRect.right - audioOnlyAudioRect.right) <= 1),
      audio_only_action_width_px: audioOnlyActionRect ? audioOnlyActionRect.width : 0
    };
  });
}

async function readInboxManagementState(page) {
  return page.evaluate(() => {
    const rect = (node) => {
      if (!(node instanceof HTMLElement)) {
        return null;
      }
      const bounds = node.getBoundingClientRect();
      return {
        x: Number(bounds.x.toFixed(2)),
        y: Number(bounds.y.toFixed(2)),
        width: Number(bounds.width.toFixed(2)),
        height: Number(bounds.height.toFixed(2)),
        right: Number(bounds.right.toFixed(2)),
        bottom: Number(bounds.bottom.toFixed(2))
      };
    };
    const readButtonStyles = (node) => {
      if (!(node instanceof HTMLElement)) {
        return null;
      }
      const style = getComputedStyle(node);
      const paths = Array.from(node.querySelectorAll("path"));
      const icon = node.querySelector(".material-icon");
      const iconStyle = icon instanceof Element ? getComputedStyle(icon) : null;
      const firstPathStyle = paths[0] instanceof Element ? getComputedStyle(paths[0]) : null;
      return {
        rect: rect(node),
        background_color: style.backgroundColor,
        color: style.color,
        border_color: style.borderColor,
        icon_fill: firstPathStyle?.fill || iconStyle?.fill || "",
        icon_stroke: firstPathStyle?.stroke || iconStyle?.stroke || "",
        icon_path_count: paths.length,
        icon_paths: paths.map(path => String(path.getAttribute("d") || "")),
        aria_pressed: String(node.getAttribute("aria-pressed") || ""),
        class_name: String(node.className || "")
      };
    };
    const appShell = document.querySelector(".app-shell");
    const feed = document.getElementById("feed");
    const shell = document.querySelector(".light-shell[data-light-route=\"inbox\"]");
    const overlay = document.getElementById("inboxManageOverlay");
    const wraps = Array.from(shell?.querySelectorAll(".card-wrap") || []);
    const healthyNoMenuWrap = wraps.find(wrap =>
      wrap.querySelector("article.card[data-card-id]")
        && !wrap.classList.contains("has-inbox-menu")
        && !wrap.querySelector("[data-card-action=\"manage_menu\"]")
        && !wrap.querySelector("article.card-meeting-processing")
    );
    const firstManageable = healthyNoMenuWrap || wraps.find(wrap => wrap.querySelector("article.card[data-card-id]"));
    const firstArticle = firstManageable?.querySelector("article.card");
    const normalMenuButton = firstManageable?.querySelector("[data-card-action=\"manage_menu\"]");
    const selectButton = firstManageable?.querySelector("[data-card-action=\"manage_select\"]");
    const manageBar = appShell?.querySelector(".inbox-manage-bar") || shell?.querySelector(".inbox-manage-bar");
    const selectedCount = Number(manageBar?.getAttribute("data-inbox-manage-selected-count") || 0);
    const selectedButton = shell?.querySelector("[data-card-action=\"manage_select\"][aria-pressed=\"true\"]");
    const archiveToggle = shell?.querySelector(".inbox-archive-toggle");
    const manageToggle = shell?.querySelector(".inbox-manage-toggle");
    const loadingNotice = shell?.querySelector(".inbox-archive-loading-notice");
    const openMenu = shell?.querySelector(".inbox-card-menu");
    const processingCards = wraps
      .map(wrap => {
        const article = wrap.querySelector("article.card-meeting-processing[data-card-id]");
        if (!article) {
          return null;
        }
        const menuButton = wrap.querySelector("[data-card-action=\"manage_menu\"]");
        const selectControl = wrap.querySelector("[data-card-action=\"manage_select\"]");
        return {
          card_id: String(article.getAttribute("data-card-id") || "").trim(),
          session_id: String(article.getAttribute("data-card-session-id") || "").trim(),
          wrap_class: String(wrap.className || ""),
          article_rect: rect(article),
          menu_button: readButtonStyles(menuButton),
          select_control: readButtonStyles(selectControl),
          has_menu_button: Boolean(menuButton),
          menu_visible: Boolean(menuButton instanceof HTMLElement && getComputedStyle(menuButton).display !== "none" && menuButton.getBoundingClientRect().width > 0 && menuButton.getBoundingClientRect().height > 0),
          has_select_control: Boolean(selectControl),
          select_visible: Boolean(selectControl instanceof HTMLElement && getComputedStyle(selectControl).display !== "none" && selectControl.getBoundingClientRect().width > 0 && selectControl.getBoundingClientRect().height > 0)
        };
      })
      .filter(Boolean);
    const viewport = {
      width: Number(window.innerWidth.toFixed(2)),
      height: Number(window.innerHeight.toFixed(2))
    };
    const normalMenuRect = rect(normalMenuButton);
    const firstArticleRect = rect(firstArticle);
    const selectRect = rect(selectButton);
    const manageBarRect = rect(manageBar);
    const healthyNoMenuArticle = healthyNoMenuWrap?.querySelector("article.card");
    const expectedManageBarWidth = Math.min(window.innerWidth - 28, 480);
    const firstActionsRect = rect(firstArticle?.querySelector(".card-actions"));
    const firstAudioRect = rect(firstArticle?.querySelector("[data-card-action=\"audio\"]"));
    const firstPageRect = rect(firstArticle?.querySelector("[data-card-action=\"page\"], [data-card-action=\"attachment\"]"));
    const firstTimestamp = firstArticle?.querySelector(".card-timestamp");
    const firstTimestampRect = rect(firstTimestamp);
    const timestampStyle = firstTimestamp instanceof HTMLElement ? getComputedStyle(firstTimestamp) : null;
    const timestampPaddingRight = timestampStyle ? Number.parseFloat(timestampStyle.paddingRight || "0") || 0 : null;
    const timestampOverlapsActions = Boolean(firstTimestampRect && firstActionsRect && !(
      firstTimestampRect.right <= firstActionsRect.x
        || firstTimestampRect.x >= firstActionsRect.right
        || firstTimestampRect.bottom <= firstActionsRect.y
        || firstTimestampRect.y >= firstActionsRect.bottom
    ));
    const cardWidthTarget = Math.min(720, Math.max(0, window.innerWidth - 52));
    return {
      manage_button_visible: Boolean(manageToggle),
      manage_button_label: String(manageToggle?.textContent || manageToggle?.getAttribute("aria-label") || "").trim(),
      manage_button_aria_label: String(manageToggle?.getAttribute("aria-label") || "").trim(),
      manage_button_is_circle: Boolean(manageToggle?.classList.contains("light-circle-button")),
      archive_toggle_visible: Boolean(archiveToggle),
      archive_toggle_pressed: archiveToggle?.getAttribute("aria-pressed") === "true",
      archive_toggle_label: String(archiveToggle?.textContent || archiveToggle?.getAttribute("aria-label") || "").trim(),
      archive_toggle_aria_label: String(archiveToggle?.getAttribute("aria-label") || "").trim(),
      archive_toggle_busy: archiveToggle?.getAttribute("aria-busy") === "true",
      archive_toggle_disabled: Boolean(archiveToggle?.disabled),
      archive_toggle_pending_target: String(archiveToggle?.getAttribute("data-pending-target") || ""),
      archive_toggle_is_circle: Boolean(archiveToggle?.classList.contains("light-circle-button")),
      archive_loading_notice_text: String(loadingNotice?.textContent || "").trim(),
      archive_loading_shell_active: Boolean(appShell?.classList.contains("is-inbox-archive-filter-loading")),
      manage_mode_active: Boolean(manageBar),
      selected_count: selectedCount,
      selected_button_count: shell?.querySelectorAll("[data-card-action=\"manage_select\"][aria-pressed=\"true\"]").length || 0,
      menu_button_count: shell?.querySelectorAll("[data-card-action=\"manage_menu\"]").length || 0,
      visible_menu_button_count: Array.from(shell?.querySelectorAll("[data-card-action=\"manage_menu\"]") || [])
        .filter(node => node instanceof HTMLElement && getComputedStyle(node).display !== "none" && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0).length,
      select_control_count: shell?.querySelectorAll("[data-card-action=\"manage_select\"]").length || 0,
      menu_open: Boolean(openMenu),
      menu_actions: Array.from(openMenu?.querySelectorAll(".inbox-card-menu-item") || [])
        .map(node => String(node.getAttribute("data-card-menu-action") || "").trim())
        .filter(Boolean),
      processing_card_count: processingCards.length,
      processing_cards: processingCards,
      archive_reveal_count: shell?.querySelectorAll(".archive-reveal-action").length || 0,
      visible_card_count: shell?.querySelectorAll(".card-wrap article.card").length || 0,
      selected_card_ids: Array.from(shell?.querySelectorAll(".card-wrap.is-inbox-manage-selected article.card[data-card-id]") || [])
        .map(card => String(card.getAttribute("data-card-id") || "").trim())
        .filter(Boolean),
      healthy_no_menu_card: healthyNoMenuArticle ? {
        card_id: String(healthyNoMenuArticle.getAttribute("data-card-id") || "").trim(),
        session_id: String(healthyNoMenuArticle.getAttribute("data-card-session-id") || "").trim(),
        title: String(healthyNoMenuArticle.querySelector(".title")?.textContent || "").trim(),
        rect: rect(healthyNoMenuArticle),
        has_menu_button: Boolean(healthyNoMenuWrap.querySelector("[data-card-action=\"manage_menu\"]")),
        has_select_control: Boolean(healthyNoMenuWrap.querySelector("[data-card-action=\"manage_select\"]")),
        wrap_class: String(healthyNoMenuWrap.className || "")
      } : null,
      first_card: firstArticle ? {
        card_id: String(firstArticle.getAttribute("data-card-id") || "").trim(),
        session_id: String(firstArticle.getAttribute("data-card-session-id") || "").trim(),
        title: String(firstArticle.querySelector(".title")?.textContent || "").trim(),
        rect: rect(firstArticle)
      } : null,
      layout: {
        viewport,
        normal_menu: {
          button_rect: normalMenuRect,
          article_rect: firstArticleRect,
          center_delta: normalMenuRect && firstArticleRect
            ? Number(((normalMenuRect.y + (normalMenuRect.height / 2)) - (firstArticleRect.y + (firstArticleRect.height / 2))).toFixed(2))
            : null,
          left_rail_bounds: firstArticleRect ? {
            left: Number((firstArticleRect.x + 4).toFixed(2)),
            right: Number((firstArticleRect.x + 48).toFixed(2))
          } : null,
          action_column_rect: firstActionsRect,
          audio_rect: firstAudioRect,
          page_rect: firstPageRect
        },
        feed_width: {
          card_rect: firstArticleRect,
          card_width_target: Number(cardWidthTarget.toFixed(2)),
          card_left_gap: firstArticleRect ? Number(firstArticleRect.x.toFixed(2)) : null,
          card_right_gap: firstArticleRect ? Number((window.innerWidth - firstArticleRect.right).toFixed(2)) : null
        },
        timestamp_alignment: {
          rect: firstTimestampRect,
          text_align: timestampStyle?.textAlign || "",
          padding_right_px: timestampPaddingRight,
          timestamp_right_gap_from_card: firstArticleRect && firstTimestampRect
            ? Number((firstArticleRect.right - firstTimestampRect.right).toFixed(2))
            : null,
          overlaps_actions: timestampOverlapsActions
        },
        manage_bar: {
          rect: manageBarRect,
          viewport,
          bottom_gap: manageBarRect ? Number((window.innerHeight - manageBarRect.bottom).toFixed(2)) : null,
          expected_width: Number(expectedManageBarWidth.toFixed(2)),
          safe_area_value: getComputedStyle(document.documentElement).getPropertyValue("safe-area-inset-bottom") || "",
          selected_count: selectedCount,
          feed_contains_manage_bar: Boolean(feed && manageBar && feed.contains(manageBar)),
          overlay_direct_child: Boolean(overlay && overlay.parentElement === appShell)
        },
        selected_control: {
          button_rect: selectRect,
          selected_button: readButtonStyles(selectedButton),
          visible_button: readButtonStyles(selectButton),
          selected_count: selectedCount,
          checklist_glyph_present: Boolean(selectedButton?.querySelector("path[d*=\"M19.5 4.5\"]"))
        },
        archive_filter: {
          pressed: archiveToggle?.getAttribute("aria-pressed") === "true",
          label: String(archiveToggle?.textContent || archiveToggle?.getAttribute("aria-label") || "").trim(),
          aria_label: String(archiveToggle?.getAttribute("aria-label") || "").trim(),
          busy: archiveToggle?.getAttribute("aria-busy") === "true",
          disabled: Boolean(archiveToggle?.disabled),
          pending_target: String(archiveToggle?.getAttribute("data-pending-target") || ""),
          loading_notice_text: String(loadingNotice?.textContent || "").trim(),
          shell_loading: Boolean(appShell?.classList.contains("is-inbox-archive-filter-loading")),
          visible_card_count: shell?.querySelectorAll(".card-wrap article.card").length || 0
        },
        healthy_no_menu: healthyNoMenuArticle ? {
          card_id: String(healthyNoMenuArticle.getAttribute("data-card-id") || "").trim(),
          title: String(healthyNoMenuArticle.querySelector(".title")?.textContent || "").trim(),
          rect: rect(healthyNoMenuArticle),
          has_menu_button: Boolean(healthyNoMenuWrap.querySelector("[data-card-action=\"manage_menu\"]")),
          wrap_class: String(healthyNoMenuWrap.className || "")
        } : null,
        processing_escape_hatch: {
          count: processingCards.length,
          cards: processingCards
        }
      }
    };
  });
}

function assertInboxManagementLayout(state, phase) {
  assert(state, `Missing Inbox management state for ${phase}`);
  assert(state.archive_reveal_count === 0, `${phase}: Inbox should not expose swipe-only archive reveal actions`);
  if (phase === "normal") {
    const menu = state.layout?.normal_menu || {};
    const healthyNoMenu = state.layout?.healthy_no_menu || {};
    const feedWidth = state.layout?.feed_width || {};
    const timestamp = state.layout?.timestamp_alignment || {};
    assert(state.archive_toggle_visible, "Normal Inbox should render an archive filter control");
    assert(state.manage_button_visible, "Normal Inbox should render a Manage control");
    assert(state.archive_toggle_is_circle === false, "Archive filter should be a labeled pill, not an icon-only circle");
    assert(state.manage_button_is_circle === false, "Manage control should be a labeled pill, not an icon-only circle");
    assert(["Active", "Archived"].includes(state.archive_toggle_label), `Archive filter should show a visible Active/Archived label, got ${state.archive_toggle_label}`);
    assert(["Manage", "Done"].includes(state.manage_button_label), `Manage control should show a visible Manage/Done label, got ${state.manage_button_label}`);
    assert(healthyNoMenu.card_id && healthyNoMenu.has_menu_button === false, "Normal healthy Inbox cards should not render per-tile dots");
    assert(menu.button_rect === null || menu.button_rect === undefined, "First healthy Inbox tile should not expose a menu button");
    assert(menu.article_rect, "Normal Inbox did not expose a measurable tile article");
    assert(feedWidth.card_rect, "Normal Inbox did not expose a measurable feed-width card");
    assert(Math.abs(Number(feedWidth.card_rect.width || 0) - Number(feedWidth.card_width_target || 0)) <= 2, `Inbox card width ${feedWidth.card_rect.width} should match target ${feedWidth.card_width_target}`);
    if (Number(state.layout?.viewport?.width || 0) <= 430) {
      assert(feedWidth.card_left_gap >= 20 && feedWidth.card_left_gap <= 30, `Phone Inbox card left gap should be 20-30px, got ${feedWidth.card_left_gap}`);
      assert(feedWidth.card_right_gap >= 20 && feedWidth.card_right_gap <= 30, `Phone Inbox card right gap should be 20-30px, got ${feedWidth.card_right_gap}`);
    }
    assert(["right", "end"].includes(String(timestamp.text_align || "").trim()), `Inbox timestamp should be right-aligned, got ${timestamp.text_align}`);
    assert(Number(timestamp.padding_right_px || 0) <= 4, `Inbox timestamp padding-right should be <= 4px, got ${timestamp.padding_right_px}`);
    assert(Number(timestamp.timestamp_right_gap_from_card || 0) <= 12, `Inbox timestamp right gap from card should be <= 12px, got ${timestamp.timestamp_right_gap_from_card}`);
    assert(timestamp.overlaps_actions === false, "Inbox timestamp should not overlap mic/paperclip actions");
    assert(!state.archive_toggle_busy, "Archive filter should not start busy in the normal state");
    assert(state.processing_card_count > 0, "Inbox proof should include a processing/exception card with an escape menu");
    for (const processing of state.processing_cards || []) {
      assert(processing.has_menu_button, `Processing meeting card ${processing.card_id} should expose a left-rail menu button`);
      assert(processing.menu_visible, `Processing meeting card ${processing.card_id} left-rail menu button should be visible`);
      const menuRect = processing.menu_button?.rect || null;
      const articleRect = processing.article_rect || null;
      if (menuRect && articleRect) {
        const centerDelta = (menuRect.y + (menuRect.height / 2)) - (articleRect.y + (articleRect.height / 2));
        assert(Math.abs(centerDelta) <= 2, `Processing meeting menu should be vertically centered, delta ${centerDelta}`);
        assert(menuRect.x >= articleRect.x + 4, `Processing meeting menu left ${menuRect.x} should sit inside left rail`);
        assert(menuRect.right <= articleRect.x + 48, `Processing meeting menu right ${menuRect.right} should stay inside left rail`);
      }
    }
  }
  if (phase === "manage") {
    const bar = state.layout?.manage_bar || {};
    assert(state.manage_mode_active, "Manage mode should be active");
    assert(state.visible_menu_button_count === 0, `Manage mode should replace menu buttons with select controls, saw ${state.visible_menu_button_count}`);
    assert(state.select_control_count > 0, "Manage mode should render select controls");
    assert(bar.rect, "Manage mode did not expose a measurable bottom bar");
    assert(bar.feed_contains_manage_bar === false, "Manage bar should render outside the scrollable feed");
    assert(bar.overlay_direct_child === true, "Manage bar overlay should be a direct app-shell child");
    assert(bar.bottom_gap >= 0 && bar.bottom_gap <= 4, `Manage bar bottom gap should be 0-4px, got ${bar.bottom_gap}`);
    assert(Math.abs(Number(bar.rect.width || 0) - Number(bar.expected_width || 0)) <= 2, `Manage bar width ${bar.rect.width} did not match expected ${bar.expected_width}`);
    const selectRect = state.layout?.selected_control?.button_rect;
    const articleRect = state.first_card?.rect;
    if (selectRect && articleRect) {
      const selectCenter = selectRect.y + (selectRect.height / 2);
      const articleCenter = articleRect.y + (articleRect.height / 2);
      assert(Math.abs(selectCenter - articleCenter) <= 2, `Manage select control should be vertically centered, delta ${selectCenter - articleCenter}`);
    }
    for (const processing of state.processing_cards || []) {
      assert(!processing.has_menu_button, `Processing meeting card ${processing.card_id} should replace menu with select in Manage mode`);
      assert(processing.has_select_control, `Processing meeting card ${processing.card_id} should expose Manage select control`);
      assert(processing.select_visible, `Processing meeting card ${processing.card_id} Manage select control should be visible`);
      const selectControlRect = processing.select_control?.rect || null;
      const articleRect = processing.article_rect || null;
      if (selectControlRect && articleRect) {
        const centerDelta = (selectControlRect.y + (selectControlRect.height / 2)) - (articleRect.y + (articleRect.height / 2));
        assert(Math.abs(centerDelta) <= 2, `Processing meeting select should be vertically centered, delta ${centerDelta}`);
      }
    }
  }
  if (phase === "selected") {
    const selected = state.layout?.selected_control?.selected_button || {};
    assert(state.selected_count === 1, `Selected count should be 1, got ${state.selected_count}`);
    assert(state.selected_button_count === 1, `Exactly one select button should be pressed, got ${state.selected_button_count}`);
    assert(Array.isArray(state.selected_card_ids) && state.selected_card_ids.length === 1, "Selected tile should expose selected styling");
    assert(selected.background_color && selected.background_color !== "rgba(0, 0, 0, 0)", "Selected select button should have an active blue background");
    assert(selected.icon_path_count === 1, `Selected icon should be one simple check path, got ${selected.icon_path_count}`);
    assert(!state.layout?.selected_control?.checklist_glyph_present, "Selected control should not use the filled checklist glyph");
    assert(!/rgb\(0,\s*0,\s*0\)|#000/i.test(`${selected.icon_fill} ${selected.icon_stroke}`), "Selected check icon should not render black");
  }
}

async function setInboxFeedScrollTop(page, scrollTop, timeoutMs) {
  await page.evaluate(value => {
    const feed = document.querySelector("section.feed");
    if (feed instanceof HTMLElement) {
      feed.scrollTop = Math.max(0, Number(value) || 0);
    }
  }, scrollTop);
  await page.waitForFunction(
    expected => {
      const feed = document.querySelector("section.feed");
      if (!(feed instanceof HTMLElement)) {
        return false;
      }
      return Math.abs(feed.scrollTop - Number(expected || 0)) <= 2;
    },
    scrollTop,
    { timeout: timeoutMs }
  );
}

async function assertInboxManageBarScrollStickiness(page, timeoutMs, reportDir) {
  const top = await readInboxManagementState(page);
  assertInboxManagementLayout(top, "manage");
  const topScreenshot = await saveScreenshot(page, reportDir, "02-manage-bottom-top");
  const scrollTarget = await page.evaluate(() => {
    const feed = document.querySelector("section.feed");
    if (!(feed instanceof HTMLElement)) {
      return 0;
    }
    return Math.min(1200, Math.max(0, feed.scrollHeight - feed.clientHeight));
  });
  await setInboxFeedScrollTop(page, scrollTarget, timeoutMs);
  const scrolledDown = await readInboxManagementState(page);
  assertInboxManagementLayout(scrolledDown, "manage");
  const downScreenshot = await saveScreenshot(page, reportDir, "03-manage-bottom-scrolled-down");
  await setInboxFeedScrollTop(page, 0, timeoutMs);
  const scrolledUp = await readInboxManagementState(page);
  assertInboxManagementLayout(scrolledUp, "manage");
  const upScreenshot = await saveScreenshot(page, reportDir, "04-manage-bottom-scrolled-up");
  const topBar = top.layout?.manage_bar?.rect || {};
  const downBar = scrolledDown.layout?.manage_bar?.rect || {};
  const upBar = scrolledUp.layout?.manage_bar?.rect || {};
  assert(Math.abs(Number(downBar.y || 0) - Number(topBar.y || 0)) <= 2, `Manage bar y should stay fixed after scrolling down, top ${topBar.y}, down ${downBar.y}`);
  assert(Math.abs(Number(downBar.bottom || 0) - Number(topBar.bottom || 0)) <= 2, `Manage bar bottom should stay fixed after scrolling down, top ${topBar.bottom}, down ${downBar.bottom}`);
  assert(Math.abs(Number(upBar.y || 0) - Number(topBar.y || 0)) <= 2, `Manage bar y should restore after scrolling up, top ${topBar.y}, up ${upBar.y}`);
  assert(Math.abs(Number(upBar.bottom || 0) - Number(topBar.bottom || 0)) <= 2, `Manage bar bottom should restore after scrolling up, top ${topBar.bottom}, up ${upBar.bottom}`);
  assert(scrolledDown.layout?.manage_bar?.bottom_gap >= 0 && scrolledDown.layout?.manage_bar?.bottom_gap <= 4, `Manage bar bottom gap should stay 0-4px after scrolling down, got ${scrolledDown.layout?.manage_bar?.bottom_gap}`);
  assert(scrolledUp.layout?.manage_bar?.bottom_gap >= 0 && scrolledUp.layout?.manage_bar?.bottom_gap <= 4, `Manage bar bottom gap should stay 0-4px after scrolling up, got ${scrolledUp.layout?.manage_bar?.bottom_gap}`);
  return {
    top,
    scrolled_down: scrolledDown,
    scrolled_up: scrolledUp,
    scroll_target: scrollTarget,
    screenshots: {
      top: topScreenshot,
      scrolled_down: downScreenshot,
      scrolled_up: upScreenshot
    }
  };
}

async function installInboxManagementActionInterceptor(page, actionRequests) {
  const archivedCardIds = new Set();
  const feedRequests = [];
  const feedEmulation = {
    archivedCardIds,
    feedRequests,
    delayNextFeedMs: 0
  };
  await page.route(/\/api\/feed(?:\?.*)?$/, async route => {
    try {
      const request = route.request();
      if (request.method() !== "GET") {
        await route.continue();
        return;
      }
      const delayMs = Math.max(0, Number(feedEmulation.delayNextFeedMs || 0) || 0);
      if (delayMs) {
        feedEmulation.delayNextFeedMs = 0;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      const response = await route.fetch();
      const headers = await response.headers();
      const bodyText = await response.text();
      const url = new URL(request.url());
      feedRequests.push({
        url: request.url(),
        include_archived: String(url.searchParams.get("include_archived") || "")
      });
      let payload = null;
      try {
        payload = JSON.parse(bodyText);
      } catch (_error) {
        payload = null;
      }
      if (!payload || !Array.isArray(payload.items)) {
        await route.fulfill({
          status: response.status(),
          headers,
          body: bodyText
        });
        return;
      }
      const includeArchived = /^(1|true|yes)$/i.test(String(url.searchParams.get("include_archived") || ""));
      const proofItems = withInboxManagementProcessingProofCard(payload.items);
      const nextItems = proofItems
        .map(item => {
          const cardId = String(item?.card_id || "").trim();
          if (cardId && feedEmulation.archivedCardIds.has(cardId)) {
            return { ...item, archived: true };
          }
          return item;
        })
        .filter(item => {
          const cardId = String(item?.card_id || "").trim();
          return includeArchived || !cardId || !feedEmulation.archivedCardIds.has(cardId);
        });
      const responseHeaders = {
        ...headers,
        "content-type": "application/json"
      };
      delete responseHeaders["content-length"];
      delete responseHeaders["content-encoding"];
      await route.fulfill({
        status: response.status(),
        headers: responseHeaders,
        body: JSON.stringify({ ...payload, items: nextItems })
      });
    } catch (error) {
      if (await abortRouteIfDisposed(route, error)) {
        return;
      }
      throw error;
    }
  });
  await page.route("**/api/feed/actions", async route => {
    try {
      let payload = {};
      try {
        payload = route.request().postDataJSON();
      } catch (_error) {
        try {
          payload = JSON.parse(route.request().postData() || "{}");
        } catch (_jsonError) {
          payload = {};
        }
      }
      actionRequests.push({
        url: route.request().url(),
        method: route.request().method(),
        payload
      });
      const cardId = String(payload?.card_id || "").trim();
      const action = String(payload?.action || "").trim();
      if (cardId && action === "archive") {
        feedEmulation.archivedCardIds.add(cardId);
      } else if (cardId && action === "unarchive") {
        feedEmulation.archivedCardIds.delete(cardId);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schema: "pucky.feed_action.v1",
          ok: true,
          client_action_id: String(payload?.client_action_id || ""),
          action: String(payload?.action || ""),
          item: {
            card_id: String(payload?.card_id || ""),
            archived: String(payload?.action || "") === "archive"
          }
        })
      });
    } catch (error) {
      if (await abortRouteIfDisposed(route, error)) {
        return;
      }
      throw error;
    }
  });
  return feedEmulation;
}

async function reloadLightInbox(page, timeoutMs) {
  const url = new URL(page.url());
  url.searchParams.set("theme", "light");
  url.searchParams.set("route", "inbox");
  url.searchParams.set("reset_nav", "1");
  url.searchParams.set("proof_refresh", String(Date.now()));
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForLightRoute(page, "inbox", ".card-wrap article.card", timeoutMs);
}

async function exerciseInboxManagement(page, timeoutMs, reportDir, options = {}) {
  const noAudioGuard = options.noAudioGuard || null;
  const actionRequests = [];
  const feedEmulation = await installInboxManagementActionInterceptor(page, actionRequests);
  await reloadLightInbox(page, timeoutMs);
  const before = await readInboxManagementState(page);
  assert(before.manage_button_visible, "Light Inbox should render a visible Manage control");
  assert(before.archive_toggle_visible, "Light Inbox should render a visible archived-feed toggle");
  assertInboxManagementLayout(before, "normal");
  assert(before.first_card?.card_id || before.first_card?.session_id, "Inbox management proof could not find a manageable card");
  const targetCardId = before.first_card.card_id;
  assert(targetCardId, "Inbox management archive proof requires a card_id");
  assert(before.healthy_no_menu_card?.card_id === targetCardId, "Inbox management proof should target a normal healthy no-menu card for Manage archive");
  const processingCardId = String(before.processing_cards?.[0]?.card_id || "").trim();
  assert(processingCardId, "Inbox management proof requires a processing/exception card escape hatch");
  const normalScreenshot = await saveScreenshot(page, reportDir, "01-normal-expanded-feed");

  await openInboxTileMenu(page, processingCardId, timeoutMs, "Open processing Inbox tile escape menu");
  const menuOpen = await readInboxManagementState(page);
  assert(menuOpen.menu_open, "Inbox processing escape menu did not open");
  assert(menuOpen.menu_actions.includes("archive"), "Inbox processing escape menu did not expose Archive");
  assert(menuOpen.menu_actions.includes("open_transcript"), "Inbox processing escape menu did not expose Open transcript");
  assert(!menuOpen.menu_actions.includes("delete"), "Inbox processing escape menu must not expose Delete");
  const processingMenuScreenshot = await saveScreenshot(page, reportDir, "01b-processing-escape-menu");
  await clickLocator(page, inboxCardWrap(page, processingCardId).locator(INBOX_MANAGE_MENU_SELECTOR).first(), timeoutMs, "Close processing Inbox tile escape menu");

  await clickLocator(page, page.locator(".light-shell[data-light-route=\"inbox\"] .inbox-manage-toggle").first(), timeoutMs, "Enter Inbox Manage mode");
  await page.waitForFunction(
    () => Boolean(document.querySelector(".app-shell[data-canonical-route=\"inbox\"] .inbox-manage-bar")),
    undefined,
    { timeout: timeoutMs }
  );
  const manageMode = await readInboxManagementState(page);
  assertInboxManagementLayout(manageMode, "manage");
  const manageBarScroll = await assertInboxManageBarScrollStickiness(page, timeoutMs, reportDir);
  await clickLocator(page, inboxCardWrap(page, targetCardId).locator(INBOX_MANAGE_SELECT_SELECTOR).first(), timeoutMs, "Select Inbox tile");
  await page.waitForFunction(
    () => {
      const bar = document.querySelector(".app-shell[data-canonical-route=\"inbox\"] .inbox-manage-bar");
      return Number(bar?.getAttribute("data-inbox-manage-selected-count") || 0) === 1;
    },
    undefined,
    { timeout: timeoutMs }
  );
  const afterSelect = await readInboxManagementState(page);
  assertInboxManagementLayout(afterSelect, "selected");
  const selectedScreenshot = await saveScreenshot(page, reportDir, "05-selected-simple-check");

  await clickLocator(page, page.locator(INBOX_MANAGE_PRIMARY_ACTION_SELECTOR).first(), timeoutMs, "Archive selected Inbox tile");
  await page.waitForFunction(
    () => {
      const bar = document.querySelector(".app-shell[data-canonical-route=\"inbox\"] .inbox-manage-bar");
      return Number(bar?.getAttribute("data-inbox-manage-selected-count") || 0) === 0;
    },
    undefined,
    { timeout: timeoutMs }
  );
  await page.waitForFunction(
    expectedCardId => {
      const cards = Array.from(document.querySelectorAll(".light-shell[data-light-route=\"inbox\"] article.card"));
      return cards.every(card => String(card.getAttribute("data-card-id") || "").trim() !== expectedCardId);
    },
    targetCardId,
    { timeout: timeoutMs }
  );
  const afterArchive = await readInboxManagementState(page);
  assert(actionRequests.some(item => item.payload?.action === "archive" && item.payload?.card_id === targetCardId), "Inbox Manage archive did not issue the expected feed action payload");
  assert(afterArchive.visible_card_count === Math.max(0, before.visible_card_count - 1), "Archived Inbox tile should disappear from the active Inbox view");
  const afterArchiveScreenshot = await saveScreenshot(page, reportDir, "06-after-archive-active-feed");

  if (afterArchive.manage_mode_active) {
    await clickLocator(page, page.locator(".light-shell[data-light-route=\"inbox\"] .inbox-manage-toggle").first(), timeoutMs, "Exit Inbox Manage mode");
    await page.waitForFunction(
      () => !document.querySelector(".app-shell[data-canonical-route=\"inbox\"] .inbox-manage-bar"),
      undefined,
      { timeout: timeoutMs }
    );
  }
  const archivedLoading = await exerciseInboxArchiveFilterLoading(page, feedEmulation, true, timeoutMs, reportDir);
  await page.waitForFunction(
    expectedCardId => Array.from(document.querySelectorAll(".light-shell[data-light-route=\"inbox\"] article.card"))
      .some(card => String(card.getAttribute("data-card-id") || "").trim() === expectedCardId),
    targetCardId,
    { timeout: timeoutMs }
  );
  const archiveFilter = archivedLoading.loaded;
  assert(archiveFilter.archive_toggle_pressed, "Archive filter should be active after toggling archived Inbox");
  assert(!archiveFilter.archive_toggle_busy, "Archive filter should clear busy state after archived Inbox loads");
  const archiveFilterScreenshot = await saveScreenshot(page, reportDir, "07-archive-filter-card-visible");

  await openInboxTileMenu(page, targetCardId, timeoutMs, "Open archived Inbox tile menu");
  const archivedMenu = await readInboxManagementState(page);
  assert(archivedMenu.menu_actions.includes("unarchive"), "Archived Inbox tile menu should expose Unarchive");
  assert(!archivedMenu.menu_actions.includes("delete"), "Archived Inbox tile menu must not expose Delete");
  const archivedMenuScreenshot = await saveScreenshot(page, reportDir, "08-archived-menu-unarchive");

  feedEmulation.archivedCardIds.clear();
  await reloadLightInbox(page, timeoutMs);
  const restored = await readInboxManagementState(page);
  assert(restored.visible_card_count >= before.visible_card_count, "Inbox reload after intercepted archive should restore the active card list");
  const noAudio = noAudioGuard ? assertNoUnexpectedAudio(noAudioGuard, "Inbox management intercepted proof") : null;
  return {
    layout: {
      normal_menu: before.layout?.normal_menu || null,
      feed_width: before.layout?.feed_width || null,
      timestamp_alignment: before.layout?.timestamp_alignment || null,
      processing_escape_hatch: before.layout?.processing_escape_hatch || null,
      healthy_no_menu: before.layout?.healthy_no_menu || null,
      manage_bar: manageMode.layout?.manage_bar || null,
      manage_bar_scroll: manageBarScroll,
      selected_control: afterSelect.layout?.selected_control || null,
      archive_filter: archiveFilter.layout?.archive_filter || null,
      archive_filter_loading: archivedLoading.loading?.layout?.archive_filter || null
    },
    before,
    menu_open: menuOpen,
    manage_mode: manageMode,
    after_select: afterSelect,
    after_archive: afterArchive,
    archive_filter: archiveFilter,
    archive_filter_loading: archivedLoading,
    archived_menu: archivedMenu,
    restored,
    archive: {
      intercepted: {
        request_payloads: actionRequests.map(item => item.payload),
        active_count_before: before.visible_card_count,
        active_count_after: afterArchive.visible_card_count,
        archived_filter_visibility: {
          card_id: targetCardId,
          visible: true,
          visible_card_count: archiveFilter.visible_card_count
        }
      }
    },
    action_requests: actionRequests,
    feed_requests: feedEmulation.feedRequests,
    no_audio: noAudio,
    screenshots: {
      normal_menu: normalScreenshot,
      menu: normalScreenshot,
      processing_escape_menu: processingMenuScreenshot,
      manage_bar: manageBarScroll.screenshots.top,
      manage_bar_scrolled_down: manageBarScroll.screenshots.scrolled_down,
      manage_bar_scrolled_up: manageBarScroll.screenshots.scrolled_up,
      selected: selectedScreenshot,
      after_archive_active_feed: afterArchiveScreenshot,
      archive_filter_loading: archivedLoading.screenshot,
      archived: afterArchiveScreenshot,
      archive_filter_card_visible: archiveFilterScreenshot,
      archived_menu_unarchive: archivedMenuScreenshot
    }
  };
}

async function fetchFeedItems(baseUrl, token, includeArchived = false) {
  const url = new URL("/api/feed", `${String(baseUrl || "").replace(/\/+$/, "")}/`);
  url.searchParams.set("limit", "100");
  url.searchParams.set("compact", "1");
  url.searchParams.set("include_archived", includeArchived ? "1" : "0");
  const payload = await fetchJsonStrict(url.toString(), {
    headers: authHeaders(token)
  });
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function waitForFeedItem(baseUrl, token, matcher, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastItems = [];
  while (Date.now() < deadline) {
    lastItems = await fetchFeedItems(baseUrl, token, true);
    const item = lastItems.find(matcher);
    if (item) {
      return item;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for live proof feed item; saw ${lastItems.length} archived-inclusive items`);
}

async function createLiveTempInboxCard(baseUrl, token, runId) {
  const result = await fetchJsonStrict(new URL("/api/turn/text", `${String(baseUrl || "").replace(/\/+$/, "")}/`).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token)
    },
    body: JSON.stringify({
      text: `Inbox management proof temporary tile ${runId}`,
      turn_id: runId,
      reply_mode: "card_only",
      thread_mode: "new",
      proof_reply_delay_ms: 0
    })
  });
  const responseCardId = String(result?.card_id || "").trim();
  if (responseCardId) {
    return {
      result,
      card_id: responseCardId,
      turn_id: runId
    };
  }
  const item = await waitForFeedItem(
    baseUrl,
    token,
    entry => String(entry?.turn_id || entry?.session_id || "").trim() === runId,
    30000
  );
  return {
    result,
    card_id: String(item?.card_id || "").trim(),
    turn_id: runId
  };
}

async function waitForInboxCardPresence(page, cardId, shouldBeVisible, timeoutMs) {
  await page.waitForFunction(
    ({ expectedCardId, expectedVisible }) => {
      const visible = Array.from(document.querySelectorAll(".light-shell[data-light-route=\"inbox\"] article.card"))
        .some(card => String(card.getAttribute("data-card-id") || "").trim() === expectedCardId);
      return visible === expectedVisible;
    },
    { expectedCardId: cardId, expectedVisible: Boolean(shouldBeVisible) },
    { timeout: timeoutMs }
  );
}

async function enterInboxManageMode(page, timeoutMs) {
  const state = await readInboxManagementState(page);
  if (!state.manage_mode_active) {
    await clickLocator(page, page.locator(".light-shell[data-light-route=\"inbox\"] .inbox-manage-toggle").first(), timeoutMs, "Enter Inbox Manage mode");
    await page.waitForFunction(
      () => Boolean(document.querySelector(".app-shell[data-canonical-route=\"inbox\"] .inbox-manage-bar")),
      undefined,
      { timeout: timeoutMs }
    );
  }
}

async function exitInboxManageMode(page, timeoutMs) {
  const state = await readInboxManagementState(page);
  if (state.manage_mode_active) {
    await clickLocator(page, page.locator(".light-shell[data-light-route=\"inbox\"] .inbox-manage-toggle").first(), timeoutMs, "Exit Inbox Manage mode");
    await page.waitForFunction(
      () => !document.querySelector(".app-shell[data-canonical-route=\"inbox\"] .inbox-manage-bar"),
      undefined,
      { timeout: timeoutMs }
    );
  }
}

async function archiveVisibleInboxCardWithManage(page, cardId, timeoutMs, label = "Archive live Inbox tile") {
  await ensureInboxArchiveFilter(page, false, timeoutMs);
  await waitForInboxCardPresence(page, cardId, true, timeoutMs);
  await enterInboxManageMode(page, timeoutMs);
  await clickLocator(page, inboxCardWrap(page, cardId).locator(INBOX_MANAGE_SELECT_SELECTOR).first(), timeoutMs, `${label}: select tile`);
  await page.waitForFunction(
    expectedCardId => Array.from(document.querySelectorAll(".card-wrap.is-inbox-manage-selected article.card[data-card-id]"))
      .some(card => String(card.getAttribute("data-card-id") || "").trim() === expectedCardId),
    cardId,
    { timeout: timeoutMs }
  );
  await clickLocator(page, page.locator(INBOX_MANAGE_PRIMARY_ACTION_SELECTOR).first(), timeoutMs, `${label}: click Archive`);
  await waitForInboxCardPresence(page, cardId, false, timeoutMs);
  await exitInboxManageMode(page, timeoutMs);
}

async function exerciseLiveTempCardArchive(page, config, reportDir, manifestBundle, noAudioGuard) {
  if (!String(config.apiToken || "").trim()) {
    throw new Error("Focused live Inbox management proof requires --api-token or PUCKY_OPERATOR_TOKEN/PUCKY_API_TOKEN for the real backend temp-card proof");
  }
  const baseUrl = new URL(config.lightUrl).origin;
  const sourceSha = String(manifestBundle?.source_commit_full || "").trim();
  const runId = `inbox-management-proof-${(sourceSha || "unknown").slice(0, 12)}-${Date.now().toString(36)}`;
  const actionRequests = [];
  page.on("request", request => {
    const url = request.url();
    if (!/\/api\/feed\/actions(?:[?#]|$)/.test(url)) {
      return;
    }
    let payload = {};
    try {
      payload = JSON.parse(request.postData() || "{}");
    } catch (_error) {
      payload = {};
    }
    actionRequests.push({
      url,
      method: request.method(),
      payload
    });
  });

  const created = await createLiveTempInboxCard(baseUrl, config.apiToken, runId);
  assert(created.card_id, "Live temp Inbox proof card did not return a card_id");
  const proofUrl = new URL(config.lightUrl);
  proofUrl.searchParams.set("theme", "light");
  proofUrl.searchParams.set("route", "inbox");
  proofUrl.searchParams.set("reset_nav", "1");
  proofUrl.searchParams.set("api_token", String(config.apiToken || "").trim());
  proofUrl.searchParams.set("_pucky_refresh", runId);
  await page.goto(proofUrl.toString(), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await waitForLightRoute(page, "inbox", ".card-wrap article.card", config.timeoutMs);
  await ensureInboxArchiveFilter(page, false, config.timeoutMs);
  await waitForInboxCardPresence(page, created.card_id, true, config.timeoutMs);

  await archiveVisibleInboxCardWithManage(page, created.card_id, config.timeoutMs, "Archive live temp Inbox proof tile");
  const activeAfterArchive = await readInboxManagementState(page);
  assert(!activeAfterArchive.selected_card_ids.includes(created.card_id), "Live temp proof tile should not remain selected after archive");
  await ensureInboxArchiveFilter(page, true, config.timeoutMs);
  await waitForInboxCardPresence(page, created.card_id, true, config.timeoutMs);
  const archivedVisible = await readInboxManagementState(page);

  await openInboxTileMenu(page, created.card_id, config.timeoutMs, "Open live temp archived menu");
  const archivedMenu = await readInboxManagementState(page);
  assert(archivedMenu.menu_actions.includes("unarchive"), "Live archived temp card should expose Unarchive");
  assert(!archivedMenu.menu_actions.includes("delete"), "Live archived temp card must not expose Delete");
  await clickLocator(page, page.locator(".light-shell[data-light-route=\"inbox\"] .inbox-card-menu-item[data-card-menu-action=\"unarchive\"]").first(), config.timeoutMs, "Unarchive live temp Inbox proof tile");
  await waitForInboxCardPresence(page, created.card_id, false, config.timeoutMs);

  await ensureInboxArchiveFilter(page, false, config.timeoutMs);
  await waitForInboxCardPresence(page, created.card_id, true, config.timeoutMs);
  const restoredActive = await readInboxManagementState(page);
  const restoredScreenshot = await saveScreenshot(page, reportDir, "09-after-unarchive-active-feed");

  await archiveVisibleInboxCardWithManage(page, created.card_id, config.timeoutMs, "Cleanup archive live temp Inbox proof tile");
  await ensureInboxArchiveFilter(page, true, config.timeoutMs);
  await waitForInboxCardPresence(page, created.card_id, true, config.timeoutMs);
  const cleanupArchived = await readInboxManagementState(page);
  const cleanupScreenshot = await saveScreenshot(page, reportDir, "10-cleanup-archived-final");
  const noAudio = noAudioGuard ? assertNoUnexpectedAudio(noAudioGuard, "Inbox management live temp-card proof") : null;

  assert(actionRequests.some(item => item.payload?.action === "archive" && item.payload?.card_id === created.card_id), "Live temp card archive request was not observed");
  assert(actionRequests.some(item => item.payload?.action === "unarchive" && item.payload?.card_id === created.card_id), "Live temp card unarchive request was not observed");

  return {
    created_card_id: created.card_id,
    turn_id: created.turn_id,
    archive_requests: actionRequests.map(item => item.payload),
    archived_filter_visibility: {
      visible: true,
      state: archivedVisible.layout?.archive_filter || null
    },
    restored_active: {
      visible: true,
      state: restoredActive.layout?.archive_filter || null
    },
    cleanup_result: {
      archived_final: true,
      state: cleanupArchived.layout?.archive_filter || null
    },
    no_audio: noAudio,
    screenshots: {
      after_unarchive_active_feed: restoredScreenshot,
      cleanup_archived_final: cleanupScreenshot
    }
  };
}

async function readDetailState(page) {
  return page.locator("#detail").evaluate(panel => ({
    detail_type: String(panel.getAttribute("data-detail-type") || "").trim(),
    card_id: String(panel.getAttribute("data-detail-card-id") || "").trim(),
    session_id: String(panel.getAttribute("data-detail-session-id") || "").trim(),
    viewer: String(panel.getAttribute("data-detail-viewer") || "").trim(),
    title: String(panel.querySelector(".light-page-title, .detail-title, .detail-header h1, .detail-header h2")?.textContent || "").trim(),
    audio_continuity_present: Boolean(panel.querySelector(".detail-audio-continuity")),
    audio_continuity_action_count: panel.querySelectorAll(".detail-audio-continuity .detail-audio-action").length || 0,
    audio_detail_controls_present: Boolean(panel.querySelector(".audio-player, .attachment-audio-player"))
  }));
}

async function readDetailVisual(page) {
  return page.locator("#detail .detail-shell").evaluate(node => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor
    };
  });
}

function assertDetailParity(label, left, right) {
  assert(left.detail_type === right.detail_type, `${label} detail type diverged`);
  assert(left.card_id === right.card_id, `${label} card id diverged`);
  assert(left.session_id === right.session_id, `${label} session id diverged`);
  assert(left.viewer === right.viewer, `${label} viewer diverged`);
  assert(normalizeText(left.title) === normalizeText(right.title), `${label} title diverged`);
}

function assertNoInheritedAudioContinuity(detail, label) {
  assert(detail.audio_continuity_present === false, `${label} should not render inherited detail audio continuity`);
  assert(Number(detail.audio_continuity_action_count || 0) === 0, `${label} should not expose inherited detail audio actions`);
}

async function closeDetail(page, timeoutMs) {
  const openPanel = page.locator(".detail-panel.is-open").first();
  if (!await openPanel.count()) {
    return;
  }
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  let closed = await page.locator(".detail-panel.is-open").waitFor({ state: "hidden", timeout: 1_500 }).then(() => true).catch(() => false);
  if (!closed) {
    const back = page.locator("#detail .light-back-button, #detail .detail-back").first();
    if (await back.count()) {
      await back.click({ timeout: Math.min(2_000, timeoutMs), force: true }).catch(() => {});
    }
    closed = await page.locator(".detail-panel.is-open").waitFor({ state: "hidden", timeout: 1_500 }).then(() => true).catch(() => false);
  }
  if (!closed) {
    await page.keyboard.press("Escape").catch(() => {});
  }
  await page.locator(".detail-panel.is-open").waitFor({ state: "hidden", timeout: timeoutMs });
}

async function readPlayerState(page) {
  return page.evaluate(async () => await window.Pucky.request({ command: "player.state", args: {} }));
}

async function waitForPlayerAdvance(page, timeoutMs, minimumDeltaMs = 400) {
  const before = await readPlayerState(page);
  const startPosition = Number(before?.position_ms || 0);
  const timeoutAt = Date.now() + Math.max(250, Number(timeoutMs || 0));
  let after = before;
  let durationMs = Number(before?.duration_ms || 0);
  let maxPositionMs = Math.max(0, startPosition);
  while (Date.now() < timeoutAt) {
    await page.waitForTimeout(100);
    after = await readPlayerState(page);
    const currentPositionMs = Number(after?.position_ms || 0);
    durationMs = Math.max(durationMs, Number(after?.duration_ms || 0));
    maxPositionMs = Math.max(maxPositionMs, currentPositionMs);
    const requiredDeltaMs = durationMs > 0
      ? requiredAudioProgressDelta(durationMs)
      : Math.max(50, Number(minimumDeltaMs || 400));
    const completedShortClip = durationMs > 0
      && durationMs < 4000
      && maxPositionMs >= Math.max(requiredDeltaMs, durationMs - 80);
    if (maxPositionMs - startPosition >= requiredDeltaMs || completedShortClip) {
      break;
    }
  }
  durationMs = Math.max(durationMs, Number(after?.duration_ms || 0), Number(before?.duration_ms || 0));
  const requiredDeltaMs = requiredAudioProgressDelta(durationMs);
  const completedShortClip = durationMs > 0
    && durationMs < 4000
    && maxPositionMs >= Math.max(requiredDeltaMs, durationMs - 80);
  const observedStartMs = completedShortClip ? 0 : startPosition;
  return {
    before,
    after,
    delta_ms: Math.max(0, maxPositionMs - observedStartMs),
    duration_ms: durationMs,
    required_delta_ms: requiredDeltaMs,
    observed_start_ms: observedStartMs,
    max_position_ms: maxPositionMs
  };
}

function requiredAudioProgressDelta(durationMs) {
  const duration = Math.max(0, Number(durationMs || 0));
  if (duration > 0 && duration < 4000) {
    return Math.max(250, Math.min(1000, Math.round(duration * 0.5)));
  }
  return 2000;
}

function compatibleAudioControlLabels(left, right, title) {
  const leftLabel = normalizeText(left);
  const rightLabel = normalizeText(right);
  if (leftLabel === rightLabel) {
    return true;
  }
  const escapedTitle = String(title || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^(Play|Pause) ${escapedTitle}$`);
  return pattern.test(leftLabel) && pattern.test(rightLabel);
}

async function clickSelector(page, selector, timeoutMs) {
  await clickLocator(page, page.locator(selector).first(), timeoutMs, selector);
}

async function clickLocator(page, locator, timeoutMs, label) {
  const clickTimeout = Math.min(5_000, timeoutMs);
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: timeoutMs });
  await target.scrollIntoViewIfNeeded({ timeout: Math.min(2_000, timeoutMs) }).catch(() => {});
  try {
    await target.click({ timeout: clickTimeout });
    return;
  } catch (normalClickError) {
    try {
      await target.click({ timeout: clickTimeout, force: true });
      return;
    } catch (forceClickError) {
      const freshTarget = locator.first();
      const box = await freshTarget.boundingBox();
      if (!box) {
        throw forceClickError;
      }
      try {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } catch (mouseClickError) {
        throw new Error(`Could not click ${label}: ${normalClickError}; ${forceClickError}; ${mouseClickError}`);
      }
    }
  }
}

async function waitForInboxTileMenu(page, timeoutMs) {
  await page.waitForFunction(
    () => Boolean(document.querySelector(".light-shell[data-light-route=\"inbox\"] .inbox-card-menu")),
    undefined,
    { timeout: timeoutMs }
  );
}

async function openInboxTileMenu(page, cardId, timeoutMs, label) {
  const menuButton = inboxCardWrap(page, cardId).locator(INBOX_MANAGE_MENU_SELECTOR).first();
  await clickLocator(page, menuButton, timeoutMs, label);
  try {
    await waitForInboxTileMenu(page, Math.min(1500, timeoutMs));
    return;
  } catch (_error) {
    const box = await menuButton.boundingBox();
    if (!box) {
      throw _error;
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await waitForInboxTileMenu(page, timeoutMs);
  }
}

async function stableCardSelector(page, selector, timeoutMs) {
  const trigger = page.locator(selector).first();
  await trigger.waitFor({ state: "visible", timeout: timeoutMs });
  const target = await trigger.evaluate(node => {
    const article = node.closest("article.card");
    return {
      action: String(node.getAttribute("data-card-action") || "").trim(),
      session_id: String(article?.getAttribute("data-card-session-id") || "").trim(),
      card_id: String(article?.getAttribute("data-card-id") || "").trim(),
      is_card_body: node.classList.contains("card-body")
    };
  });
  if (target.action && (target.session_id || target.card_id)) {
    return target.session_id
      ? `article.card[data-card-session-id="${cssString(target.session_id)}"] [data-card-action="${cssString(target.action)}"]`
      : `article.card[data-card-id="${cssString(target.card_id)}"] [data-card-action="${cssString(target.action)}"]`;
  }
  if (target.is_card_body && (target.session_id || target.card_id)) {
    return target.session_id
      ? `article.card[data-card-session-id="${cssString(target.session_id)}"] .card-body`
      : `article.card[data-card-id="${cssString(target.card_id)}"] .card-body`;
  }
  return selector;
}

function selectorForCardAction(target, action) {
  if (target.session_id) {
    return `article.card[data-card-session-id="${cssString(target.session_id)}"] [data-card-action="${cssString(action)}"]`;
  }
  if (target.card_id) {
    return `article.card[data-card-id="${cssString(target.card_id)}"] [data-card-action="${cssString(action)}"]`;
  }
  return "";
}

async function listCardActionTargets(page, selector, limit = 18) {
  return page.locator(selector).evaluateAll((nodes, maxRows) =>
    nodes.slice(0, maxRows).map(node => {
      const article = node.closest("article.card");
      return {
        card_id: String(article?.getAttribute("data-card-id") || "").trim(),
        session_id: String(article?.getAttribute("data-card-session-id") || "").trim(),
        title: String(article?.querySelector(".title")?.textContent || "").trim()
      };
    }),
    limit
  );
}

async function openAndInspectDetail(page, selector, timeoutMs) {
  const targetSelector = await stableCardSelector(page, selector, timeoutMs);
  await clickSelector(page, targetSelector, timeoutMs);
  await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: timeoutMs });
  if (targetSelector.includes('[data-card-action="audio"]')) {
    const landedOnAudio = await page.waitForFunction(() => {
      const panel = document.getElementById("detail");
      return panel?.classList.contains("is-open") && String(panel.getAttribute("data-detail-viewer") || "") === "audio_player";
    }, { timeout: Math.min(2_500, timeoutMs) }).then(() => true).catch(() => false);
    if (!landedOnAudio) {
      await closeDetail(page, timeoutMs);
      await clickSelector(page, targetSelector, timeoutMs);
      await page.waitForFunction(() => {
        const panel = document.getElementById("detail");
        return panel?.classList.contains("is-open") && String(panel.getAttribute("data-detail-viewer") || "") === "audio_player";
      }, { timeout: timeoutMs });
    }
  }
  return {
    state: await readDetailState(page),
    visual: await readDetailVisual(page)
  };
}

async function toggleAndReadAudioState(page, selector, timeoutMs) {
  const trigger = page.locator(selector).first();
  await trigger.waitFor({ state: "visible", timeout: timeoutMs });
  const target = await trigger.evaluate(button => {
    const article = button.closest("article.card");
    return {
      card_id: String(article?.getAttribute("data-card-id") || "").trim(),
      session_id: String(article?.getAttribute("data-card-session-id") || "").trim(),
      title: String(article?.querySelector(".title")?.textContent || "").trim()
    };
  });
  assert(target.card_id || target.session_id, "Audio target did not resolve to a canonical card identity");
  const targetSelector = target.session_id
    ? `article.card[data-card-session-id="${cssString(target.session_id)}"] [data-card-action="audio"]`
    : `article.card[data-card-id="${cssString(target.card_id)}"] [data-card-action="audio"]`;
  await clickSelector(page, targetSelector, timeoutMs);
  await page.waitForFunction(
    selectorValue => Boolean(document.querySelector(selectorValue)?.classList.contains("is-playing")),
    targetSelector,
    { timeout: timeoutMs }
  );
  const progress = await waitForPlayerAdvance(page, Math.min(timeoutMs, 3500), 2000);
  const playing = await page.locator(targetSelector).evaluate(button => ({
    classes: String(button.className || "").trim(),
    aria_label: String(button.getAttribute("aria-label") || "").trim()
  }));
  assert(!playing.classes.split(/\s+/).includes("is-failed"), `Audio control showed failed state after successful playback (${playing.classes})`);
  if (playing.classes.split(/\s+/).some(className => className === "is-playing" || className === "is-busy")) {
    await clickSelector(page, targetSelector, timeoutMs);
    await page.waitForFunction(
      selectorValue => {
        const button = document.querySelector(selectorValue);
        return !!button && !button.classList.contains("is-playing");
      },
      targetSelector,
      { timeout: timeoutMs }
    );
  }
  return {
    ...target,
    ...playing,
    playing: true,
    progress
  };
}

async function openInlineAudioDetail(page, selector, timeoutMs, options = {}) {
  const targets = await listCardActionTargets(page, selector);
  for (const target of targets) {
    if (!target.card_id && !target.session_id) {
      continue;
    }
    const audioSelector = selectorForCardAction(target, "audio");
    const inlineSelector = selectorForCardAction(target, "audio_controls_inline");
    if (!audioSelector || !inlineSelector || !await page.locator(audioSelector).count()) {
      continue;
    }
    await clickSelector(page, audioSelector, timeoutMs);
    const startedPlaying = await page.waitForFunction(
      selectorValue => Boolean(document.querySelector(selectorValue)?.classList.contains("is-playing")),
      audioSelector,
      { timeout: Math.min(timeoutMs, 2500) }
    ).then(() => true).catch(() => false);
    if (!startedPlaying) {
      continue;
    }
    const hasInlineStrip = await page.waitForFunction(
      selectorValue => Boolean(document.querySelector(selectorValue)),
      inlineSelector,
      { timeout: Math.min(timeoutMs, 2500) }
    ).then(() => true).catch(() => false);
    if (!hasInlineStrip) {
      const stillPlaying = await page.locator(audioSelector).evaluate(button => button.classList.contains("is-playing")).catch(() => false);
      if (stillPlaying) {
        await clickSelector(page, audioSelector, timeoutMs);
        await page.waitForTimeout(160);
      }
      continue;
    }
    const openedInlineDetail = await clickSelector(page, inlineSelector, timeoutMs).then(() => true).catch(() => false);
    if (!openedInlineDetail) {
      const stillPlaying = await page.locator(audioSelector).evaluate(button => button.classList.contains("is-playing")).catch(() => false);
      if (stillPlaying) {
        await clickSelector(page, audioSelector, timeoutMs);
        await page.waitForTimeout(160);
      }
      continue;
    }
    const detailOpened = await page.waitForFunction(() => {
      const detail = document.getElementById("detail");
      return String(detail?.getAttribute("data-detail-type") || "") === "audio";
    }, { timeout: timeoutMs }).then(() => true).catch(() => false);
    if (!detailOpened) {
      const stillPlaying = await page.locator(audioSelector).evaluate(button => button.classList.contains("is-playing")).catch(() => false);
      if (stillPlaying) {
        await clickSelector(page, audioSelector, timeoutMs);
        await page.waitForTimeout(160);
      }
      await closeDetail(page, timeoutMs);
      continue;
    }
    const progress = await waitForPlayerAdvance(page, Math.min(timeoutMs, 1500), 500);
    const detail = await readDetailState(page);
    const screenshot = options.reportDir && options.screenshotStem
      ? await saveScreenshot(page, options.reportDir, options.screenshotStem)
      : "";
    await closeDetail(page, timeoutMs);
    return {
      target,
      detail,
      player_delta_ms: progress.delta_ms,
      progress,
      screenshot
    };
  }
  throw new Error("No audio card exposed an inline audio detail strip after playback started");
}

async function readRichPageFrameState(page) {
  return page.locator("#detail .rich-frame").evaluate((iframe) => {
    const doc = iframe.contentDocument;
    const body = doc?.body;
    const root = doc?.documentElement;
    const topText = String(body?.innerText || "").trim().slice(0, 200);
    const totalHeight = Math.max(Number(body?.scrollHeight || 0), Number(root?.scrollHeight || 0));
    const totalWidth = Math.max(Number(body?.scrollWidth || 0), Number(root?.scrollWidth || 0));
    const clientHeight = Number(iframe.clientHeight || 0);
    const clientWidth = Number(iframe.clientWidth || 0);
    iframe.contentWindow?.scrollTo(0, totalHeight);
    return {
      top_text: topText,
      bottom_text: String(body?.innerText || "").trim().slice(-200),
      iframe_client_height: clientHeight,
      iframe_client_width: clientWidth,
      scroll_height: totalHeight,
      scroll_width: totalWidth,
      max_scroll_top: Math.max(0, totalHeight - clientHeight),
      root_scroll_top: Number(root?.scrollTop || 0),
      body_scroll_top: Number(body?.scrollTop || 0)
    };
  });
}

async function readRichDetailLayout(page) {
  return page.evaluate(() => {
    const rect = (node) => {
      if (!(node instanceof HTMLElement)) {
        return null;
      }
      const box = node.getBoundingClientRect();
      return {
        left: Number(box.left.toFixed(2)),
        right: Number(box.right.toFixed(2)),
        top: Number(box.top.toFixed(2)),
        bottom: Number(box.bottom.toFixed(2)),
        width: Number(box.width.toFixed(2)),
        height: Number(box.height.toFixed(2))
      };
    };
    const header = document.querySelector("#detail .light-page-header");
    const body = document.querySelector("#detail .detail-content");
    const bodyInner = document.querySelector("#detail .detail-content-inner");
    const rich = document.querySelector("#detail .rich-detail");
    const frame = document.querySelector("#detail .rich-frame");
    return {
      inner_width: Number(window.innerWidth || 0),
      document_scroll_width: Number(document.documentElement?.scrollWidth || 0),
      header: rect(header),
      body: rect(body),
      body_inner: rect(bodyInner),
      rich: rect(rich),
      frame: rect(frame)
    };
  });
}

async function clickLightTile(page, route, timeoutMs) {
  const tile = page.locator(`.light-app-tile[data-route="${route}"]`);
  await tile.waitFor({ state: "visible", timeout: timeoutMs });
  await tile.click();
}

async function backToLightHome(page, timeoutMs) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await page.locator(".light-shell[data-light-route=\"home\"]").count()) {
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(250);
  }
  await page.locator(".light-shell[data-light-route=\"home\"]").waitFor({ state: "visible", timeout: timeoutMs });
}

async function compareOptionalAttachmentDetail(lightPage, darkPage, timeoutMs, reportDir) {
  const selector = "[data-card-action=\"page\"]";
  const darkTargets = await listCardActionTargets(darkPage, selector);
  if (!darkTargets.length || !await lightPage.locator(selector).count()) {
    return { checked: false, reason: "No page action was available in the current feed sample." };
  }
  let selected = null;
  for (const target of darkTargets) {
    const darkSelector = selectorForCardAction(target, "page");
    const lightSelector = selectorForCardAction(target, "page");
    if (!darkSelector || !lightSelector) {
      continue;
    }
    if (!await darkPage.locator(darkSelector).count() || !await lightPage.locator(lightSelector).count()) {
      continue;
    }
    const darkDetail = await openAndInspectDetail(darkPage, darkSelector, timeoutMs);
    const lightDetail = await openAndInspectDetail(lightPage, lightSelector, timeoutMs);
    const topShots = {
      dark: await saveScreenshot(darkPage, reportDir, "07-dark-inbox-page-top"),
      light: await saveScreenshot(lightPage, reportDir, "08-light-inbox-page-top")
    };
    const darkLayout = await readRichDetailLayout(darkPage);
    const lightLayout = await readRichDetailLayout(lightPage);
    const darkFrame = await readRichPageFrameState(darkPage);
    const lightFrame = await readRichPageFrameState(lightPage);
    const bottomShots = {
      dark: await saveScreenshot(darkPage, reportDir, "09-dark-inbox-page-bottom"),
      light: await saveScreenshot(lightPage, reportDir, "10-light-inbox-page-bottom")
    };
    assertDetailParity("Inbox page/attachment", darkDetail.state, lightDetail.state);
    assert(darkDetail.state.detail_type === "page", "Dark Feed page action did not open page detail");
    assert(lightDetail.state.detail_type === "page", "Light Inbox page action did not open page detail");
    assertNoInheritedAudioContinuity(darkDetail.state, "Dark Feed page detail");
    assertNoInheritedAudioContinuity(lightDetail.state, "Light Inbox page detail");
    assert(lightDetail.visual.backgroundColor !== darkDetail.visual.backgroundColor, "Inbox page or attachment detail did not switch to light styling");
    assert(!/\/mock\//i.test(darkFrame.top_text), "Dark Feed page detail still rendered mock placeholder content");
    assert(!/\/mock\//i.test(lightFrame.top_text), "Light Inbox page detail still rendered mock placeholder content");
    assert(darkLayout.header && darkLayout.body && darkLayout.body.top <= darkLayout.header.bottom + 12, `Dark Feed page detail body should start directly below the header (${darkLayout.body?.top} > ${darkLayout.header?.bottom})`);
    assert(lightLayout.header && lightLayout.body && lightLayout.body.top <= lightLayout.header.bottom + 12, `Light Inbox page detail body should start directly below the header (${lightLayout.body?.top} > ${lightLayout.header?.bottom})`);
    assert(darkLayout.body && darkLayout.frame && darkLayout.frame.left <= darkLayout.body.left + 2 && darkLayout.frame.right >= darkLayout.body.right - 2, "Dark Feed page detail iframe did not remain full width inside the detail body");
    assert(lightLayout.body && lightLayout.frame && lightLayout.frame.left <= lightLayout.body.left + 2 && lightLayout.frame.right >= lightLayout.body.right - 2, "Light Inbox page detail iframe did not remain full width inside the detail body");
    assert(darkLayout.document_scroll_width <= darkLayout.inner_width + 1, `Dark Feed page detail introduced horizontal overflow (${darkLayout.document_scroll_width} > ${darkLayout.inner_width})`);
    assert(lightLayout.document_scroll_width <= lightLayout.inner_width + 1, `Light Inbox page detail introduced horizontal overflow (${lightLayout.document_scroll_width} > ${lightLayout.inner_width})`);
    assert(darkFrame.scroll_width <= darkFrame.iframe_client_width + 1, `Dark Feed page iframe introduced horizontal overflow (${darkFrame.scroll_width} > ${darkFrame.iframe_client_width})`);
    assert(lightFrame.scroll_width <= lightFrame.iframe_client_width + 1, `Light Inbox page iframe introduced horizontal overflow (${lightFrame.scroll_width} > ${lightFrame.iframe_client_width})`);
    const darkTallEnough = darkFrame.scroll_height > darkFrame.iframe_client_height;
    const lightTallEnough = lightFrame.scroll_height > lightFrame.iframe_client_height;
    const darkReachedBottom = darkFrame.root_scroll_top >= darkFrame.max_scroll_top;
    const lightReachedBottom = lightFrame.root_scroll_top >= lightFrame.max_scroll_top;
    if (darkTallEnough && lightTallEnough && darkReachedBottom && lightReachedBottom) {
      selected = {
        target,
        dark: darkDetail,
        dark_layout: darkLayout,
        dark_frame: darkFrame,
        light: lightDetail,
        light_layout: lightLayout,
        light_frame: lightFrame,
        screenshots: {
          top: topShots,
          bottom: bottomShots
        }
      };
      break;
    }
    await closeDetail(darkPage, timeoutMs);
    await closeDetail(lightPage, timeoutMs);
  }
  assert(selected, "No page action opened a scrollable rich page that reached the bottom in both themes");
  await closeDetail(darkPage, timeoutMs);
  await closeDetail(lightPage, timeoutMs);
  return {
    checked: true,
    ...selected
  };
}

async function runInboxManagementOnly(config) {
  ensureDir(config.reportDir);
  loadProofRuntimeEnv({ rootDir: ROOT });
  if (!String(config.apiToken || "").trim()) {
    config.apiToken = resolveWriteToken({
      rootDir: ROOT,
      explicitToken: config.apiToken,
      sharedKeys: ["PUCKY_OPERATOR_TOKEN", "PUCKY_API_TOKEN"]
    });
  }
  const tracePath = path.join(config.reportDir, "trace.zip");
  const consoleJsonPath = path.join(config.reportDir, "console.json");
  const networkJsonPath = path.join(config.reportDir, "network.json");
  const actionsJsonPath = path.join(config.reportDir, "actions.json");
  const manifestJsonPath = path.join(config.reportDir, "manifest.json");
  const finalDomPaths = {
    intercepted: path.join(config.reportDir, "intercepted-final-dom.html"),
    live_temp_card: path.join(config.reportDir, "live-temp-card-final-dom.html")
  };
  const videoDir = path.join(config.reportDir, "video");
  ensureDir(videoDir);

  const actions = [];
  const consoleEvents = [];
  const networkEvents = [];
  const videos = {};
  const pageEntries = [];
  const browser = await launchConfiguredBrowser(config);
  const context = await browser.newContext({
    viewport: config.viewport,
    screen: config.viewport,
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir: videoDir, size: config.viewport }
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

  const attachManagedPage = async (name) => {
    const page = await context.newPage();
    const video = page.video();
    const consoleLogPath = path.join(config.reportDir, `${name}-console.log`);
    attachPageLogging(page, consoleLogPath);
    page.on("console", (message) => {
      consoleEvents.push({
        page: name,
        type: message.type(),
        text: message.text()
      });
    });
    page.on("pageerror", (error) => {
      consoleEvents.push({
        page: name,
        type: "pageerror",
        text: String(error?.message || error || "")
      });
    });
    page.on("response", async (response) => {
      const headers = await response.allHeaders().catch(() => ({}));
      networkEvents.push({
        page: name,
        url: response.url(),
        status: response.status(),
        resource_type: response.request().resourceType(),
        content_type: String(headers["content-type"] || "")
      });
    });
    pageEntries.push({ name, page, video });
    return page;
  };

  try {
    const refreshValue = config.expectedSha || `inbox-management-${Date.now()}`;
    const manifest = await fetchManifestBundle(config.lightUrl, config.apiToken, `${refreshValue}-manifest`);
    writeJsonFile(manifestJsonPath, manifest);
    if (config.expectedSha) {
      assert(manifest.source_commit_full === config.expectedSha, `Hosted manifest commit ${manifest.source_commit_full || "<empty>"} did not match expected ${config.expectedSha}`);
    }
    if (config.liveBackend) {
      assert(manifest.source_dirty === false, "Hosted manifest source_dirty must be false before live Inbox management proof");
    }

    const interceptedPage = await attachManagedPage("intercepted");
    const interceptedGuard = installNoAudioGuard(interceptedPage);
    logAction(actions, "navigate_inbox_management_intercepted", {
      browser_name: config.browserName,
      viewport: config.viewport,
      light_url: config.lightUrl
    });
    await interceptedPage.goto(config.lightUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForLightRoute(interceptedPage, "inbox", ".card-wrap article.card", config.timeoutMs);
    const intercepted = await exerciseInboxManagement(interceptedPage, config.timeoutMs, config.reportDir, {
      noAudioGuard: interceptedGuard
    });
    fs.writeFileSync(finalDomPaths.intercepted, await interceptedPage.content(), "utf8");

    let liveTempCard = null;
    let liveTempNoAudio = null;
    if (config.liveBackend) {
      const livePage = await attachManagedPage("live-temp-card");
      const liveGuard = installNoAudioGuard(livePage);
      logAction(actions, "exercise_live_temp_card", {
        browser_name: config.browserName,
        viewport: config.viewport,
        light_url: config.lightUrl,
        expected_sha: config.expectedSha
      });
      liveTempCard = await exerciseLiveTempCardArchive(livePage, config, config.reportDir, manifest, liveGuard);
      liveTempNoAudio = liveTempCard.no_audio;
      fs.writeFileSync(finalDomPaths.live_temp_card, await livePage.content(), "utf8");
    }

    const combinedNoAudio = {
      clicked_audio_count: Number(intercepted.no_audio?.clicked_audio_count || 0) + Number(liveTempNoAudio?.clicked_audio_count || 0),
      media_request_count: Number(intercepted.no_audio?.media_request_count || 0) + Number(liveTempNoAudio?.media_request_count || 0),
      intercepted: intercepted.no_audio,
      live_temp_card: liveTempNoAudio
    };
    assert(combinedNoAudio.clicked_audio_count === 0, "Inbox management proof clicked audio");
    assert(combinedNoAudio.media_request_count === 0, "Inbox management proof observed media requests");

    await context.tracing.stop({ path: tracePath });
    writeJsonFile(consoleJsonPath, consoleEvents);
    writeJsonFile(networkJsonPath, networkEvents);
    writeJsonFile(actionsJsonPath, actions);
    await context.close().catch(() => {});
    for (const entry of pageEntries) {
      videos[entry.name] = entry.video ? await entry.video.path().catch(() => "") : "";
    }

    const summary = {
      schema: "pucky.inbox_management_proof.v1",
      ok: true,
      browser_name: config.browserName,
      viewport: config.viewport,
      light_url: config.lightUrl,
      manifest,
      layout: intercepted.layout,
      archive: {
        intercepted: intercepted.archive?.intercepted || null,
        live_temp_card: liveTempCard
      },
      no_audio: combinedNoAudio,
      screenshots: {
        ...intercepted.screenshots,
        ...(liveTempCard?.screenshots || {})
      },
      actions,
      evidence: {
        trace: tracePath,
        console_json: consoleJsonPath,
        network_json: networkJsonPath,
        actions_json: actionsJsonPath,
        manifest_json: manifestJsonPath,
        final_dom: finalDomPaths,
        video_dir: videoDir,
        videos
      }
    };
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await context.tracing.stop({ path: tracePath }).catch(() => {});
    writeJsonFile(consoleJsonPath, consoleEvents);
    writeJsonFile(networkJsonPath, networkEvents);
    writeJsonFile(actionsJsonPath, actions);
    for (const entry of pageEntries) {
      await entry.page.content()
        .then((html) => fs.writeFileSync(finalDomPaths[entry.name] || path.join(config.reportDir, `${entry.name}-final-dom.html`), html, "utf8"))
        .catch(() => {});
    }
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.onlyInboxManagement) {
    await runInboxManagementOnly(config);
    return;
  }
  ensureDir(config.reportDir);
  const tracePath = path.join(config.reportDir, "trace.zip");
  const consoleJsonPath = path.join(config.reportDir, "console.json");
  const networkJsonPath = path.join(config.reportDir, "network.json");
  const actionsJsonPath = path.join(config.reportDir, "actions.json");
  const finalDomPaths = {
    light: path.join(config.reportDir, "light-final-dom.html"),
    dark_feed: path.join(config.reportDir, "dark-feed-final-dom.html"),
    dark_meetings: path.join(config.reportDir, "dark-meetings-final-dom.html")
  };
  const videoDir = path.join(config.reportDir, "video");
  ensureDir(videoDir);

  const actions = [];
  const consoleEvents = [];
  const networkEvents = [];
  const browser = await launchConfiguredBrowser(config);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    screen: VIEWPORT,
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir: videoDir, size: VIEWPORT }
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const lightPage = await context.newPage();
  const darkFeedPage = await context.newPage();
  const darkMeetingsPage = await context.newPage();
  const lightVideo = lightPage.video();
  const darkFeedVideo = darkFeedPage.video();
  const darkMeetingsVideo = darkMeetingsPage.video();

  const pageEntries = [
    { name: "light", page: lightPage, consoleLogPath: path.join(config.reportDir, "light-page-console.log") },
    { name: "dark_feed", page: darkFeedPage, consoleLogPath: path.join(config.reportDir, "dark-feed-console.log") },
    { name: "dark_meetings", page: darkMeetingsPage, consoleLogPath: path.join(config.reportDir, "dark-meetings-console.log") }
  ];

  for (const entry of pageEntries) {
    attachPageLogging(entry.page, entry.consoleLogPath);
    entry.page.on("console", (message) => {
      consoleEvents.push({
        page: entry.name,
        type: message.type(),
        text: message.text()
      });
    });
    entry.page.on("pageerror", (error) => {
      consoleEvents.push({
        page: entry.name,
        type: "pageerror",
        text: String(error?.message || error || "")
      });
    });
    entry.page.on("response", async (response) => {
      const headers = await response.allHeaders().catch(() => ({}));
      networkEvents.push({
        page: entry.name,
        url: response.url(),
        status: response.status(),
        resource_type: response.request().resourceType(),
        content_type: String(headers["content-type"] || "")
      });
    });
  }

  const screenshots = {};
  try {
    logAction(actions, "navigate_initial_routes", {
      browser_name: config.browserName,
      light_url: config.lightUrl,
      dark_feed_url: config.darkFeedUrl,
      dark_meetings_url: config.darkMeetingsUrl
    });
    await Promise.all([
      lightPage.goto(config.lightUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs }),
      darkFeedPage.goto(config.darkFeedUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs }),
      darkMeetingsPage.goto(config.darkMeetingsUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs })
    ]);

    await waitForLightHome(lightPage, config.timeoutMs);
    await waitForDarkRoute(darkFeedPage, "inbox", ".card-wrap article.card", config.timeoutMs);
    await waitForDarkRoute(darkMeetingsPage, "meetings", ".meetings-page", config.timeoutMs);

    assert(await lightPage.locator(".light-app-tile[data-route=\"notifications\"]").count() === 0, "Light home should not include a Notifications tile");
    assert(await lightPage.locator(".light-digest").count() === 0, "Light home should not render the removed digest section");
    assert(await lightPage.locator("#voiceStatus").count() === 1, "Light home should keep the real top-right voice status indicator");

    screenshots.home = await saveScreenshot(lightPage, config.reportDir, "01-light-home");
    screenshots.directDarkFeed = await saveScreenshot(darkFeedPage, config.reportDir, "02-direct-dark-feed");
    screenshots.directDarkMeetings = await saveScreenshot(darkMeetingsPage, config.reportDir, "03-direct-dark-meetings");

    const darkFeedRows = await extractCardRows(darkFeedPage, ".card-wrap article.card");
    const darkFeedCardStyle = await readCardStyle(darkFeedPage, ".card-wrap article.card");
    assertMeaningfulRows("Dark Feed", darkFeedRows);
    assertFlatCardShell(darkFeedCardStyle, "Dark Feed");
    const darkFeedScroll = await readScrollReachability(
      darkFeedPage,
      ".card-wrap article.card",
      ["#feed", ".feed", ".light-shell[data-light-route=\"inbox\"] .light-canonical-port-surface"]
    );
    assert(darkFeedScroll.found, "Dark Feed scroll container was not found");
    assert(darkFeedScroll.can_scroll || darkFeedRows.length <= 3, "Dark Feed did not expose enough content to scroll end-to-end");
    assert(darkFeedScroll.reached_bottom, "Dark Feed could not reach the card list bottom");
    assert(darkFeedScroll.returned_top === 0, "Dark Feed did not return to the top of the list after resetting");

    logAction(actions, "open_light_inbox");
    await clickLightTile(lightPage, "inbox", config.timeoutMs);
    await waitForLightRoute(lightPage, "inbox", ".card-wrap article.card", config.timeoutMs);
    assert(await readLightHeaderTitle(lightPage) === "Inbox", "Light Inbox did not render the normal light header title");
    assert(await lightPage.locator(".light-back-button").count() === 1, "Light Inbox should expose the normal back button");
    assert(await lightPage.locator("#voiceStatus").count() === 1, "Light Inbox should keep the real voice status indicator");
    await assertHidden(lightPage, "#pageTabs", "Light Inbox should hide the canonical top tabs");
    await assertHidden(lightPage, "#routeTray", "Light Inbox should hide the canonical route tray");
    const inboxRows = await extractCardRows(lightPage, ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card");
    assertMeaningfulRows("Light Inbox", inboxRows);
    assert(rowsMatch(darkFeedRows, inboxRows), "Light Inbox cards did not match the canonical dark Home feed rows");
    const lightInboxCardStyle = await readCardStyle(lightPage, ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card");
    assertFlatCardShell(lightInboxCardStyle, "Light Inbox");
    assert(lightInboxCardStyle.color !== darkFeedCardStyle.color, "Light Inbox cards should still switch to light-theme text contrast");
    const lightInboxScroll = await readScrollReachability(
      lightPage,
      ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card",
      ["#feed", ".feed", ".light-shell[data-light-route=\"inbox\"] .light-canonical-port-surface"]
    );
    assert(lightInboxScroll.found, "Light Inbox scroll container was not found");
    assert(lightInboxScroll.can_scroll || inboxRows.length <= 3, "Light Inbox did not expose enough content to scroll end-to-end");
    assert(lightInboxScroll.reached_bottom, "Light Inbox could not reach the card list bottom");
    assert(lightInboxScroll.returned_top === 0, "Light Inbox did not return to the top of the list after resetting");
    const unreadMarker = await readUnreadMarkerStyle(lightPage);
    if (unreadMarker) {
      assert(unreadMarker.backgroundColor === "rgba(0, 0, 0, 0)" || unreadMarker.backgroundColor === "transparent", "Light Inbox unread icon should not keep the old background chip");
      assert(unreadMarker.color !== unreadMarker.readColor, "Light Inbox unread icon should keep a distinct emphasized treatment");
    }
    const inboxActionLayout = await readInboxActionLayout(lightPage);
    assert(inboxActionLayout.unread_page_action, "Light Inbox did not expose an unread page or attachment action for contrast proof");
    assert(
      inboxActionLayout.unread_page_action.contrast_ratio >= 3,
      `Light Inbox unread page/attachment action did not have readable contrast (${inboxActionLayout.unread_page_action.color} on ${inboxActionLayout.unread_page_action.background_color}; ratio ${inboxActionLayout.unread_page_action.contrast_ratio})`
    );
    assert(inboxActionLayout.unread_page_action.color !== "rgb(245, 249, 255)", "Light Inbox unread page/attachment action should not inherit the dark-theme white icon token");
    assert(inboxActionLayout.two_action_audio?.rect?.right <= inboxActionLayout.two_action_attachment?.rect?.x, "Light Inbox two-action card should keep the mic left of the page/attachment icon");
    assert(inboxActionLayout.audio_only_card, "Light Inbox did not expose an audio-only card for alignment proof");
    assert(inboxActionLayout.audio_only_actions.class_name.includes("action-count-1"), "Light Inbox audio-only card did not use the one-action layout class");
    assert(inboxActionLayout.audio_only_action_width_px >= 37 && inboxActionLayout.audio_only_action_width_px <= 39, `Light Inbox audio-only action column should be 38px wide, got ${inboxActionLayout.audio_only_action_width_px}px`);
    assert(inboxActionLayout.audio_only_mic_right_aligned, "Light Inbox audio-only mic should align to the far-right action edge");
    logAction(actions, "exercise_inbox_management");
    const inboxManagement = await exerciseInboxManagement(lightPage, config.timeoutMs, config.reportDir);
    screenshots.inboxMenu = inboxManagement.screenshots.menu;
    screenshots.inboxManageSelected = inboxManagement.screenshots.selected;
    screenshots.inboxManageArchived = inboxManagement.screenshots.archived;
    screenshots.inboxList = await saveScreenshot(lightPage, config.reportDir, "04-light-inbox-list");

    logAction(actions, "open_transcript_title_detail");
    const darkFeedTitleDetail = await openAndInspectDetail(darkFeedPage, ".card-wrap article.card [data-card-action=\"transcript_title\"]", config.timeoutMs);
    const lightInboxTitleDetail = await openAndInspectDetail(lightPage, ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card [data-card-action=\"transcript_title\"]", config.timeoutMs);
    assertDetailParity("Inbox transcript/title detail", darkFeedTitleDetail.state, lightInboxTitleDetail.state);
    assertNoInheritedAudioContinuity(darkFeedTitleDetail.state, "Dark Feed transcript/title detail");
    assertNoInheritedAudioContinuity(lightInboxTitleDetail.state, "Light Inbox transcript/title detail");
    assert(lightInboxTitleDetail.visual.backgroundColor !== darkFeedTitleDetail.visual.backgroundColor, "Light Inbox title detail did not switch to light styling");
    screenshots.darkInboxTitleDetail = await saveScreenshot(darkFeedPage, config.reportDir, "05-dark-inbox-title-detail");
    screenshots.inboxTitleDetail = await saveScreenshot(lightPage, config.reportDir, "05-light-inbox-title-detail");
    await closeDetail(darkFeedPage, config.timeoutMs);
    await closeDetail(lightPage, config.timeoutMs);

    logAction(actions, "open_transcript_summary_detail");
    const darkFeedSummaryDetail = await openAndInspectDetail(darkFeedPage, ".card-wrap article.card [data-card-action=\"transcript_body\"]", config.timeoutMs);
    const lightInboxSummaryDetail = await openAndInspectDetail(lightPage, ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card [data-card-action=\"transcript_body\"]", config.timeoutMs);
    assertDetailParity("Inbox transcript/summary detail", darkFeedSummaryDetail.state, lightInboxSummaryDetail.state);
    assertNoInheritedAudioContinuity(darkFeedSummaryDetail.state, "Dark Feed transcript/summary detail");
    assertNoInheritedAudioContinuity(lightInboxSummaryDetail.state, "Light Inbox transcript/summary detail");
    screenshots.inboxSummaryDetail = await saveScreenshot(lightPage, config.reportDir, "06-light-inbox-summary-detail");
    await closeDetail(darkFeedPage, config.timeoutMs);
    await closeDetail(lightPage, config.timeoutMs);

    logAction(actions, "open_page_detail_and_scroll_bottom");
    const inboxAttachmentDetail = await compareOptionalAttachmentDetail(lightPage, darkFeedPage, config.timeoutMs, config.reportDir);
    logAction(actions, "toggle_inbox_audio_playback");
    const darkFeedAudioState = await toggleAndReadAudioState(darkFeedPage, "[data-card-action=\"audio\"]", config.timeoutMs);
    const lightInboxAudioState = await toggleAndReadAudioState(lightPage, ".light-shell[data-light-route=\"inbox\"] [data-card-action=\"audio\"]", config.timeoutMs);
    assert(lightInboxAudioState.title === darkFeedAudioState.title, "Light Inbox audio title diverged from the canonical dark Home feed");
    assert(lightInboxAudioState.session_id === darkFeedAudioState.session_id, "Light Inbox audio session diverged from the canonical dark Home feed");
    assert(
      compatibleAudioControlLabels(lightInboxAudioState.aria_label, darkFeedAudioState.aria_label, lightInboxAudioState.title),
      `Light Inbox audio control label diverged from the canonical dark Home feed (dark ${darkFeedAudioState.aria_label}; light ${lightInboxAudioState.aria_label})`
    );
    assert(
      lightInboxAudioState.progress.delta_ms >= lightInboxAudioState.progress.required_delta_ms,
      `Light Inbox audio did not advance enough after starting playback (${lightInboxAudioState.progress.delta_ms} ms / required ${lightInboxAudioState.progress.required_delta_ms} ms; duration ${lightInboxAudioState.progress.duration_ms} ms; observed_start ${lightInboxAudioState.progress.observed_start_ms} ms; max ${Number(lightInboxAudioState.progress.max_position_ms || 0)} ms; before ${Number(lightInboxAudioState.progress.before?.position_ms || 0)} ms; after ${Number(lightInboxAudioState.progress.after?.position_ms || 0)} ms; state ${String(lightInboxAudioState.progress.after?.state || "")}; playing ${Boolean(lightInboxAudioState.progress.after?.is_playing)})`
    );
    assert(
      darkFeedAudioState.progress.delta_ms >= darkFeedAudioState.progress.required_delta_ms,
      `Dark Feed audio did not advance enough after starting playback (${darkFeedAudioState.progress.delta_ms} ms / required ${darkFeedAudioState.progress.required_delta_ms} ms; duration ${darkFeedAudioState.progress.duration_ms} ms; observed_start ${darkFeedAudioState.progress.observed_start_ms} ms; max ${Number(darkFeedAudioState.progress.max_position_ms || 0)} ms; before ${Number(darkFeedAudioState.progress.before?.position_ms || 0)} ms; after ${Number(darkFeedAudioState.progress.after?.position_ms || 0)} ms; state ${String(darkFeedAudioState.progress.after?.state || "")}; playing ${Boolean(darkFeedAudioState.progress.after?.is_playing)})`
    );
    logAction(actions, "open_inline_audio_detail");
    const darkFeedInlineAudioDetail = await openInlineAudioDetail(darkFeedPage, "[data-card-action=\"audio\"]", config.timeoutMs, {
      reportDir: config.reportDir,
      screenshotStem: "10a-dark-inbox-audio-detail"
    });
    const lightInboxInlineAudioDetail = await openInlineAudioDetail(
      lightPage,
      ".light-shell[data-light-route=\"inbox\"] [data-card-action=\"audio\"]",
      config.timeoutMs,
      {
        reportDir: config.reportDir,
        screenshotStem: "10b-light-inbox-audio-detail"
      }
    );
    assert(darkFeedInlineAudioDetail.detail.detail_type === "audio", "Dark Feed inline audio strip did not open audio detail");
    assert(lightInboxInlineAudioDetail.detail.detail_type === "audio", "Light Inbox inline audio strip did not open audio detail");
    assert(darkFeedInlineAudioDetail.detail.audio_detail_controls_present, "Dark Feed inline audio detail should expose audio controls");
    assert(lightInboxInlineAudioDetail.detail.audio_detail_controls_present, "Light Inbox inline audio detail should expose audio controls");
    assertNoInheritedAudioContinuity(darkFeedInlineAudioDetail.detail, "Dark Feed inline audio detail");
    assertNoInheritedAudioContinuity(lightInboxInlineAudioDetail.detail, "Light Inbox inline audio detail");
    assert(
      darkFeedInlineAudioDetail.player_delta_ms >= 500 && lightInboxInlineAudioDetail.player_delta_ms >= 500,
      `Inline audio detail did not preserve the active player session (dark ${darkFeedInlineAudioDetail.player_delta_ms} ms / light ${lightInboxInlineAudioDetail.player_delta_ms} ms)`
    );
    screenshots.darkInboxAudioDetail = darkFeedInlineAudioDetail.screenshot;
    screenshots.inboxAudioDetail = lightInboxInlineAudioDetail.screenshot;

    await backToLightHome(lightPage, config.timeoutMs);

    let lightMeetingsRows = [];
    let darkMeetingsScroll = { checked: false, reason: "No meetings cards were available in the dark route sample." };
    let lightMeetingsDetail = null;
    let lightMeetingsAudio = null;
    let meetingsRowsMatch = false;
    let meetingsTightLayout = {
      standard: { dark: [], light: [] },
      narrow: { dark: [], light: [] }
    };
    const darkMeetingsCount = await darkMeetingsPage.locator(".meetings-page .card-wrap article.card").count();
    if (darkMeetingsCount > 0) {
      const darkMeetingsRows = await extractCardRows(darkMeetingsPage, ".meetings-page .card-wrap article.card");
      const darkMeetingsCardStyle = await readCardStyle(darkMeetingsPage, ".meetings-page .card-wrap article.card");
      assertMeaningfulRows("Dark Meetings", darkMeetingsRows);
      darkMeetingsScroll = await readScrollReachability(
        darkMeetingsPage,
        ".meetings-page .card-wrap article.card",
        ["#feed", ".feed", ".meetings-page"]
      );
      assert(darkMeetingsScroll.found, "Dark Meetings scroll container was not found");
      assert(darkMeetingsScroll.can_scroll, "Dark Meetings did not expose enough content to scroll end-to-end");
      assert(darkMeetingsScroll.reached_bottom, "Dark Meetings could not reach the meeting list bottom");
      assert(darkMeetingsScroll.returned_top === 0, "Dark Meetings did not return to the top of the list after resetting");

      logAction(actions, "open_light_meetings");
      await clickLightTile(lightPage, "meetings", config.timeoutMs);
      await waitForLightRoute(lightPage, "meetings", ".meetings-page .card-wrap article.card", config.timeoutMs);
      assert(await readLightHeaderTitle(lightPage) === "Meetings", "Light Meetings did not render the normal light header title");
      assert(await lightPage.locator(".light-back-button").count() === 1, "Light Meetings should expose the normal back button");
      assert(await lightPage.locator("#voiceStatus").count() === 1, "Light Meetings should keep the real voice status indicator");
      await assertHidden(lightPage, "#pageTabs", "Light Meetings should hide the canonical top tabs");
      await assertHidden(lightPage, "#routeTray", "Light Meetings should hide the canonical route tray");
      assert(await lightPage.locator(".light-shell[data-light-route=\"meetings\"] .meetings-header").count() === 0, "Light Meetings should not render a duplicate canonical meetings header");
      lightMeetingsRows = await extractCardRows(lightPage, ".light-shell[data-light-route=\"meetings\"] .meetings-page .card-wrap article.card");
      assertMeaningfulRows("Light Meetings", lightMeetingsRows);
      meetingsRowsMatch = rowsMatch(darkMeetingsRows, lightMeetingsRows);
      assert(meetingsRowsMatch, "Light Meetings rows did not match the canonical dark meetings list");
      const lightMeetingsCardStyle = await readCardStyle(lightPage, ".light-shell[data-light-route=\"meetings\"] .meetings-page .card-wrap article.card");
      assertFlatCardShell(darkMeetingsCardStyle, "Dark Meetings");
      assertFlatCardShell(lightMeetingsCardStyle, "Light Meetings");
      meetingsTightLayout.standard.dark = await readMeetingRowLayout(darkMeetingsPage, ".meetings-page .card-wrap article.card.card-meeting-list");
      meetingsTightLayout.standard.light = await readMeetingRowLayout(lightPage, ".light-shell[data-light-route=\"meetings\"] .meetings-page .card-wrap article.card.card-meeting-list");
      assertTightMeetingRows("dark-meetings-430", meetingsTightLayout.standard.dark);
      assertTightMeetingRows("light-meetings-430", meetingsTightLayout.standard.light);
      screenshots.meetingsList = await saveScreenshot(lightPage, config.reportDir, "08-light-meetings-list");

      const darkMeetingsDetail = await openAndInspectDetail(darkMeetingsPage, ".card-meeting-list .card-body", config.timeoutMs);
      lightMeetingsDetail = await openAndInspectDetail(lightPage, ".light-shell[data-light-route=\"meetings\"] .card-meeting-list .card-body", config.timeoutMs);
      assertDetailParity("Meetings detail", darkMeetingsDetail.state, lightMeetingsDetail.state);
      assert(lightMeetingsDetail.visual.backgroundColor !== darkMeetingsDetail.visual.backgroundColor, "Light Meetings detail did not switch to light styling");
      screenshots.meetingsDetail = await saveScreenshot(lightPage, config.reportDir, "09-light-meetings-detail");
      await closeDetail(darkMeetingsPage, config.timeoutMs);
      await closeDetail(lightPage, config.timeoutMs);

      assert(await darkMeetingsPage.locator(".card-meeting-list [data-card-action=\"audio\"]").count() > 0, "Canonical dark Meetings did not expose a meeting audio action");
      assert(await lightPage.locator(".light-shell[data-light-route=\"meetings\"] .card-meeting-list [data-card-action=\"audio\"]").count() > 0, "Light Meetings did not expose a meeting audio action");
      const darkMeetingsAudio = await openAndInspectDetail(darkMeetingsPage, ".card-meeting-list [data-card-action=\"audio\"]", config.timeoutMs);
      lightMeetingsAudio = await openAndInspectDetail(lightPage, ".light-shell[data-light-route=\"meetings\"] .card-meeting-list [data-card-action=\"audio\"]", config.timeoutMs);
      assertDetailParity("Meetings audio", darkMeetingsAudio.state, lightMeetingsAudio.state);
      assert(lightMeetingsAudio.visual.backgroundColor !== darkMeetingsAudio.visual.backgroundColor, "Light Meetings audio detail did not switch to light styling");
      screenshots.meetingsAudio = await saveScreenshot(lightPage, config.reportDir, "10-light-meetings-audio");
      await closeDetail(darkMeetingsPage, config.timeoutMs);
      await closeDetail(lightPage, config.timeoutMs);

      await darkMeetingsPage.setViewportSize(NARROW_VIEWPORT);
      await lightPage.setViewportSize(NARROW_VIEWPORT);
      await darkMeetingsPage.waitForTimeout(150);
      await lightPage.waitForTimeout(150);
      meetingsTightLayout.narrow.dark = await readMeetingRowLayout(darkMeetingsPage, ".meetings-page .card-wrap article.card.card-meeting-list");
      meetingsTightLayout.narrow.light = await readMeetingRowLayout(lightPage, ".light-shell[data-light-route=\"meetings\"] .meetings-page .card-wrap article.card.card-meeting-list");
      assertTightMeetingRows("dark-meetings-320", meetingsTightLayout.narrow.dark, {
        expectedLeftInset: meetingsTightLayout.standard.dark[0]?.titleLeftInset ?? null,
        requireWrappedRow: true
      });
      assertTightMeetingRows("light-meetings-320", meetingsTightLayout.narrow.light, {
        expectedLeftInset: meetingsTightLayout.standard.light[0]?.titleLeftInset ?? null,
        requireWrappedRow: true
      });
      screenshots.meetingsListNarrow = await saveScreenshot(lightPage, config.reportDir, "10b-light-meetings-list-narrow");
    }

    await backToLightHome(lightPage, config.timeoutMs);
    screenshots.backHome = await saveScreenshot(lightPage, config.reportDir, "11-back-home");
    logAction(actions, "capture_final_dom");
    fs.writeFileSync(finalDomPaths.light, await lightPage.content(), "utf8");
    fs.writeFileSync(finalDomPaths.dark_feed, await darkFeedPage.content(), "utf8");
    fs.writeFileSync(finalDomPaths.dark_meetings, await darkMeetingsPage.content(), "utf8");
    writeJsonFile(consoleJsonPath, consoleEvents);
    writeJsonFile(networkJsonPath, networkEvents);
    writeJsonFile(actionsJsonPath, actions);
    await context.tracing.stop({ path: tracePath });

    const summary = {
      schema: "pucky.light_native_ports_proof.v1",
      ok: true,
      browser_name: config.browserName,
      light_url: config.lightUrl,
      dark_feed_url: config.darkFeedUrl,
      dark_meetings_url: config.darkMeetingsUrl,
      feed_card_count: inboxRows.length,
      meetings_card_count: lightMeetingsRows.length,
      inbox_unread_marker: unreadMarker,
      inbox_action_layout: inboxActionLayout,
      inbox_management: inboxManagement,
      scrollability: {
        dark_feed: darkFeedScroll,
        light_inbox: lightInboxScroll,
        dark_meetings: darkMeetingsScroll
      },
      meetings_tight_layout: meetingsTightLayout,
      comparisons: {
        inbox_rows_match_dark_feed: true,
        meetings_rows_match_dark_meetings: meetingsRowsMatch,
        inbox_title_detail: lightInboxTitleDetail,
        inbox_summary_detail: lightInboxSummaryDetail,
        inbox_attachment_detail: inboxAttachmentDetail,
        inbox_audio_state: lightInboxAudioState,
        inbox_inline_audio_detail: {
          dark_feed: darkFeedInlineAudioDetail,
          light_inbox: lightInboxInlineAudioDetail
        },
        meetings_detail: lightMeetingsDetail,
        meetings_audio: lightMeetingsAudio
      },
      screenshots,
      actions,
      evidence: {
        trace: tracePath,
        console_json: consoleJsonPath,
        network_json: networkJsonPath,
        actions_json: actionsJsonPath,
        final_dom: finalDomPaths,
        video_dir: videoDir,
        videos: {
          light: "",
          dark_feed: "",
          dark_meetings: ""
        }
      }
    };
    await context.close().catch(() => {});
    summary.evidence.videos.light = lightVideo ? await lightVideo.path().catch(() => "") : "";
    summary.evidence.videos.dark_feed = darkFeedVideo ? await darkFeedVideo.path().catch(() => "") : "";
    summary.evidence.videos.dark_meetings = darkMeetingsVideo ? await darkMeetingsVideo.path().catch(() => "") : "";
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await context.tracing.stop({ path: tracePath }).catch(() => {});
    writeJsonFile(consoleJsonPath, consoleEvents);
    writeJsonFile(networkJsonPath, networkEvents);
    writeJsonFile(actionsJsonPath, actions);
    await Promise.all([
      lightPage.content().then((html) => fs.writeFileSync(finalDomPaths.light, html, "utf8")).catch(() => {}),
      darkFeedPage.content().then((html) => fs.writeFileSync(finalDomPaths.dark_feed, html, "utf8")).catch(() => {}),
      darkMeetingsPage.content().then((html) => fs.writeFileSync(finalDomPaths.dark_meetings, html, "utf8")).catch(() => {})
    ]);
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
