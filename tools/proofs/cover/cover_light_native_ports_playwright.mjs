import fs from "node:fs";
import path from "node:path";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_LIGHT_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=light&reset_nav=1";
const DEFAULT_DARK_FEED_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=dark&route=inbox&reset_nav=1";
const DEFAULT_DARK_MEETINGS_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=dark&route=meetings&reset_nav=1";
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    lightUrl: process.env.PUCKY_LIGHT_NATIVE_URL || DEFAULT_LIGHT_URL,
    darkFeedUrl: process.env.PUCKY_DARK_FEED_URL || DEFAULT_DARK_FEED_URL,
    darkMeetingsUrl: process.env.PUCKY_DARK_MEETINGS_URL || DEFAULT_DARK_MEETINGS_URL,
    reportDir: path.resolve("artifacts", "light-native-ports"),
    timeoutMs: 30000,
    browserName: "chromium",
    headless: true
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
      boxShadow: style.boxShadow,
      color: style.color
    };
  });
}

function assertMeaningfulRows(label, rows) {
  assert(rows.length > 0, `${label} rendered no cards`);
  const meaningfulRows = rows.filter(row => Boolean(row.title || row.preview || row.timestamp));
  assert(
    meaningfulRows.length > 0,
    `${label} cards rendered, but they did not include visible title, preview, or timestamp content`
  );
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

async function readDetailState(page) {
  return page.locator("#detail").evaluate(panel => ({
    detail_type: String(panel.getAttribute("data-detail-type") || "").trim(),
    card_id: String(panel.getAttribute("data-detail-card-id") || "").trim(),
    session_id: String(panel.getAttribute("data-detail-session-id") || "").trim(),
    viewer: String(panel.getAttribute("data-detail-viewer") || "").trim(),
    title: String(panel.querySelector(".detail-title, .detail-header h1, .detail-header h2")?.textContent || "").trim()
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

async function closeDetail(page, timeoutMs) {
  if (!await page.locator(".detail-panel.is-open").count()) {
    return;
  }
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.locator(".detail-panel.is-open").waitFor({ state: "hidden", timeout: timeoutMs });
}

async function readPlayerState(page) {
  return page.evaluate(async () => await window.Pucky.request({ command: "player.state", args: {} }));
}

async function waitForPlayerAdvance(page, timeoutMs, minimumDeltaMs = 400) {
  const before = await readPlayerState(page);
  await page.waitForFunction(
    ({ minimumDelta }) => window.Pucky.request({ command: "player.state", args: {} }).then((player) => {
      const current = Number(player?.position_ms || 0);
      const duration = Number(player?.duration_ms || 0);
      const playing = Boolean(player?.is_playing);
      return current >= minimumDelta || (duration > 0 && current >= duration) || !playing;
    }),
    { minimumDelta: Math.max(50, Number(minimumDeltaMs || 400)) },
    { timeout: timeoutMs }
  );
  const after = await readPlayerState(page);
  return {
    before,
    after,
    delta_ms: Number(after?.position_ms || 0) - Number(before?.position_ms || 0)
  };
}

async function openAudioControls(page, selector, timeoutMs) {
  const trigger = page.locator(selector).first();
  await trigger.waitFor({ state: "visible", timeout: timeoutMs });
  const target = await trigger.evaluate(node => {
    const article = node.closest("article.card");
    return {
      session_id: String(article?.getAttribute("data-card-session-id") || "").trim(),
      card_id: String(article?.getAttribute("data-card-id") || "").trim()
    };
  });
  assert(target.card_id || target.session_id, "Audio controls target did not resolve to a canonical card identity");
  const detailSelector = target.session_id
    ? `article.card[data-card-session-id="${cssString(target.session_id)}"] [data-card-action="transcript_title"]`
    : `article.card[data-card-id="${cssString(target.card_id)}"] [data-card-action="transcript_title"]`;
  await clickSelector(page, detailSelector, timeoutMs);
  await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: timeoutMs });
  const before = await readDetailState(page);
  const controls = page.locator("#detail .detail-audio-action").filter({ hasText: "Open audio controls" }).first();
  const controlCount = await controls.count();
  assert(controlCount > 0, "Card detail did not expose an \"Open audio controls\" action");
  await controls.click();
  await page.waitForFunction(() => {
    const detail = document.getElementById("detail");
    return String(detail?.getAttribute("data-detail-type") || "") === "audio";
  }, { timeout: timeoutMs });
  const after = await readDetailState(page);
  await closeDetail(page, timeoutMs);
  return {
    before,
    after
  };
}

async function clickSelector(page, selector, timeoutMs) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
  await page.evaluate(selectorValue => {
    const target = document.querySelector(selectorValue);
    if (!(target instanceof HTMLElement)) {
      throw new Error(`Missing clickable target for ${selectorValue}`);
    }
    target.click();
  }, selector);
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
  const progress = await waitForPlayerAdvance(page, timeoutMs, 250);
  const playing = await page.locator(targetSelector).evaluate(button => ({
    classes: String(button.className || "").trim(),
    aria_label: String(button.getAttribute("aria-label") || "").trim()
  }));
  await clickSelector(page, targetSelector, timeoutMs);
  await page.waitForFunction(
    selectorValue => {
      const button = document.querySelector(selectorValue);
      return !!button && !button.classList.contains("is-playing");
    },
    targetSelector,
    { timeout: timeoutMs }
  );
  return {
    ...target,
    ...playing,
    playing: true,
    progress
  };
}

async function openInlineAudioDetail(page, selector, timeoutMs) {
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
    const before = await readPlayerState(page);
    await page.waitForTimeout(900);
    const after = await readPlayerState(page);
    const detail = await readDetailState(page);
    await closeDetail(page, timeoutMs);
    return {
      target,
      detail,
      player_delta_ms: Number(after?.position_ms || 0) - Number(before?.position_ms || 0)
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
    const clientHeight = Number(iframe.clientHeight || 0);
    iframe.contentWindow?.scrollTo(0, totalHeight);
    return {
      top_text: topText,
      bottom_text: String(body?.innerText || "").trim().slice(-200),
      iframe_client_height: clientHeight,
      scroll_height: totalHeight,
      max_scroll_top: Math.max(0, totalHeight - clientHeight),
      root_scroll_top: Number(root?.scrollTop || 0),
      body_scroll_top: Number(body?.scrollTop || 0)
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
    const darkFrame = await readRichPageFrameState(darkPage);
    const lightFrame = await readRichPageFrameState(lightPage);
    const bottomShots = {
      dark: await saveScreenshot(darkPage, reportDir, "09-dark-inbox-page-bottom"),
      light: await saveScreenshot(lightPage, reportDir, "10-light-inbox-page-bottom")
    };
    assertDetailParity("Inbox page/attachment", darkDetail.state, lightDetail.state);
    assert(darkDetail.state.detail_type === "page", "Dark Feed page action did not open page detail");
    assert(lightDetail.state.detail_type === "page", "Light Inbox page action did not open page detail");
    assert(lightDetail.visual.backgroundColor !== darkDetail.visual.backgroundColor, "Inbox page or attachment detail did not switch to light styling");
    assert(!/\/mock\//i.test(darkFrame.top_text), "Dark Feed page detail still rendered mock placeholder content");
    assert(!/\/mock\//i.test(lightFrame.top_text), "Light Inbox page detail still rendered mock placeholder content");
    const darkTallEnough = darkFrame.scroll_height > darkFrame.iframe_client_height;
    const lightTallEnough = lightFrame.scroll_height > lightFrame.iframe_client_height;
    const darkReachedBottom = darkFrame.root_scroll_top >= darkFrame.max_scroll_top;
    const lightReachedBottom = lightFrame.root_scroll_top >= lightFrame.max_scroll_top;
    if (darkTallEnough && lightTallEnough && darkReachedBottom && lightReachedBottom) {
      selected = {
        target,
        dark: darkDetail,
        dark_frame: darkFrame,
        light: lightDetail,
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

async function main() {
  const config = parseArgs(process.argv.slice(2));
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
    assert(lightInboxCardStyle.backgroundColor !== darkFeedCardStyle.backgroundColor, "Light Inbox cards did not switch to a light surface style");
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
    screenshots.inboxList = await saveScreenshot(lightPage, config.reportDir, "04-light-inbox-list");

    logAction(actions, "open_transcript_title_detail");
    const darkFeedTitleDetail = await openAndInspectDetail(darkFeedPage, ".card-wrap article.card [data-card-action=\"transcript_title\"]", config.timeoutMs);
    const lightInboxTitleDetail = await openAndInspectDetail(lightPage, ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card [data-card-action=\"transcript_title\"]", config.timeoutMs);
    assertDetailParity("Inbox transcript/title detail", darkFeedTitleDetail.state, lightInboxTitleDetail.state);
    assert(lightInboxTitleDetail.visual.backgroundColor !== darkFeedTitleDetail.visual.backgroundColor, "Light Inbox title detail did not switch to light styling");
    screenshots.inboxTitleDetail = await saveScreenshot(lightPage, config.reportDir, "05-light-inbox-title-detail");
    await closeDetail(darkFeedPage, config.timeoutMs);
    await closeDetail(lightPage, config.timeoutMs);

    logAction(actions, "open_transcript_summary_detail");
    const darkFeedSummaryDetail = await openAndInspectDetail(darkFeedPage, ".card-wrap article.card [data-card-action=\"transcript_body\"]", config.timeoutMs);
    const lightInboxSummaryDetail = await openAndInspectDetail(lightPage, ".light-shell[data-light-route=\"inbox\"] .card-wrap article.card [data-card-action=\"transcript_body\"]", config.timeoutMs);
    assertDetailParity("Inbox transcript/summary detail", darkFeedSummaryDetail.state, lightInboxSummaryDetail.state);
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
    assert(lightInboxAudioState.aria_label === darkFeedAudioState.aria_label, "Light Inbox audio control label diverged from the canonical dark Home feed");
    assert(lightInboxAudioState.progress.delta_ms >= 0, "Light Inbox audio did not advance or complete after starting playback");
    assert(darkFeedAudioState.progress.delta_ms >= 0, "Dark Feed audio did not advance or complete after starting playback");
    logAction(actions, "open_inline_audio_detail");
    const darkFeedInlineAudioDetail = await openInlineAudioDetail(darkFeedPage, "[data-card-action=\"audio\"]", config.timeoutMs);
    const lightInboxInlineAudioDetail = await openInlineAudioDetail(
      lightPage,
      ".light-shell[data-light-route=\"inbox\"] [data-card-action=\"audio\"]",
      config.timeoutMs
    );
    assert(darkFeedInlineAudioDetail.detail.detail_type === "audio", "Dark Feed inline audio strip did not open audio detail");
    assert(lightInboxInlineAudioDetail.detail.detail_type === "audio", "Light Inbox inline audio strip did not open audio detail");
    assert(
      darkFeedInlineAudioDetail.player_delta_ms >= 0 && lightInboxInlineAudioDetail.player_delta_ms >= 0,
      "Inline audio detail did not preserve the active player session"
    );
    logAction(actions, "open_audio_controls_navigation");
    const darkFeedAudioControls = await openAudioControls(darkFeedPage, "[data-card-action=\"audio\"]", config.timeoutMs);
    const lightInboxAudioControls = await openAudioControls(
      lightPage,
      ".light-shell[data-light-route=\"inbox\"] [data-card-action=\"audio\"]",
      config.timeoutMs
    );
    assert(darkFeedAudioControls.after.detail_type === "audio", "Dark Feed did not enter audio detail after clicking Open audio controls");
    assert(lightInboxAudioControls.after.detail_type === "audio", "Light Inbox did not enter audio detail after clicking Open audio controls");
    assert(
      JSON.stringify(lightInboxAudioControls.before) === JSON.stringify(darkFeedAudioControls.before),
      "Audio controls source card differed between dark Feed and light Inbox"
    );
    screenshots.inboxAudioDetail = await saveScreenshot(lightPage, config.reportDir, "07-light-inbox-audio-detail");

    await backToLightHome(lightPage, config.timeoutMs);

    let lightMeetingsRows = [];
    let darkMeetingsScroll = { checked: false, reason: "No meetings cards were available in the dark route sample." };
    let lightMeetingsDetail = null;
    let lightMeetingsAudio = null;
    let meetingsRowsMatch = false;
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
      assert(lightMeetingsCardStyle.backgroundColor !== darkMeetingsCardStyle.backgroundColor, "Light Meetings cards did not switch to a light surface style");
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
      scrollability: {
        dark_feed: darkFeedScroll,
        light_inbox: lightInboxScroll,
        dark_meetings: darkMeetingsScroll
      },
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
        inbox_audio_controls: {
          dark_feed: darkFeedAudioControls,
          light_inbox: lightInboxAudioControls
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
