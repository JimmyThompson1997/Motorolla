import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "./cover_shared.mjs";

const DEFAULT_BASE_URL = "https://pucky.fly.dev";
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    baseUrl: process.env.PUCKY_CANONICAL_LIGHT_BASE_URL || DEFAULT_BASE_URL,
    mode: process.env.PUCKY_CANONICAL_LIGHT_MODE || "full",
    reportDir: path.resolve("artifacts", "canonical-native-light-theme", new Date().toISOString().replace(/[:.]/g, "-")),
    timeoutMs: 30000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--base-url" && argv[index + 1]) {
      config.baseUrl = String(argv[++index] || config.baseUrl).trim().replace(/\/+$/, "");
    } else if (arg === "--mode" && argv[index + 1]) {
      config.mode = String(argv[++index] || config.mode).trim().toLowerCase();
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = String(argv[++index] || config.reportDir);
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    }
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cssString(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function parseRgb(color) {
  const match = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNearColor(color, target, tolerance = 12) {
  const left = parseRgb(color);
  const right = parseRgb(target);
  if (!left || !right) {
    return false;
  }
  return left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

function assertGeometryParity(before, after, tolerance = 1.5) {
  for (const selector of Object.keys(before)) {
    const left = before[selector];
    const right = after[selector];
    assert(left, `Missing dark geometry for ${selector}`);
    assert(right, `Missing light geometry for ${selector}`);
    for (const field of ["x", "y", "width", "height"]) {
      const delta = Math.abs(Number(left[field] || 0) - Number(right[field] || 0));
      assert(delta <= tolerance, `Theme toggle changed ${selector} ${field} by ${delta}px`);
    }
  }
}

function buildPageUrl(baseUrl, { theme = "dark", route = "", resetNav = true, preview = "" } = {}) {
  const url = new URL(`${String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/ui/pucky/latest/index.html`);
  if (theme) {
    url.searchParams.set("theme", theme);
  }
  if (route) {
    url.searchParams.set("route", route);
  }
  if (resetNav) {
    url.searchParams.set("reset_nav", "1");
  }
  if (preview) {
    url.searchParams.set("preview", preview);
  }
  return url.toString();
}

async function waitForShellRoute(page, { theme, route, readySelector, timeoutMs }) {
  await page.waitForFunction(
    ({ expectedTheme, expectedRoute, expectedReadySelector }) => {
      const shell = document.querySelector(".app-shell");
      if (!shell) {
        return false;
      }
      if (shell.getAttribute("data-theme") !== expectedTheme) {
        return false;
      }
      const canonicalRoute = shell.getAttribute("data-canonical-route") || shell.getAttribute("data-view") || "";
      if (canonicalRoute !== expectedRoute) {
        return false;
      }
      return Boolean(document.querySelector(expectedReadySelector));
    },
    {
      expectedTheme: theme,
      expectedRoute: route,
      expectedReadySelector: readySelector
    },
    { timeout: timeoutMs }
  );
}

async function gotoPage(page, url, timeoutMs) {
  await page.goto(url, { waitUntil: "commit", timeout: timeoutMs });
}

async function reloadPage(page, timeoutMs) {
  await page.reload({ waitUntil: "commit", timeout: timeoutMs });
}

async function waitForSettings(page, theme, timeoutMs) {
  await waitForShellRoute(page, {
    theme,
    route: "settings",
    readySelector: ".settings-page",
    timeoutMs
  });
}

async function waitForFeed(page, theme, timeoutMs) {
  await waitForShellRoute(page, {
    theme,
    route: "feed",
    readySelector: "#feed article.card, #feed .feed-load-error, #feed .empty",
    timeoutMs
  });
}

async function waitForLinks(page, theme, timeoutMs) {
  await waitForShellRoute(page, {
    theme,
    route: "links",
    readySelector: ".links-page .links-app-row, .links-page .links-empty, .links-page .links-message",
    timeoutMs
  });
}

async function waitForMeetings(page, theme, timeoutMs) {
  await waitForShellRoute(page, {
    theme,
    route: "meetings",
    readySelector: ".meetings-page",
    timeoutMs
  });
}

async function clickTab(page, label, timeoutMs) {
  const button = page.locator(`.page-tabs .tab[aria-label="${label}"]`);
  await button.first().waitFor({ state: "visible", timeout: timeoutMs });
  await button.first().click();
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
      identity_class: String(node.querySelector(".identity")?.className || "").trim(),
      action_classes: Array.from(node.querySelectorAll("[data-card-action]")).map(action => String(action.className || "").trim()),
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

function rowStableId(row) {
  return String(row?.session_id || row?.card_id || "").trim();
}

function rowsStableOverlap(leftRows, rightRows, minimumMatches = 5) {
  const rightById = new Map(
    rightRows
      .map(row => [rowStableId(row), row])
      .filter(([id]) => Boolean(id))
  );
  let matches = 0;
  for (const leftRow of leftRows) {
    const id = rowStableId(leftRow);
    const rightRow = rightById.get(id);
    if (!id || !rightRow) {
      continue;
    }
    if (
      leftRow.title === rightRow.title
      && leftRow.timestamp === rightRow.timestamp
      && leftRow.classes === rightRow.classes
    ) {
      matches += 1;
    }
  }
  return {
    matches,
    required: Math.min(minimumMatches, leftRows.length, rightRows.length),
    left_count: leftRows.length,
    right_count: rightRows.length
  };
}

async function extractLinksRows(page, limit = 10) {
  return page.locator(".links-app-row").evaluateAll((nodes, maxRows) =>
    nodes.slice(0, maxRows).map(node => ({
      slug: String(node.getAttribute("data-links-slug") || "").trim(),
      classes: String(node.className || "").trim(),
      name: String(node.querySelector(".links-app-name")?.textContent || "").trim(),
      auth: String(node.querySelector(".links-app-auth")?.textContent || "").trim(),
      connected: node.querySelector(".links-app-mark")?.classList.contains("is-connected") || false
    })),
    limit
  );
}

async function readThemeState(page) {
  return page.evaluate(() => ({
    theme: document.querySelector(".app-shell")?.getAttribute("data-theme") || "",
    stored_theme: localStorage.getItem("pucky.cover.theme.v1") || "",
    route: document.querySelector(".app-shell")?.getAttribute("data-view") || "",
    canonical_route: document.querySelector(".app-shell")?.getAttribute("data-canonical-route") || ""
  }));
}

async function captureGeometry(page, selectors) {
  return page.evaluate(activeSelectors => Object.fromEntries(
    activeSelectors.map(selector => {
      const node = document.querySelector(selector);
      if (!(node instanceof HTMLElement)) {
        return [selector, null];
      }
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return [selector, {
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
        padding_top: style.paddingTop,
        padding_right: style.paddingRight,
        padding_bottom: style.paddingBottom,
        padding_left: style.paddingLeft,
        margin_top: style.marginTop,
        margin_right: style.marginRight,
        margin_bottom: style.marginBottom,
        margin_left: style.marginLeft,
        display: style.display,
        position: style.position
      }];
    })
  ), selectors);
}

async function extractFeedForegrounds(page, selector, limit = 5) {
  return page.locator(selector).evaluateAll((nodes, maxRows) =>
    nodes.slice(0, maxRows).map(node => {
      const title = node.querySelector(".title");
      const preview = node.querySelector(".preview");
      const timestamp = node.querySelector(".card-timestamp");
      const identity = node.querySelector(".identity");
      const actions = Array.from(node.querySelectorAll("[data-card-action]"));
      const styleOf = element => element ? window.getComputedStyle(element) : null;
      const nodeStyle = window.getComputedStyle(node);
      return {
        card_id: String(node.getAttribute("data-card-id") || "").trim(),
        session_id: String(node.getAttribute("data-card-session-id") || "").trim(),
        title: String(title?.textContent || "").trim(),
        title_color: styleOf(title)?.color || "",
        preview_color: styleOf(preview)?.color || "",
        timestamp_color: styleOf(timestamp)?.color || "",
        identity_class: String(identity?.className || "").trim(),
        identity_color: styleOf(identity)?.color || "",
        action_classes: actions.map(action => String(action.className || "").trim()),
        action_colors: actions.map(action => window.getComputedStyle(action).color),
        background_color: nodeStyle.backgroundColor,
        border_color: nodeStyle.borderColor
      };
    }),
    limit
  );
}

async function extractMeetingsForegrounds(page, selector, limit = 5) {
  return page.locator(selector).evaluateAll((nodes, maxRows) =>
    nodes.slice(0, maxRows).map(node => {
      const title = node.querySelector(".title");
      const timestamp = node.querySelector(".card-timestamp");
      const actions = Array.from(node.querySelectorAll("[data-card-action]"));
      const styleOf = element => element ? window.getComputedStyle(element) : null;
      const nodeStyle = window.getComputedStyle(node);
      return {
        card_id: String(node.getAttribute("data-card-id") || "").trim(),
        session_id: String(node.getAttribute("data-card-session-id") || "").trim(),
        title: String(title?.textContent || "").trim(),
        title_color: styleOf(title)?.color || "",
        timestamp_color: styleOf(timestamp)?.color || "",
        action_classes: actions.map(action => String(action.className || "").trim()),
        action_colors: actions.map(action => window.getComputedStyle(action).color),
        background_color: nodeStyle.backgroundColor,
        border_color: nodeStyle.borderColor,
        classes: String(node.className || "").trim()
      };
    }),
    limit
  );
}

function assertNoWhiteOnWhiteForegrounds(rows, label) {
  const darkWhite = "rgb(245, 249, 255)";
  for (const row of rows) {
    assert(!isNearColor(row.title_color, darkWhite), `${label} title stayed dark-theme white for ${row.title || row.card_id || "unknown row"}`);
    if (row.preview_color) {
      assert(!isNearColor(row.preview_color, darkWhite), `${label} preview stayed dark-theme white for ${row.title || row.card_id || "unknown row"}`);
    }
    if (row.timestamp_color) {
      assert(!isNearColor(row.timestamp_color, darkWhite), `${label} timestamp stayed dark-theme white for ${row.title || row.card_id || "unknown row"}`);
    }
    if (row.identity_color) {
      assert(!isNearColor(row.identity_color, darkWhite), `${label} identity icon stayed dark-theme white for ${row.title || row.card_id || "unknown row"}`);
    }
    for (const [index, color] of (row.action_colors || []).entries()) {
      assert(!isNearColor(color, darkWhite), `${label} action icon ${index} stayed dark-theme white for ${row.title || row.card_id || "unknown row"}`);
    }
  }
}

async function openAppearanceSelector(page, timeoutMs) {
  const button = page.locator('[data-setting-id="appearance"] .settings-selector-button');
  await button.waitFor({ state: "visible", timeout: timeoutMs });
  await button.click();
  await page.locator(".settings-selector-sheet").waitFor({ state: "visible", timeout: timeoutMs });
}

async function chooseAppearance(page, theme, timeoutMs) {
  await openAppearanceSelector(page, timeoutMs);
  const option = page.locator(`.settings-selector-option[data-selector-value="${theme}"]`);
  await option.waitFor({ state: "visible", timeout: timeoutMs });
  await option.click();
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
      is_card_body: node.classList.contains("card-body"),
      is_identity: node.classList.contains("identity")
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
  if (target.is_identity && (target.session_id || target.card_id)) {
    return target.session_id
      ? `article.card[data-card-session-id="${cssString(target.session_id)}"] .identity`
      : `article.card[data-card-id="${cssString(target.card_id)}"] .identity`;
  }
  return selector;
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

async function readDetailState(page) {
  return page.locator("#detail").evaluate(panel => ({
    detail_type: String(panel.getAttribute("data-detail-type") || "").trim(),
    card_id: String(panel.getAttribute("data-detail-card-id") || "").trim(),
    session_id: String(panel.getAttribute("data-detail-session-id") || "").trim(),
    viewer: String(panel.getAttribute("data-detail-viewer") || "").trim(),
    title: String(panel.querySelector(".detail-title, .detail-header h1, .detail-header h2")?.textContent || "").trim(),
    bubble_count: panel.querySelectorAll(".bubble").length,
    rendered_doc: Boolean(panel.querySelector(".document-rendered, .text-viewer, .table-viewer, .attachment-audio-card, .video-detail, .image-gallery-track, audio, iframe, object, embed"))
  }));
}

async function closeDetail(page, timeoutMs) {
  if (!await page.locator(".detail-panel.is-open").count()) {
    return;
  }
  await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
  await page.locator(".detail-panel.is-open").waitFor({ state: "hidden", timeout: timeoutMs });
}

async function openDetail(page, selector, timeoutMs) {
  const targetSelector = await stableCardSelector(page, selector, timeoutMs);
  await clickSelector(page, targetSelector, timeoutMs);
  await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: timeoutMs });
  return readDetailState(page);
}

async function toggleReadRoundTrip(page, timeoutMs) {
  const unreadCardSelector = "article.card.card-unread:not(.card-meeting-processing):not(.card-outbound)";
  const unreadIdentity = page.locator(`${unreadCardSelector} .identity.is-unread`).first();
  await unreadIdentity.waitFor({ state: "visible", timeout: timeoutMs });
  const initialUnreadCount = await page.locator("article.card.card-unread").count();
  const selector = await stableCardSelector(page, `${unreadCardSelector} .identity.is-unread`, timeoutMs);
  const cardSelector = selector.replace(/ \.identity$/, "");
  await clickSelector(page, selector, timeoutMs);
  await page.waitForFunction(
    ({ selectorValue, expectedUnreadCount }) => {
      const card = document.querySelector(selectorValue);
      const unreadCount = document.querySelectorAll("article.card.card-unread").length;
      return unreadCount <= expectedUnreadCount
        && (
          !card
        || !card.classList.contains("card-unread")
        || Boolean(card.querySelector(".identity.is-read"))
        );
    },
    { selectorValue: cardSelector, expectedUnreadCount: Math.max(0, initialUnreadCount - 1) },
    { timeout: timeoutMs }
  );
  const afterRead = await page.locator(cardSelector).evaluate(node => ({
    classes: String(node.className || "").trim(),
    identity_class: String(node.querySelector(".identity")?.className || "").trim()
  }));
  await page.waitForTimeout(1000);
  await clickSelector(page, selector, timeoutMs);
  await page.waitForFunction(
    ({ selectorValue, expectedUnreadCount }) => {
      const card = document.querySelector(selectorValue);
      const unreadCount = document.querySelectorAll("article.card.card-unread").length;
      return unreadCount >= expectedUnreadCount
        && Boolean(card?.classList.contains("card-unread") && card.querySelector(".identity.is-unread"));
    },
    { selectorValue: cardSelector, expectedUnreadCount: initialUnreadCount },
    { timeout: timeoutMs }
  );
  const afterUnread = await page.locator(cardSelector).evaluate(node => ({
    classes: String(node.className || "").trim(),
    identity_class: String(node.querySelector(".identity")?.className || "").trim()
  }));
  return {
    card_selector: cardSelector,
    initial_unread_count: initialUnreadCount,
    after_read: afterRead,
    after_unread: afterUnread
  };
}

async function playerState(page) {
  return page.evaluate(async () => {
    if (!window.Pucky || typeof window.Pucky.request !== "function") {
      return { error: "Pucky.request unavailable" };
    }
    try {
      return await window.Pucky.request({ command: "player.state", args: {} });
    } catch (error) {
      return { error: String(error?.message || error || "player.state failed") };
    }
  });
}

async function measureFeedAudioProgress(page, timeoutMs) {
  const selector = await stableCardSelector(page, 'article.card [data-card-action="audio"]', timeoutMs);
  await clickSelector(page, selector, timeoutMs);
  await page.waitForFunction(selectorValue => document.querySelector(selectorValue)?.classList.contains("is-playing") || Boolean(document.querySelector("#detail .audio-detail, #detail audio")), selector, { timeout: timeoutMs });
  const samples = [];
  let advanced = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.waitForTimeout(1000);
    const state = await playerState(page);
    samples.push(state);
    if (Number(state?.position_ms || 0) > 0) {
      advanced = true;
      break;
    }
  }
  await clickSelector(page, selector, timeoutMs).catch(() => {});
  return { selector, advanced, samples };
}

async function measureMeetingAudioProgress(page, timeoutMs) {
  const detail = await openDetail(page, '.card-meeting-list [data-card-action="audio"]', timeoutMs);
  const media = await page.evaluate(async () => {
    const audio = document.querySelector("#detail audio");
    if (!(audio instanceof HTMLMediaElement)) {
      return { kind: "no-audio-element" };
    }
    let playError = "";
    try {
      await Promise.race([
        audio.play(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("audio.play timeout")), 1500))
      ]);
    } catch (error) {
      playError = String(error?.message || error || "audio.play failed");
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
    return {
      kind: "audio-element",
      current_time: Number(audio.currentTime || 0),
      paused: Boolean(audio.paused),
      error: audio.error ? String(audio.error.message || audio.error.code || "") : playError,
      src: String(audio.currentSrc || audio.src || "")
    };
  });
  const player = await playerState(page);
  await closeDetail(page, timeoutMs);
  return {
    detail,
    media,
    player,
    advanced: Number(media.current_time || 0) > 0 || Number(player?.position_ms || 0) > 0
  };
}

async function runLinksSearchProof(page, timeoutMs) {
  await page.locator(".links-search").waitFor({ state: "visible", timeout: timeoutMs });
  const rowsBefore = await extractLinksRows(page, 10);
  assert(rowsBefore.length > 0, "Links page rendered no visible rows");
  const firstName = normalizeText(rowsBefore[0]?.name || "");
  assert(firstName, "Links page did not expose a searchable app name");
  const query = firstName.slice(0, Math.min(firstName.length, 6));
  await page.locator(".links-search").fill(query);
  await page.waitForTimeout(500);
  const rowsAfter = await extractLinksRows(page, 10);
  assert(rowsAfter.length > 0, `Links search for "${query}" returned no rows`);
  assert(rowsAfter.every(row => normalizeText(row.name).toLowerCase().includes(query.toLowerCase())), `Links search did not filter rows by "${query}"`);
  return { query, before: rowsBefore, after: rowsAfter };
}

async function runLinksOpenProof(page, requestLog, timeoutMs, expectedUrl = "") {
  const row = page.locator(".links-app-row").first();
  await row.waitFor({ state: "visible", timeout: timeoutMs });
  const beforeCount = requestLog.length;
  const target = await row.evaluate(node => ({
    slug: String(node.getAttribute("data-links-slug") || "").trim(),
    name: String(node.querySelector(".links-app-name")?.textContent || "").trim()
  }));
  await row.click();
  await page.waitForTimeout(1200);
  const after = await row.evaluate(node => ({
    classes: String(node.className || "").trim()
  }));
  const recentRequests = requestLog.slice(beforeCount).map(item => item.url);
  const linksMessage = await page.locator(".links-message").count()
    ? normalizeText(await page.locator(".links-message").first().textContent())
    : "";
  const currentUrl = page.url();
  assert(
    after.classes.includes("is-opening")
      || recentRequests.some(url => /\/api\/links\/composio\/oauth\/start/i.test(url))
      || (expectedUrl ? currentUrl !== expectedUrl : false)
      || Boolean(linksMessage),
    "Clicking a Links app did not trigger a visible canonical handoff state"
  );
  return {
    ...target,
    row_classes: after.classes,
    recent_requests: recentRequests.slice(0, 10),
    links_message: linksMessage,
    current_url: currentUrl
  };
}

async function collectTabSmoke(page, theme, timeoutMs) {
  const expectations = [
    { label: "Home", route: "feed", wait: waitForFeed },
    { label: "Links", route: "links", wait: waitForLinks },
    { label: "Meetings", route: "meetings", wait: waitForMeetings },
    { label: "Morning", route: "morning", readySelector: ".placeholder-page" },
    { label: "Calls", route: "calls", readySelector: ".placeholder-page" },
    { label: "Settings", route: "settings", wait: waitForSettings }
  ];
  const results = [];
  for (const entry of expectations) {
    await clickTab(page, entry.label, timeoutMs);
    if (entry.wait) {
      await entry.wait(page, theme, timeoutMs);
    } else {
      await waitForShellRoute(page, {
        theme,
        route: entry.route,
        readySelector: entry.readySelector || ".placeholder-page",
        timeoutMs
      });
    }
    results.push(await readThemeState(page));
  }
  return results;
}

function pushBlocker(summary, blocker) {
  summary.blockers.push(blocker);
}

function attachRequestLogging(context, requestLog) {
  context.on("request", request => {
    requestLog.push({
      at: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      resource_type: request.resourceType()
    });
  });
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);

  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    screen: VIEWPORT,
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir: config.reportDir, size: VIEWPORT }
  });
  const requestLog = [];
  attachRequestLogging(context, requestLog);
  await context.tracing.start({ screenshots: true, snapshots: true });

  const page = await context.newPage();
  attachPageLogging(page, path.join(config.reportDir, "browser-console.log"));

  const summary = {
    schema: "pucky.canonical_native_light_theme_proof.v1",
    ok: false,
    mode: config.mode,
    base_url: config.baseUrl,
    screenshots: {},
    dark_baseline: {},
    light: {},
    dark_regression: {},
    blockers: []
  };

  try {
    const darkSettingsUrl = buildPageUrl(config.baseUrl, { theme: "dark", route: "settings" });
    const darkFeedUrl = buildPageUrl(config.baseUrl, { theme: "dark", route: "feed" });
    const darkLinksUrl = buildPageUrl(config.baseUrl, { theme: "dark", route: "links" });
    const darkMeetingsUrl = buildPageUrl(config.baseUrl, { theme: "dark", route: "meetings" });

    await gotoPage(page, darkSettingsUrl, config.timeoutMs);
    await waitForSettings(page, "dark", config.timeoutMs);
    summary.dark_baseline.settings = await readThemeState(page);
    summary.screenshots["01-dark-settings-baseline"] = await saveScreenshot(page, config.reportDir, "01-dark-settings-baseline");

    await gotoPage(page, darkFeedUrl, config.timeoutMs);
    await waitForFeed(page, "dark", config.timeoutMs);
    summary.dark_baseline.feed_rows = await extractCardRows(page, "#feed article.card", 10);
    summary.dark_baseline.feed_audio = await measureFeedAudioProgress(page, config.timeoutMs);
    summary.screenshots["02-dark-home-baseline"] = await saveScreenshot(page, config.reportDir, "02-dark-home-baseline");

    await gotoPage(page, darkLinksUrl, config.timeoutMs);
    await waitForLinks(page, "dark", config.timeoutMs);
    summary.dark_baseline.links_rows = await extractLinksRows(page, 10);
    summary.dark_baseline.links_search = await runLinksSearchProof(page, config.timeoutMs);
    await page.locator(".links-search").fill("");
    await page.waitForTimeout(500);
    summary.screenshots["03-dark-links-baseline"] = await saveScreenshot(page, config.reportDir, "03-dark-links-baseline");

    await gotoPage(page, darkMeetingsUrl, config.timeoutMs);
    await waitForMeetings(page, "dark", config.timeoutMs);
    summary.dark_baseline.meeting_rows = await extractCardRows(page, ".meetings-page article.card", 10);
    summary.dark_baseline.meeting_audio = await measureMeetingAudioProgress(page, config.timeoutMs);
    summary.screenshots["04-dark-meetings-baseline"] = await saveScreenshot(page, config.reportDir, "04-dark-meetings-baseline");

    if (!summary.dark_baseline.feed_audio.advanced) {
      pushBlocker(summary, {
        code: "dark_feed_audio_no_progress",
        message: "Dark Home feed audio icon did not advance playback progress.",
        evidence: summary.dark_baseline.feed_audio
      });
    }
    if (!summary.dark_baseline.meeting_audio.advanced) {
      pushBlocker(summary, {
        code: "dark_meetings_audio_no_progress",
        message: "Dark Meetings audio detail did not advance playback progress.",
        evidence: summary.dark_baseline.meeting_audio
      });
    }

    if (config.mode === "baseline") {
      summary.ok = summary.blockers.length === 0;
      writeJsonFile(path.join(config.reportDir, "network.json"), requestLog);
      writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
      await context.tracing.stop({ path: path.join(config.reportDir, "trace.zip") });
      return;
    }

    await gotoPage(page, darkSettingsUrl, config.timeoutMs);
    await waitForSettings(page, "dark", config.timeoutMs);
    summary.screenshots["05-settings-before-toggle"] = await saveScreenshot(page, config.reportDir, "05-settings-before-toggle");
    const geometrySelectors = [".app-shell", ".header", "#pageTabs", "#feed", ".settings-page"];
    const darkSettingsGeometry = await captureGeometry(page, geometrySelectors);
    await chooseAppearance(page, "light", config.timeoutMs);
    await pageWaitForTheme(page, "light", config.timeoutMs);
    summary.light.settings_after_toggle = await readThemeState(page);
    assert(summary.light.settings_after_toggle.theme === "light", "Appearance selector did not switch the app shell to light");
    assert(summary.light.settings_after_toggle.stored_theme === "light", "Appearance selector did not persist the light theme");
    assert(summary.light.settings_after_toggle.route === "settings", "Appearance selector should keep the Settings route active");
    const lightSettingsGeometry = await captureGeometry(page, geometrySelectors);
    summary.light.settings_geometry = {
      dark: darkSettingsGeometry,
      light: lightSettingsGeometry
    };
    assertGeometryParity(darkSettingsGeometry, lightSettingsGeometry);
    writeJsonFile(path.join(config.reportDir, "01-02-settings-geometry.json"), summary.light.settings_geometry);
    summary.screenshots["06-settings-after-toggle-light"] = await saveScreenshot(page, config.reportDir, "06-settings-after-toggle-light");

    await reloadPage(page, config.timeoutMs);
    await waitForSettings(page, "light", config.timeoutMs);
    summary.light.settings_after_reload = await readThemeState(page);
    assert(summary.light.settings_after_reload.theme === "light", "Light theme did not survive reload");
    assert(summary.light.settings_after_reload.stored_theme === "light", "Reload lost the persisted light theme");
    summary.screenshots["07-settings-after-reload-light"] = await saveScreenshot(page, config.reportDir, "07-settings-after-reload-light");

    await gotoPage(page, buildPageUrl(config.baseUrl, { theme: "light", route: "feed" }), config.timeoutMs);
    await waitForFeed(page, "light", config.timeoutMs);
    assert(await page.locator(".light-shell").count() === 0, "Native light Home should not render through .light-shell");
    summary.light.feed_rows = await extractCardRows(page, "#feed article.card", 10);
    summary.light.feed_foregrounds = await extractFeedForegrounds(page, "#feed article.card", 6);
    assertNoWhiteOnWhiteForegrounds(summary.light.feed_foregrounds, "Light Home");
    writeJsonFile(path.join(config.reportDir, "03-home-foregrounds.json"), summary.light.feed_foregrounds);
    assert(rowsMatch(summary.dark_baseline.feed_rows, summary.light.feed_rows), "Light Home feed rows diverged from the canonical dark baseline");
    summary.screenshots["08-light-home"] = await saveScreenshot(page, config.reportDir, "08-light-home");
    await gotoPage(page, buildPageUrl(config.baseUrl, { theme: "light", route: "feed" }), config.timeoutMs);
    await waitForFeed(page, "light", config.timeoutMs);

    try {
      summary.light.read_toggle = await toggleReadRoundTrip(page, config.timeoutMs);
    } catch (error) {
      summary.light.read_toggle_error = String(error?.message || error || "read toggle failed");
      pushBlocker(summary, {
        code: "light_feed_read_toggle_failed",
        message: "Light Home read/unread round-trip did not stabilize within the proof timeout.",
        evidence: { error: summary.light.read_toggle_error }
      });
    }
    summary.screenshots["09-light-home-read-toggle"] = await saveScreenshot(page, config.reportDir, "09-light-home-read-toggle");

    summary.light.transcript_detail = await openDetail(page, 'article.card:not(.card-meeting-processing) .card-body', config.timeoutMs);
    assert(summary.light.transcript_detail.bubble_count > 0 || summary.light.transcript_detail.detail_type === "transcript", "Transcript detail did not display reply thread content");
    summary.screenshots["10-light-home-detail-thread"] = await saveScreenshot(page, config.reportDir, "10-light-home-detail-thread");
    await closeDetail(page, config.timeoutMs);

    const pageActionCount = await page.locator('[data-card-action="page"], [data-card-action="attachment"]').count();
    assert(pageActionCount > 0, "Home feed did not expose a page or attachment action");
    summary.light.page_detail = await openDetail(page, '[data-card-action="page"], [data-card-action="attachment"]', config.timeoutMs);
    assert(summary.light.page_detail.rendered_doc, "Page or attachment detail did not render a document or viewer surface");
    summary.screenshots["11-light-home-page-viewer"] = await saveScreenshot(page, config.reportDir, "11-light-home-page-viewer");
    await closeDetail(page, config.timeoutMs);

    summary.light.feed_audio = await measureFeedAudioProgress(page, config.timeoutMs);
    summary.screenshots["12-light-home-audio"] = await saveScreenshot(page, config.reportDir, "12-light-home-audio");
    if (!summary.light.feed_audio.advanced) {
      pushBlocker(summary, {
        code: "light_feed_audio_no_progress",
        message: "Light Home feed audio icon did not advance playback progress.",
        evidence: summary.light.feed_audio
      });
    }

    const lightLinksUrl = buildPageUrl(config.baseUrl, { theme: "light", route: "links" });
    await gotoPage(page, lightLinksUrl, config.timeoutMs);
    await waitForLinks(page, "light", config.timeoutMs);
    summary.light.links_rows = await extractLinksRows(page, 10);
    assert(summary.light.links_rows.length > 0, "Light Links page rendered no rows");
    summary.screenshots["13-light-links"] = await saveScreenshot(page, config.reportDir, "13-light-links");
    summary.light.links_search = await runLinksSearchProof(page, config.timeoutMs);
    summary.screenshots["14-light-links-search"] = await saveScreenshot(page, config.reportDir, "14-light-links-search");
    await page.locator(".links-search").fill("");
    await page.waitForTimeout(500);
    summary.light.links_open = await runLinksOpenProof(page, requestLog, config.timeoutMs, lightLinksUrl);
    summary.screenshots["15-light-links-app-open"] = await saveScreenshot(page, config.reportDir, "15-light-links-app-open");

    await gotoPage(page, buildPageUrl(config.baseUrl, { theme: "light", route: "meetings" }), config.timeoutMs);
    await waitForMeetings(page, "light", config.timeoutMs);
    assert(await page.locator(".light-shell").count() === 0, "Native light Meetings should not render through .light-shell");
    summary.light.meeting_rows = await extractCardRows(page, ".meetings-page article.card", 10);
    summary.light.meeting_foregrounds = await extractMeetingsForegrounds(page, ".meetings-page article.card", 6);
    assertNoWhiteOnWhiteForegrounds(summary.light.meeting_foregrounds, "Light Meetings");
    writeJsonFile(path.join(config.reportDir, "06-meetings-foregrounds.json"), summary.light.meeting_foregrounds);
    summary.light.meeting_row_overlap = rowsStableOverlap(summary.dark_baseline.meeting_rows, summary.light.meeting_rows);
    assert(
      summary.light.meeting_row_overlap.matches >= summary.light.meeting_row_overlap.required,
      "Light Meetings rows diverged from the canonical dark baseline"
    );
    summary.screenshots["16-light-meetings"] = await saveScreenshot(page, config.reportDir, "16-light-meetings");

    summary.light.meeting_detail = await openDetail(page, ".card-meeting-list .card-body", config.timeoutMs);
    assert(summary.light.meeting_detail.detail_type in ["attachment", "meeting_failed", "transcript"], "Meeting detail did not open a canonical detail surface");
    summary.screenshots["17-light-meetings-detail"] = await saveScreenshot(page, config.reportDir, "17-light-meetings-detail");
    await closeDetail(page, config.timeoutMs);

    summary.light.meeting_audio = await measureMeetingAudioProgress(page, config.timeoutMs);
    summary.screenshots["18-light-meetings-audio"] = await saveScreenshot(page, config.reportDir, "18-light-meetings-audio");
    if (!summary.light.meeting_audio.advanced) {
      pushBlocker(summary, {
        code: "light_meetings_audio_no_progress",
        message: "Light Meetings audio detail did not advance playback progress.",
        evidence: summary.light.meeting_audio
      });
    }

    await gotoPage(page, darkFeedUrl, config.timeoutMs);
    await waitForFeed(page, "dark", config.timeoutMs);
    summary.dark_regression.feed_rows = await extractCardRows(page, "#feed article.card", 10);
    assert(rowsMatch(summary.dark_baseline.feed_rows, summary.dark_regression.feed_rows), "Dark Home feed regressed after the light theme implementation");
    summary.dark_regression.feed_audio = await measureFeedAudioProgress(page, config.timeoutMs);
    summary.screenshots["19-dark-home-regression"] = await saveScreenshot(page, config.reportDir, "19-dark-home-regression");

    await gotoPage(page, darkLinksUrl, config.timeoutMs);
    await waitForLinks(page, "dark", config.timeoutMs);
    summary.dark_regression.links_rows = await extractLinksRows(page, 10);
    assert(
      JSON.stringify(summary.dark_baseline.links_rows.slice(0, 10)) === JSON.stringify(summary.dark_regression.links_rows.slice(0, 10)),
      "Dark Links rows regressed after the light theme implementation"
    );
    summary.dark_regression.links_search = await runLinksSearchProof(page, config.timeoutMs);
    await page.locator(".links-search").fill("");
    await page.waitForTimeout(500);
    summary.dark_regression.links_open = await runLinksOpenProof(page, requestLog, config.timeoutMs, darkLinksUrl);
    summary.screenshots["20-dark-links-regression"] = await saveScreenshot(page, config.reportDir, "20-dark-links-regression");

    await gotoPage(page, darkMeetingsUrl, config.timeoutMs);
    await waitForMeetings(page, "dark", config.timeoutMs);
    summary.dark_regression.meeting_rows = await extractCardRows(page, ".meetings-page article.card", 10);
    summary.dark_regression.meeting_row_overlap = rowsStableOverlap(summary.dark_baseline.meeting_rows, summary.dark_regression.meeting_rows);
    assert(
      summary.dark_regression.meeting_row_overlap.matches >= summary.dark_regression.meeting_row_overlap.required,
      "Dark Meetings rows regressed after the light theme implementation"
    );
    summary.dark_regression.meeting_audio = await measureMeetingAudioProgress(page, config.timeoutMs);
    summary.screenshots["21-dark-meetings-regression"] = await saveScreenshot(page, config.reportDir, "21-dark-meetings-regression");

    await gotoPage(page, darkSettingsUrl, config.timeoutMs);
    await waitForSettings(page, "dark", config.timeoutMs);
    summary.dark_regression.settings = await readThemeState(page);
    summary.screenshots["22-dark-settings-regression"] = await saveScreenshot(page, config.reportDir, "22-dark-settings-regression");

    writeJsonFile(path.join(config.reportDir, "network.json"), requestLog);
    summary.ok = summary.blockers.length === 0;
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    await context.tracing.stop({ path: path.join(config.reportDir, "trace.zip") });
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    const files = fs.existsSync(config.reportDir) ? fs.readdirSync(config.reportDir).filter(name => /\.webm$/i.test(name)) : [];
    if (files.length) {
      const summaryPath = path.join(config.reportDir, "summary.json");
      if (fs.existsSync(summaryPath)) {
        const current = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
        current.video_files = files;
        fs.writeFileSync(summaryPath, JSON.stringify(current, null, 2), "utf8");
      }
    }
  }
}

async function pageWaitForTheme(page, theme, timeoutMs) {
  await page.waitForFunction(
    expectedTheme => document.querySelector(".app-shell")?.getAttribute("data-theme") === expectedTheme,
    theme,
    { timeout: timeoutMs }
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
