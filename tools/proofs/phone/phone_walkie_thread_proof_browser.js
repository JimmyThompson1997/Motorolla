#!/usr/bin/env node
"use strict";

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const networkEvents = [];

function escapeAttribute(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function safeTitle(page) {
  try {
    return await page.title();
  } catch (_) {
    return "";
  }
}

function hasUrlNeedle(url, needle) {
  const text = String(needle || "").trim();
  return !text || String(url || "").includes(text);
}

function lacksUrlNeedle(url, needle) {
  const text = String(needle || "").trim();
  return !text || !String(url || "").includes(text);
}

function shouldFallbackToRawCdp(error) {
  const detail = String(error && error.stack ? error.stack : error || "");
  return (
    detail.includes("Browser.setDownloadBehavior")
    || detail.includes("Browser context management is not supported")
  );
}

function normalizeCdpBaseUrl(cdpUrl) {
  return String(cdpUrl || "").replace(/\/+$/, "");
}

async function fetchTargetDescriptors(request) {
  const response = await fetch(`${normalizeCdpBaseUrl(request.cdp_url)}/json/list`);
  if (!response.ok) {
    throw new Error(`CDP /json/list failed (${response.status})`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("CDP /json/list did not return an array");
  }
  return payload;
}

async function findTargetDescriptor(request) {
  const titleNeedle = String(request.page_title || "Pucky Cover").trim();
  const urlNeedle = String(request.page_url_contains || "index.html").trim();
  const timeoutMs = Number(request.timeout_ms || 15000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descriptors = await fetchTargetDescriptors(request);
    for (const descriptor of descriptors) {
      const title = String(descriptor?.title || "");
      const url = String(descriptor?.url || "");
      if ((!titleNeedle || title.includes(titleNeedle)) && hasUrlNeedle(url, urlNeedle)) {
        if (String(descriptor?.webSocketDebuggerUrl || "").trim()) {
          return descriptor;
        }
      }
    }
    await delay(250);
  }
  throw new Error(`Could not find cover page matching title=${titleNeedle} url=${urlNeedle}`);
}

async function waitForAppShell(page, timeoutMs) {
  await page.waitForSelector(".app-shell", { timeout: timeoutMs });
  await page.waitForTimeout(150);
}

async function describePage(page) {
  return page.evaluate(() => {
    if (window.PuckyUiDebug && typeof window.PuckyUiDebug.describe === "function") {
      return window.PuckyUiDebug.describe();
    }
    const shell = document.querySelector(".app-shell");
    const threadScope = document.getElementById("threadScopeStatus");
    const detail = document.getElementById("detail");
    const cards = Array.from(document.querySelectorAll("article[data-card-id]")).slice(0, 12).map(node => ({
      kind: node.getAttribute("data-card-kind") || "",
      card_id: node.getAttribute("data-card-id") || "",
      session_id: node.getAttribute("data-card-session-id") || "",
      thread_id: node.getAttribute("data-card-thread-id") || "",
      pending_state: node.getAttribute("data-card-pending-state") || "",
      preview: (node.querySelector(".preview, .card-outbound-preview, .title")?.textContent || "").trim()
    }));
    return {
      route: shell?.getAttribute("data-view") || "",
      detail: {
        open: Boolean(detail?.classList.contains("is-open")),
        type: detail?.getAttribute("data-detail-type") || "",
        card_id: detail?.getAttribute("data-detail-card-id") || "",
        session_id: detail?.getAttribute("data-detail-session-id") || "",
        thread_id: detail?.getAttribute("data-detail-thread-id") || "",
        viewer: detail?.getAttribute("data-detail-viewer") || ""
      },
      thread_scope: {
        visible: Boolean(threadScope && !threadScope.hidden),
        active: threadScope?.getAttribute("data-thread-scope-active") || "false",
        mode: threadScope?.getAttribute("data-thread-scope-mode") || "",
        thread_id: threadScope?.getAttribute("data-thread-id") || "",
        source_surface: threadScope?.getAttribute("data-source-surface") || "",
        label: (threadScope?.textContent || "").trim()
      },
      visible_cards: cards
    };
  });
}

async function findCoverPage(browser, request) {
  const timeoutMs = Number(request.timeout_ms || 15000);
  const titleNeedle = String(request.page_title || "Pucky Cover");
  const urlNeedle = String(request.page_url_contains || "index.html");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const title = await safeTitle(page);
        const url = page.url();
        if ((titleNeedle ? title.includes(titleNeedle) : true)
          && (urlNeedle ? url.includes(urlNeedle) : true)) {
          return page;
        }
      }
    }
    await delay(250);
  }
  throw new Error(`Could not find cover page matching title=${titleNeedle} url=${urlNeedle}`);
}

async function clickLocator(page, locator, timeoutMs) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await locator.click({ timeout: Math.min(timeoutMs, 5000) });
  } catch (_) {
    try {
      await locator.click({ timeout: timeoutMs, force: true });
    } catch (_forceError) {
      await locator.evaluate(node => node.click());
    }
  }
  await page.waitForTimeout(200);
}

async function clickSelector(page, selector, timeoutMs) {
  const locator = page.locator(selector).first();
  await clickLocator(page, locator, timeoutMs);
}

async function waitForSelector(page, selector, timeoutMs) {
  await page.waitForSelector(selector, { timeout: timeoutMs });
  await page.waitForTimeout(120);
}

async function waitForText(page, selector, expected, timeoutMs) {
  await page.waitForFunction(({ selector: innerSelector, expected: innerExpected }) => {
    return Array.from(document.querySelectorAll(innerSelector)).some(node => {
      return String(node.textContent || "").includes(innerExpected);
    });
  }, { selector, expected }, { timeout: timeoutMs });
  await page.waitForTimeout(120);
}

async function selectorText(page, selector, timeoutMs) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const value = await locator.textContent();
  return (value || "").trim();
}

async function selectorCount(page, selector) {
  return page.locator(selector).count();
}

async function selectorRect(page, selector, timeoutMs) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const box = await locator.boundingBox();
  if (!box) {
    return null;
  }
  return {
    x: Number(box.x),
    y: Number(box.y),
    width: Number(box.width),
    height: Number(box.height),
    center_x: Number(box.x + (box.width / 2)),
    center_y: Number(box.y + (box.height / 2)),
    device_scale: Number(await page.evaluate(() => window.devicePixelRatio || 1)),
  };
}

async function fillSelector(page, selector, value, timeoutMs) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  await locator.fill(String(value || ""));
  await page.waitForTimeout(120);
}

async function setInputFiles(page, selector, filePaths, timeoutMs) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "attached", timeout: timeoutMs });
  await locator.setInputFiles(Array.isArray(filePaths) ? filePaths : [String(filePaths || "")].filter(Boolean));
  await page.waitForTimeout(200);
}

async function gotoUrl(page, url, timeoutMs) {
  await page.evaluate(targetUrl => {
    window.location.assign(String(targetUrl || ""));
  }, String(url || ""));
  await waitForAppShell(page, timeoutMs);
}

async function waitForPendingFeedStatus(page, token, expectedStatus, timeoutMs) {
  await page.waitForFunction(
    ({ tokenText, expected }) => {
      const cards = Array.from(document.querySelectorAll("article.card-outbound"));
      return cards.some(card => {
        const preview = String(card.querySelector(".card-outbound-preview")?.textContent || "");
        const status = String(card.querySelector(".card-outbound-status")?.textContent || "");
        return preview.includes(tokenText) && status.includes(expected);
      });
    },
    { tokenText: String(token || ""), expected: String(expectedStatus || "") },
    { timeout: timeoutMs },
  );
  await page.waitForTimeout(120);
}

async function threadComposeSnapshot(page) {
  return page.evaluate(() => {
    const detail = document.getElementById("detail");
    const textarea = detail?.querySelector(".thread-composer-input");
    const send = detail?.querySelector(".thread-composer-send");
    const status = detail?.querySelector(".thread-composer-status");
    const chips = Array.from(detail?.querySelectorAll(".thread-composer-chip-label") || []).map(node => String(node.textContent || "").trim());
    const bubbleTexts = Array.from(detail?.querySelectorAll(".bubble") || []).map(node => String(node.textContent || "").replace(/\s+/g, " ").trim());
    const attachmentLabels = Array.from(detail?.querySelectorAll(".bubble-attachment-chip") || []).map(node => String(node.textContent || "").replace(/\s+/g, " ").trim());
    return {
      title: String(document.querySelector(".detail-title, .light-page-title, .detail-header-title")?.textContent || "").trim(),
      thread_id: String(detail?.getAttribute("data-detail-thread-id") || "").trim(),
      detail_type: String(detail?.getAttribute("data-detail-type") || "").trim(),
      viewer: String(detail?.getAttribute("data-detail-viewer") || "").trim(),
      composer_text: String(textarea?.value || ""),
      send_disabled: Boolean(send && send.disabled),
      status_text: String(status?.textContent || "").replace(/\s+/g, " ").trim(),
      chips,
      bubble_texts: bubbleTexts,
      attachment_labels: attachmentLabels,
    };
  });
}

function turnRequestCount() {
  return networkEvents.filter(event => event.method === "POST" && /\/api\/turn\/text(?:$|[?#])/.test(String(event.url || ""))).length;
}

function turnRequestEvents() {
  return networkEvents.filter(event => event.method === "POST" && /\/api\/turn\/text(?:$|[?#])/.test(String(event.url || "")));
}

async function clickFrameSelector(page, frameSelector, selector, timeoutMs) {
  const locator = page.frameLocator(frameSelector).locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await locator.click({ timeout: Math.min(timeoutMs, 5000) });
  } catch (_) {
    try {
      await locator.click({ timeout: timeoutMs, force: true });
    } catch (_forceError) {
      await locator.evaluate(node => node.click());
    }
  }
  await page.waitForTimeout(200);
}

async function audioSnapshot(page, selector, timeoutMs) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "attached", timeout: timeoutMs });
  return locator.evaluate(node => ({
    duration: Number(node.duration || 0),
    readyState: Number(node.readyState || 0),
    paused: Boolean(node.paused),
    currentTime: Number(node.currentTime || 0),
    src: String(node.getAttribute("src") || ""),
    currentSrc: String(node.currentSrc || "")
  }));
}

async function closeDetailIfOpen(page, timeoutMs) {
  const detail = page.locator("#detail.is-open .detail-back").first();
  if (await detail.count()) {
    await clickLocator(page, detail, timeoutMs);
  }
  await page.waitForTimeout(120);
}

async function gotoHome(page, timeoutMs) {
  const debugResult = await page.evaluate(() => {
    if (window.PuckyUiDebug && typeof window.PuckyUiDebug.dispatch === "function") {
      return window.PuckyUiDebug.dispatch("goto_home", {});
    }
    return null;
  }).catch(() => null);
  if (debugResult && debugResult.ok) {
    await waitForAppShell(page, timeoutMs);
    return describePage(page);
  }
  await closeDetailIfOpen(page, timeoutMs);
  const route = await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-view") || "");
  if (route !== "feed") {
    await clickSelector(page, '[data-route="feed"]', timeoutMs);
  }
  await waitForAppShell(page, timeoutMs);
  return describePage(page);
}

function cardActionSelector(op) {
  const value = escapeAttribute(op.session_id || op.card_id || "");
  const key = op.session_id ? "data-card-session-id" : "data-card-id";
  if (!value) {
    throw new Error("open_card_action requires session_id or card_id");
  }
  const action = escapeAttribute(op.action || "transcript");
  return `[${key}="${value}"][data-card-action="${action}"]`;
}

async function runDebugAction(page, action, args, timeoutMs) {
  const result = await page.evaluate(({ action, args }) => {
    if (!window.PuckyUiDebug || typeof window.PuckyUiDebug.dispatch !== "function") {
      return { ok: false, error: "PuckyUiDebug unavailable" };
    }
    return window.PuckyUiDebug.dispatch(action, args || {});
  }, { action, args });
  if (!result || !result.ok) {
    throw new Error(result && result.error ? result.error : `ui debug action failed: ${action}`);
  }
  await page.waitForTimeout(250);
  return result;
}

async function runOperation(page, request, op) {
  const timeoutMs = Number(op.timeout_ms || request.timeout_ms || 15000);
  if (op.kind === "goto_url") {
    const url = String(op.url || "").trim();
    if (!url) {
      throw new Error("goto_url requires url");
    }
    await gotoUrl(page, url, timeoutMs);
    return { kind: op.kind, url, detail: await describePage(page) };
  }
  if (op.kind === "goto_home") {
    return { kind: op.kind, detail: await gotoHome(page, timeoutMs) };
  }
  if (op.kind === "back") {
    const result = await page.evaluate(() => {
      if (window.PuckyUiDebug && typeof window.PuckyUiDebug.dispatch === "function") {
        return window.PuckyUiDebug.dispatch("back", {});
      }
      return null;
    }).catch(() => null);
    if (!result || !result.ok) {
      await closeDetailIfOpen(page, timeoutMs);
    }
    return { kind: op.kind, detail: await describePage(page) };
  }
  if (op.kind === "focus_card") {
    const detail = await runDebugAction(page, "focus_card", {
      session_id: op.session_id || "",
      card_id: op.card_id || ""
    }, timeoutMs);
    return { kind: op.kind, detail };
  }
  if (op.kind === "clear_focus") {
    const detail = await runDebugAction(page, "clear_focus", {}, timeoutMs);
    return { kind: op.kind, detail };
  }
  if (op.kind === "open_card_action") {
    const debugResult = await page.evaluate(({ session_id, card_id, action }) => {
      if (!window.PuckyUiDebug || typeof window.PuckyUiDebug.dispatch !== "function") {
        return null;
      }
      return window.PuckyUiDebug.dispatch("open_card_action", {
        session_id: session_id || "",
        card_id: card_id || "",
        action: action || "transcript"
      });
    }, { session_id: op.session_id || "", card_id: op.card_id || "", action: op.action || "transcript" }).catch(() => null);
    if (debugResult && debugResult.ok) {
      if (op.expected_detail_type) {
        await page.waitForSelector(`#detail.is-open[data-detail-type="${escapeAttribute(op.expected_detail_type)}"]`, {
          timeout: timeoutMs
        });
      }
      return { kind: op.kind, selector: debugResult.selector || "", detail: await describePage(page), debug: debugResult };
    }
    const selector = cardActionSelector(op);
    await clickSelector(page, selector, timeoutMs);
    if (op.expected_detail_type) {
      await page.waitForSelector(`#detail.is-open[data-detail-type="${escapeAttribute(op.expected_detail_type)}"]`, {
        timeout: timeoutMs
      });
    }
    return { kind: op.kind, selector, detail: await describePage(page) };
  }
  if (op.kind === "click_selector") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("click_selector requires selector");
    }
    await clickSelector(page, selector, timeoutMs);
    return { kind: op.kind, selector, detail: await describePage(page) };
  }
  if (op.kind === "wait_for_selector") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("wait_for_selector requires selector");
    }
    await waitForSelector(page, selector, timeoutMs);
    return { kind: op.kind, selector, detail: await describePage(page) };
  }
  if (op.kind === "wait_for_text") {
    const selector = String(op.selector || "").trim();
    const text = String(op.text || op.expected || "").trim();
    if (!selector || !text) {
      throw new Error("wait_for_text requires selector and text");
    }
    await waitForText(page, selector, text, timeoutMs);
    return { kind: op.kind, selector, text: await selectorText(page, selector, timeoutMs), detail: await describePage(page) };
  }
  if (op.kind === "text_content") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("text_content requires selector");
    }
    return { kind: op.kind, selector, text: await selectorText(page, selector, timeoutMs), detail: await describePage(page) };
  }
  if (op.kind === "selector_count") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("selector_count requires selector");
    }
    return { kind: op.kind, selector, count: await selectorCount(page, selector), detail: await describePage(page) };
  }
  if (op.kind === "selector_rect") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("selector_rect requires selector");
    }
    return { kind: op.kind, selector, rect: await selectorRect(page, selector, timeoutMs), detail: await describePage(page) };
  }
  if (op.kind === "click_frame_selector") {
    const frameSelector = String(op.frame_selector || "#detail iframe.document-frame").trim();
    const selector = String(op.selector || "").trim();
    if (!frameSelector || !selector) {
      throw new Error("click_frame_selector requires frame_selector and selector");
    }
    await clickFrameSelector(page, frameSelector, selector, timeoutMs);
    return { kind: op.kind, frame_selector: frameSelector, selector, detail: await describePage(page) };
  }
  if (op.kind === "wait_for_detail") {
    const selector = `#detail.is-open[data-detail-type="${escapeAttribute(op.detail_type || "")}"]`;
    await page.waitForSelector(selector, { timeout: timeoutMs });
    return { kind: op.kind, selector, detail: await describePage(page) };
  }
  if (op.kind === "audio_state") {
    const selector = String(op.selector || "#detail audio.attachment-audio-player").trim();
    if (!selector) {
      throw new Error("audio_state requires selector");
    }
    return { kind: op.kind, selector, audio: await audioSnapshot(page, selector, timeoutMs), detail: await describePage(page) };
  }
  if (op.kind === "play_audio") {
    const selector = String(op.selector || "#detail audio.attachment-audio-player").trim();
    if (!selector) {
      throw new Error("play_audio requires selector");
    }
    const locator = page.locator(selector).first();
    const before = await audioSnapshot(page, selector, timeoutMs);
    const playResult = await locator.evaluate(async (node) => {
      try {
        node.muted = true;
        await node.play();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error && error.message ? error.message : String(error) };
      }
    });
    if (!playResult.ok) {
      throw new Error(`Could not start audio playback: ${playResult.error || "unknown error"}`);
    }
    await page.waitForFunction((innerSelector) => {
      const node = document.querySelector(innerSelector);
      return Boolean(node && !node.paused && Number(node.currentTime || 0) > 0.25);
    }, selector, { timeout: timeoutMs });
    const after = await audioSnapshot(page, selector, timeoutMs);
    return { kind: op.kind, selector, before, after, detail: await describePage(page) };
  }
  if (op.kind === "fill_selector") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("fill_selector requires selector");
    }
    await fillSelector(page, selector, String(op.value || ""), timeoutMs);
    return { kind: op.kind, selector, value: String(op.value || ""), detail: await describePage(page) };
  }
  if (op.kind === "set_input_files") {
    const selector = String(op.selector || "").trim();
    const filePaths = Array.isArray(op.files) ? op.files.map(item => String(item || "")).filter(Boolean) : [];
    if (!selector) {
      throw new Error("set_input_files requires selector");
    }
    if (!filePaths.length) {
      throw new Error("set_input_files requires files");
    }
    await setInputFiles(page, selector, filePaths, timeoutMs);
    return { kind: op.kind, selector, files: filePaths, detail: await describePage(page) };
  }
  if (op.kind === "set_proof_reply_delay_ms") {
    const delayMs = Math.max(0, Number(op.value || 0) || 0);
    await page.evaluate(delay => {
      window.PuckyComposerProofReplyDelayMs = delay;
    }, delayMs);
    return { kind: op.kind, value: delayMs, detail: await describePage(page) };
  }
  if (op.kind === "wait_for_pending_feed_status") {
    const token = String(op.token || "").trim();
    const status = String(op.status || "").trim();
    if (!token || !status) {
      throw new Error("wait_for_pending_feed_status requires token and status");
    }
    await waitForPendingFeedStatus(page, token, status, timeoutMs);
    return { kind: op.kind, token, status, detail: await describePage(page) };
  }
  if (op.kind === "thread_compose_snapshot") {
    return { kind: op.kind, snapshot: await threadComposeSnapshot(page), detail: await describePage(page) };
  }
  if (op.kind === "wait_for_thread_compose_ready") {
    const draftToken = String(op.draft_token || "").trim();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await threadComposeSnapshot(page);
      if (!snapshot.send_disabled && (!draftToken || String(snapshot.composer_text || "").includes(draftToken))) {
        return { kind: op.kind, draft_token: draftToken, snapshot, detail: await describePage(page) };
      }
      await delay(100);
    }
    throw new Error(`Thread composer did not become ready for ${draftToken || "send"} after ${timeoutMs}ms`);
  }
  if (op.kind === "wait_for_thread_compose_thread_id") {
    const expectedThreadId = String(op.thread_id || "").trim();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await threadComposeSnapshot(page);
      if (String(snapshot.thread_id || "").trim() && (!expectedThreadId || snapshot.thread_id === expectedThreadId)) {
        return { kind: op.kind, thread_id: expectedThreadId, snapshot, detail: await describePage(page) };
      }
      await delay(100);
    }
    throw new Error(`Thread composer did not resolve a thread id after ${timeoutMs}ms`);
  }
  if (op.kind === "turn_request_count") {
    return { kind: op.kind, count: turnRequestCount(), detail: await describePage(page) };
  }
  if (op.kind === "wait_for_turn_request_count") {
    const minimum = Math.max(0, Number(op.count || op.minimum || 1) || 0);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (turnRequestCount() >= minimum) {
        return { kind: op.kind, count: turnRequestCount(), minimum, detail: await describePage(page) };
      }
      await delay(100);
    }
    throw new Error(`Turn request count >= ${minimum} timed out after ${timeoutMs}ms`);
  }
  if (op.kind === "turn_request_events") {
    return { kind: op.kind, requests: turnRequestEvents(), detail: await describePage(page) };
  }
  if (op.kind === "screenshot") {
    const screenshotPath = String(op.path || "").trim();
    if (!screenshotPath) {
      throw new Error("screenshot operation requires path");
    }
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    try {
      await page.screenshot({ path: screenshotPath, timeout: Math.min(timeoutMs, 10000) });
      return { kind: op.kind, path: screenshotPath, ok: true };
    } catch (error) {
      return {
        kind: op.kind,
        path: screenshotPath,
        ok: false,
        error: error && error.message ? error.message : String(error)
      };
    }
  }
  if (op.kind === "describe") {
    return { kind: op.kind, detail: await describePage(page) };
  }
  throw new Error(`Unsupported browser operation: ${op.kind}`);
}

class RawWebSocket {
  constructor(wsUrl) {
    this.url = new URL(String(wsUrl || ""));
    this.socket = null;
    this.handshaken = false;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.onText = null;
    this.onClosed = null;
  }

  static async connect(wsUrl, timeoutMs = 10000) {
    const client = new RawWebSocket(wsUrl);
    await client.open(timeoutMs);
    return client;
  }

  async open(timeoutMs = 10000) {
    await new Promise((resolve, reject) => {
      const host = this.url.hostname;
      const port = Number(this.url.port || 80);
      const requestPath = `${this.url.pathname || "/"}${this.url.search || ""}`;
      const key = crypto.randomBytes(16).toString("base64");
      let settled = false;
      const finish = callback => value => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const done = finish(resolve);
      const fail = finish(error => reject(error));
      const timer = setTimeout(() => fail(new Error(`Timed out opening WebSocket ${this.url}`)), timeoutMs);
      this.socket = net.createConnection({ host, port });
      this.socket.on("error", fail);
      this.socket.on("close", () => {
        if (!settled && !this.handshaken) {
          fail(new Error(`WebSocket closed during handshake for ${this.url}`));
          return;
        }
        if (typeof this.onClosed === "function") {
          this.onClosed();
        }
      });
      this.socket.on("data", chunk => {
        try {
          this.consume(chunk);
          if (this.handshaken) {
            done();
          }
        } catch (error) {
          fail(error);
        }
      });
      this.socket.write(
        `GET ${requestPath} HTTP/1.1\r\n`
        + `Host: ${host}:${port}\r\n`
        + "Upgrade: websocket\r\n"
        + "Connection: Upgrade\r\n"
        + `Sec-WebSocket-Key: ${key}\r\n`
        + "Sec-WebSocket-Version: 13\r\n\r\n"
      );
    });
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.handshaken) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const headerText = this.buffer.subarray(0, headerEnd + 4).toString("utf8");
      if (!headerText.startsWith("HTTP/1.1 101")) {
        throw new Error(`WebSocket handshake failed: ${headerText.trim()}`);
      }
      this.handshaken = true;
      this.buffer = this.buffer.subarray(headerEnd + 4);
    }
    this.processFrames();
  }

  processFrames() {
    while (this.buffer.length >= 2) {
      const byte1 = this.buffer[0];
      const byte2 = this.buffer[1];
      const fin = Boolean(byte1 & 0x80);
      const opcode = byte1 & 0x0f;
      const masked = Boolean(byte2 & 0x80);
      let length = byte2 & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) {
          return;
        }
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) {
          return;
        }
        const high = this.buffer.readUInt32BE(2);
        const low = this.buffer.readUInt32BE(6);
        length = high * 2 ** 32 + low;
        offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      const frameLength = offset + maskBytes + length;
      if (this.buffer.length < frameLength) {
        return;
      }
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      let payload = this.buffer.subarray(offset + maskBytes, frameLength);
      this.buffer = this.buffer.subarray(frameLength);
      if (mask) {
        const unmasked = Buffer.alloc(payload.length);
        for (let index = 0; index < payload.length; index += 1) {
          unmasked[index] = payload[index] ^ mask[index % 4];
        }
        payload = unmasked;
      }
      if (opcode === 0x8) {
        if (this.socket) {
          this.socket.end();
        }
        return;
      }
      if (opcode === 0x9) {
        this.sendFrame(0xA, payload);
        continue;
      }
      if (opcode === 0xA) {
        continue;
      }
      if (opcode === 0x1) {
        this.fragments = [payload];
      } else if (opcode === 0x0) {
        this.fragments.push(payload);
      } else {
        continue;
      }
      if (!fin) {
        continue;
      }
      const text = Buffer.concat(this.fragments).toString("utf8");
      this.fragments = [];
      if (typeof this.onText === "function") {
        this.onText(text);
      }
    }
  }

  sendFrame(opcode, payload = Buffer.alloc(0)) {
    if (!this.socket) {
      throw new Error("WebSocket is not connected");
    }
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const mask = crypto.randomBytes(4);
    const header = [];
    header.push(0x80 | (opcode & 0x0f));
    if (body.length < 126) {
      header.push(0x80 | body.length);
    } else if (body.length <= 0xffff) {
      header.push(0x80 | 126);
      header.push((body.length >> 8) & 0xff, body.length & 0xff);
    } else {
      const high = Math.floor(body.length / 2 ** 32);
      const low = body.length >>> 0;
      header.push(0x80 | 127);
      header.push(
        (high >> 24) & 0xff,
        (high >> 16) & 0xff,
        (high >> 8) & 0xff,
        high & 0xff,
        (low >> 24) & 0xff,
        (low >> 16) & 0xff,
        (low >> 8) & 0xff,
        low & 0xff
      );
    }
    const masked = Buffer.alloc(body.length);
    for (let index = 0; index < body.length; index += 1) {
      masked[index] = body[index] ^ mask[index % 4];
    }
    this.socket.write(Buffer.concat([Buffer.from(header), mask, masked]));
  }

  sendText(text) {
    this.sendFrame(0x1, Buffer.from(String(text || ""), "utf8"));
  }

  async close() {
    if (!this.socket) {
      return;
    }
    try {
      this.sendFrame(0x8, Buffer.alloc(0));
    } catch (_error) {
      // Ignore close-frame failures while tearing down.
    }
    await delay(50);
    this.socket.end();
  }
}

class RawCdpClient {
  constructor(wsClient) {
    this.wsClient = wsClient;
    this.nextId = 0;
    this.pending = new Map();
    this.wsClient.onText = text => {
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        return;
      }
      if (!payload || typeof payload !== "object" || !payload.id || !this.pending.has(payload.id)) {
        return;
      }
      const handlers = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      if (payload.error) {
        handlers.reject(new Error(payload.error.message || JSON.stringify(payload.error)));
        return;
      }
      handlers.resolve(payload.result || {});
    };
    this.wsClient.onClosed = () => {
      const error = new Error("CDP WebSocket closed");
      for (const handlers of this.pending.values()) {
        handlers.reject(error);
      }
      this.pending.clear();
    };
  }

  static async connect(request) {
    const descriptor = await findTargetDescriptor(request);
    const wsClient = await RawWebSocket.connect(String(descriptor.webSocketDebuggerUrl || ""));
    const client = new RawCdpClient(wsClient);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("DOM.enable").catch(() => {});
    await client.send("Page.bringToFront").catch(() => {});
    return { client, descriptor };
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.wsClient.sendText(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.text || response.exceptionDetails.exception?.description || "Runtime.evaluate failed";
      throw new Error(String(detail));
    }
    const result = response.result || {};
    if (Object.prototype.hasOwnProperty.call(result, "value")) {
      return result.value;
    }
    return null;
  }

  async captureScreenshot(targetPath) {
    const response = await this.send("Page.captureScreenshot", { format: "png" });
    const bytes = Buffer.from(String(response.data || ""), "base64");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, bytes);
  }

  async close() {
    await this.wsClient.close();
  }
}

function isTransientRawCdpError(error) {
  const detail = String(error && error.message ? error.message : error || "");
  return (
    detail.includes("context with specified id")
    || detail.includes("Execution context was destroyed")
    || detail.includes("Inspected target navigated or closed")
    || detail.includes("Cannot find context")
  );
}

async function rawWaitForValue(client, expression, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await client.evaluate(expression);
      if (predicate(lastValue)) {
        return lastValue;
      }
    } catch (error) {
      if (!isTransientRawCdpError(error)) {
        throw error;
      }
      lastError = error;
    }
    await delay(250);
  }
  if (lastError) {
    throw new Error(`${label} timed out after transient CDP errors: ${lastError.message}`);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}

async function rawWaitForAppShell(client, timeoutMs) {
  await rawWaitForValue(
    client,
    `Boolean(document.querySelector(".app-shell"))`,
    value => Boolean(value),
    timeoutMs,
    "App shell"
  );
  await delay(150);
}

async function rawDescribePage(client) {
  return client.evaluate(`(() => {
    if (window.PuckyUiDebug && typeof window.PuckyUiDebug.describe === "function") {
      return window.PuckyUiDebug.describe();
    }
    const shell = document.querySelector(".app-shell");
    const threadScope = document.getElementById("threadScopeStatus");
    const detail = document.getElementById("detail");
    const cards = Array.from(document.querySelectorAll("article[data-card-id]")).slice(0, 12).map(node => ({
      kind: node.getAttribute("data-card-kind") || "",
      card_id: node.getAttribute("data-card-id") || "",
      session_id: node.getAttribute("data-card-session-id") || "",
      thread_id: node.getAttribute("data-card-thread-id") || "",
      pending_state: node.getAttribute("data-card-pending-state") || "",
      preview: (node.querySelector(".preview, .card-outbound-preview, .title")?.textContent || "").trim()
    }));
    return {
      route: shell?.getAttribute("data-view") || "",
      detail: {
        open: Boolean(detail?.classList.contains("is-open")),
        type: detail?.getAttribute("data-detail-type") || "",
        card_id: detail?.getAttribute("data-detail-card-id") || "",
        session_id: detail?.getAttribute("data-detail-session-id") || "",
        thread_id: detail?.getAttribute("data-detail-thread-id") || "",
        viewer: detail?.getAttribute("data-detail-viewer") || ""
      },
      thread_scope: {
        visible: Boolean(threadScope && !threadScope.hidden),
        active: threadScope?.getAttribute("data-thread-scope-active") || "false",
        mode: threadScope?.getAttribute("data-thread-scope-mode") || "",
        thread_id: threadScope?.getAttribute("data-thread-id") || "",
        source_surface: threadScope?.getAttribute("data-source-surface") || "",
        label: (threadScope?.textContent || "").trim()
      },
      visible_cards: cards
    };
  })()`);
}

async function rawInstallNetworkCapture(client) {
  await client.evaluate(`(() => {
    if (window.__PUCKY_THREAD_PROOF_REQUESTS__) {
      return true;
    }
    const requests = [];
    const serializeBody = body => {
      if (body == null) {
        return "";
      }
      if (typeof body === "string") {
        return body;
      }
      if (body instanceof URLSearchParams) {
        return body.toString();
      }
      if (typeof FormData !== "undefined" && body instanceof FormData) {
        const parts = [];
        for (const [name, value] of body.entries()) {
          if (typeof File !== "undefined" && value instanceof File) {
            parts.push(name + "=FILE:" + value.name);
          } else {
            parts.push(name + "=" + String(value));
          }
        }
        return parts.join("&");
      }
      return String(body);
    };
    const push = entry => {
      try {
        requests.push({
          method: String(entry?.method || ""),
          url: String(entry?.url || ""),
          post_data: String(entry?.post_data || ""),
        });
      } catch (_error) {
        // Ignore observer failures.
      }
    };
    window.__PUCKY_THREAD_PROOF_REQUESTS__ = requests;
    if (typeof window.fetch === "function" && !window.fetch.__puckyThreadProofWrapped) {
      const originalFetch = window.fetch.bind(window);
      const wrappedFetch = async (...args) => {
        const request = args[0];
        const init = args[1] || {};
        const method = String(init.method || request?.method || "GET");
        const url = typeof request === "string" ? request : String(request?.url || "");
        const body = init.body !== undefined ? init.body : null;
        push({ method, url, post_data: serializeBody(body) });
        return originalFetch(...args);
      };
      wrappedFetch.__puckyThreadProofWrapped = true;
      window.fetch = wrappedFetch;
    }
    if (typeof XMLHttpRequest !== "undefined" && !XMLHttpRequest.prototype.__puckyThreadProofWrapped) {
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__puckyThreadProofMethod = method;
        this.__puckyThreadProofUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(body) {
        push({
          method: String(this.__puckyThreadProofMethod || "GET"),
          url: String(this.__puckyThreadProofUrl || ""),
          post_data: serializeBody(body),
        });
        return originalSend.call(this, body);
      };
      XMLHttpRequest.prototype.__puckyThreadProofWrapped = true;
    }
    return true;
  })()`);
}

async function rawGotoUrl(client, url, timeoutMs) {
  await client.evaluate(`(() => {
    window.location.assign(${JSON.stringify(String(url || ""))});
    return true;
  })()`);
  await rawWaitForAppShell(client, timeoutMs);
  await rawInstallNetworkCapture(client);
}

async function rawWaitForSelector(client, selector, timeoutMs) {
  const safeSelector = JSON.stringify(String(selector || ""));
  await rawWaitForValue(
    client,
    `Boolean(document.querySelector(${safeSelector}))`,
    value => Boolean(value),
    timeoutMs,
    `Selector ${selector}`
  );
  await delay(120);
}

async function rawWaitForText(client, selector, expected, timeoutMs) {
  const safeSelector = JSON.stringify(String(selector || ""));
  const safeExpected = JSON.stringify(String(expected || ""));
  await rawWaitForValue(
    client,
    `(() => Array.from(document.querySelectorAll(${safeSelector})).some(node => String(node.textContent || "").includes(${safeExpected})))()`,
    value => Boolean(value),
    timeoutMs,
    `Text ${expected}`
  );
  await delay(120);
}

async function rawSelectorText(client, selector) {
  return client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(String(selector || ""))});
    return String(node?.textContent || "").trim();
  })()`);
}

async function rawSelectorCount(client, selector) {
  return client.evaluate(`document.querySelectorAll(${JSON.stringify(String(selector || ""))}).length`);
}

async function rawSelectorRect(client, selector, timeoutMs) {
  await rawWaitForSelector(client, selector, timeoutMs);
  return client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(String(selector || ""))});
    if (!node) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    return {
      x: Number(rect.left || 0),
      y: Number(rect.top || 0),
      width: Number(rect.width || 0),
      height: Number(rect.height || 0),
      center_x: Number((rect.left || 0) + ((rect.width || 0) / 2)),
      center_y: Number((rect.top || 0) + ((rect.height || 0) / 2)),
      device_scale: Number(window.devicePixelRatio || 1),
    };
  })()`);
}

async function rawClickSelector(client, selector, timeoutMs) {
  await rawWaitForSelector(client, selector, timeoutMs);
  const point = await client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(String(selector || ""))});
    if (!node) {
      return null;
    }
    node.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = node.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  })()`);
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
    throw new Error(`Could not click selector ${selector}`);
  }
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: Number(point.x),
    y: Number(point.y),
    button: "none",
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: Number(point.x),
    y: Number(point.y),
    button: "left",
    clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: Number(point.x),
    y: Number(point.y),
    button: "left",
    clickCount: 1,
  });
  await delay(200);
}

async function rawFillSelector(client, selector, value, timeoutMs) {
  await rawWaitForSelector(client, selector, timeoutMs);
  const filled = await client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(String(selector || ""))});
    if (!node) {
      return false;
    }
    node.focus();
    node.value = ${JSON.stringify(String(value || ""))};
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!filled) {
    throw new Error(`Could not fill selector ${selector}`);
  }
  await delay(120);
}

function inferMimeType(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".txt" || ext === ".md" || ext === ".log") {
    return "text/plain";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".json") {
    return "application/json";
  }
  if (ext === ".pdf") {
    return "application/pdf";
  }
  return "application/octet-stream";
}

async function rawSetInputFiles(client, selector, filePaths, timeoutMs) {
  await rawWaitForSelector(client, selector, timeoutMs);
  const files = filePaths.map(filePath => ({
    name: path.basename(filePath),
    mimeType: inferMimeType(filePath),
    base64: fs.readFileSync(filePath).toString("base64"),
  }));
  const result = await client.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(String(selector || ""))});
    if (!input) {
      return { ok: false, error: "missing input" };
    }
    if (typeof DataTransfer === "undefined" || typeof File === "undefined") {
      return { ok: false, error: "DataTransfer or File unavailable" };
    }
    const files = ${JSON.stringify(files)};
    const decode = value => Uint8Array.from(atob(String(value || "")), char => char.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    for (const item of files) {
      const file = new File([decode(item.base64)], item.name, { type: item.mimeType || "application/octet-stream" });
      dataTransfer.items.add(file);
    }
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, count: dataTransfer.files.length };
  })()`);
  if (!result || !result.ok) {
    throw new Error(`Could not set input files for ${selector}: ${result?.error || "unknown error"}`);
  }
  await delay(200);
}

async function rawWaitForPendingFeedStatus(client, token, status, timeoutMs) {
  const safeToken = JSON.stringify(String(token || ""));
  const safeStatus = JSON.stringify(String(status || ""));
  await rawWaitForValue(
    client,
    `(() => {
      const cards = Array.from(document.querySelectorAll("article.card-outbound"));
      return cards.some(card => {
        const preview = String(card.querySelector(".card-outbound-preview")?.textContent || "");
        const statusText = String(card.querySelector(".card-outbound-status")?.textContent || "");
        return preview.includes(${safeToken}) && statusText.includes(${safeStatus});
      });
    })()`,
    value => Boolean(value),
    timeoutMs,
    `Pending feed status ${status}`
  );
  await delay(120);
}

async function rawThreadComposeSnapshot(client) {
  return client.evaluate(`(() => {
    const detail = document.getElementById("detail");
    const textarea = detail?.querySelector(".thread-composer-input");
    const send = detail?.querySelector(".thread-composer-send");
    const status = detail?.querySelector(".thread-composer-status");
    const chips = Array.from(detail?.querySelectorAll(".thread-composer-chip-label") || []).map(node => String(node.textContent || "").trim());
    const bubbleTexts = Array.from(detail?.querySelectorAll(".bubble") || []).map(node => String(node.textContent || "").replace(/\\s+/g, " ").trim());
    const attachmentLabels = Array.from(detail?.querySelectorAll(".bubble-attachment-chip") || []).map(node => String(node.textContent || "").replace(/\\s+/g, " ").trim());
    return {
      title: String(document.querySelector(".detail-title, .light-page-title, .detail-header-title")?.textContent || "").trim(),
      thread_id: String(detail?.getAttribute("data-detail-thread-id") || "").trim(),
      detail_type: String(detail?.getAttribute("data-detail-type") || "").trim(),
      viewer: String(detail?.getAttribute("data-detail-viewer") || "").trim(),
      composer_text: String(textarea?.value || ""),
      send_disabled: Boolean(send && send.disabled),
      status_text: String(status?.textContent || "").replace(/\\s+/g, " ").trim(),
      chips,
      bubble_texts: bubbleTexts,
      attachment_labels: attachmentLabels,
    };
  })()`);
}

async function rawTurnRequestEvents(client) {
  const requests = await client.evaluate(`Array.isArray(window.__PUCKY_THREAD_PROOF_REQUESTS__) ? window.__PUCKY_THREAD_PROOF_REQUESTS__ : []`);
  return Array.isArray(requests)
    ? requests.filter(event => String(event?.method || "") === "POST" && String(event?.url || "").includes("/api/turn/text"))
    : [];
}

async function rawTurnRequestCount(client) {
  const requests = await rawTurnRequestEvents(client);
  return requests.length;
}

async function rawClickFrameSelector(client, frameSelector, selector, timeoutMs) {
  await rawWaitForValue(
    client,
    `(() => {
      const frame = document.querySelector(${JSON.stringify(String(frameSelector || ""))});
      return Boolean(frame?.contentDocument?.querySelector(${JSON.stringify(String(selector || ""))}));
    })()`,
    value => Boolean(value),
    timeoutMs,
    `Frame selector ${selector}`
  );
  const clicked = await client.evaluate(`(() => {
    const frame = document.querySelector(${JSON.stringify(String(frameSelector || ""))});
    const node = frame?.contentDocument?.querySelector(${JSON.stringify(String(selector || ""))});
    if (!node) {
      return false;
    }
    node.scrollIntoView({ block: "center", inline: "nearest" });
    node.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not click frame selector ${selector}`);
  }
  await delay(200);
}

async function rawAudioSnapshot(client, selector) {
  return client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(String(selector || ""))});
    return {
      duration: Number(node?.duration || 0),
      readyState: Number(node?.readyState || 0),
      paused: Boolean(node?.paused),
      currentTime: Number(node?.currentTime || 0),
      src: String(node?.getAttribute?.("src") || ""),
      currentSrc: String(node?.currentSrc || ""),
    };
  })()`);
}

async function rawCloseDetailIfOpen(client) {
  const result = await client.evaluate(`(() => {
    const button = document.querySelector("#detail.is-open .detail-back");
    if (!button) {
      return false;
    }
    button.click();
    return true;
  })()`);
  if (result) {
    await delay(120);
  }
}

async function rawRunDebugAction(client, action, args) {
  const result = await client.evaluate(`(() => {
    if (!window.PuckyUiDebug || typeof window.PuckyUiDebug.dispatch !== "function") {
      return { ok: false, error: "PuckyUiDebug unavailable" };
    }
    return window.PuckyUiDebug.dispatch(${JSON.stringify(String(action || ""))}, ${JSON.stringify(args || {})});
  })()`);
  if (!result || !result.ok) {
    throw new Error(result && result.error ? result.error : `ui debug action failed: ${action}`);
  }
  await delay(250);
  return result;
}

async function rawGotoHome(client, timeoutMs) {
  const result = await client.evaluate(`(() => {
    if (window.PuckyUiDebug && typeof window.PuckyUiDebug.dispatch === "function") {
      return window.PuckyUiDebug.dispatch("goto_home", {});
    }
    return null;
  })()`).catch(() => null);
  if (!result || !result.ok) {
    await rawCloseDetailIfOpen(client);
    const route = await client.evaluate(`document.querySelector(".app-shell")?.getAttribute("data-view") || ""`);
    if (route !== "feed") {
      await rawClickSelector(client, '[data-route="feed"]', timeoutMs);
    }
  }
  await rawWaitForAppShell(client, timeoutMs);
  return rawDescribePage(client);
}

async function runRawOperation(client, request, op) {
  const timeoutMs = Number(op.timeout_ms || request.timeout_ms || 15000);
  if (op.kind === "goto_url") {
    const url = String(op.url || "").trim();
    if (!url) {
      throw new Error("goto_url requires url");
    }
    await rawGotoUrl(client, url, timeoutMs);
    return { kind: op.kind, url, detail: await rawDescribePage(client) };
  }
  if (op.kind === "goto_home") {
    return { kind: op.kind, detail: await rawGotoHome(client, timeoutMs) };
  }
  if (op.kind === "back") {
    const result = await client.evaluate(`(() => {
      if (window.PuckyUiDebug && typeof window.PuckyUiDebug.dispatch === "function") {
        return window.PuckyUiDebug.dispatch("back", {});
      }
      return null;
    })()`).catch(() => null);
    if (!result || !result.ok) {
      await rawCloseDetailIfOpen(client);
    }
    return { kind: op.kind, detail: await rawDescribePage(client) };
  }
  if (op.kind === "focus_card") {
    return { kind: op.kind, detail: await rawRunDebugAction(client, "focus_card", { session_id: op.session_id || "", card_id: op.card_id || "" }) };
  }
  if (op.kind === "clear_focus") {
    return { kind: op.kind, detail: await rawRunDebugAction(client, "clear_focus", {}) };
  }
  if (op.kind === "open_card_action") {
    const debugResult = await client.evaluate(`(() => {
      if (!window.PuckyUiDebug || typeof window.PuckyUiDebug.dispatch !== "function") {
        return null;
      }
      return window.PuckyUiDebug.dispatch("open_card_action", {
        session_id: ${JSON.stringify(String(op.session_id || ""))},
        card_id: ${JSON.stringify(String(op.card_id || ""))},
        action: ${JSON.stringify(String(op.action || "transcript"))}
      });
    })()`).catch(() => null);
    if (debugResult && debugResult.ok) {
      if (op.expected_detail_type) {
        await rawWaitForValue(
          client,
          `Boolean(document.querySelector('#detail.is-open[data-detail-type="${escapeAttribute(op.expected_detail_type)}"]'))`,
          value => Boolean(value),
          timeoutMs,
          `Detail ${op.expected_detail_type}`
        );
      }
      return { kind: op.kind, selector: debugResult.selector || "", detail: await rawDescribePage(client), debug: debugResult };
    }
    const selector = cardActionSelector(op);
    await rawClickSelector(client, selector, timeoutMs);
    if (op.expected_detail_type) {
      await rawWaitForValue(
        client,
        `Boolean(document.querySelector('#detail.is-open[data-detail-type="${escapeAttribute(op.expected_detail_type)}"]'))`,
        value => Boolean(value),
        timeoutMs,
        `Detail ${op.expected_detail_type}`
      );
    }
    return { kind: op.kind, selector, detail: await rawDescribePage(client) };
  }
  if (op.kind === "click_selector") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("click_selector requires selector");
    }
    await rawClickSelector(client, selector, timeoutMs);
    return { kind: op.kind, selector, detail: await rawDescribePage(client) };
  }
  if (op.kind === "wait_for_selector") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("wait_for_selector requires selector");
    }
    await rawWaitForSelector(client, selector, timeoutMs);
    return { kind: op.kind, selector, detail: await rawDescribePage(client) };
  }
  if (op.kind === "wait_for_text") {
    const selector = String(op.selector || "").trim();
    const text = String(op.text || op.expected || "").trim();
    if (!selector || !text) {
      throw new Error("wait_for_text requires selector and text");
    }
    await rawWaitForText(client, selector, text, timeoutMs);
    return { kind: op.kind, selector, text: await rawSelectorText(client, selector), detail: await rawDescribePage(client) };
  }
  if (op.kind === "text_content") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("text_content requires selector");
    }
    return { kind: op.kind, selector, text: await rawSelectorText(client, selector), detail: await rawDescribePage(client) };
  }
  if (op.kind === "selector_count") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("selector_count requires selector");
    }
    return { kind: op.kind, selector, count: await rawSelectorCount(client, selector), detail: await rawDescribePage(client) };
  }
  if (op.kind === "selector_rect") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("selector_rect requires selector");
    }
    return { kind: op.kind, selector, rect: await rawSelectorRect(client, selector, timeoutMs), detail: await rawDescribePage(client) };
  }
  if (op.kind === "click_frame_selector") {
    const frameSelector = String(op.frame_selector || "#detail iframe.document-frame").trim();
    const selector = String(op.selector || "").trim();
    if (!frameSelector || !selector) {
      throw new Error("click_frame_selector requires frame_selector and selector");
    }
    await rawClickFrameSelector(client, frameSelector, selector, timeoutMs);
    return { kind: op.kind, frame_selector: frameSelector, selector, detail: await rawDescribePage(client) };
  }
  if (op.kind === "wait_for_detail") {
    const selector = `#detail.is-open[data-detail-type="${escapeAttribute(op.detail_type || "")}"]`;
    await rawWaitForValue(
      client,
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      value => Boolean(value),
      timeoutMs,
      `Detail ${op.detail_type || ""}`
    );
    return { kind: op.kind, selector, detail: await rawDescribePage(client) };
  }
  if (op.kind === "audio_state") {
    const selector = String(op.selector || "#detail audio.attachment-audio-player").trim();
    if (!selector) {
      throw new Error("audio_state requires selector");
    }
    return { kind: op.kind, selector, audio: await rawAudioSnapshot(client, selector), detail: await rawDescribePage(client) };
  }
  if (op.kind === "play_audio") {
    const selector = String(op.selector || "#detail audio.attachment-audio-player").trim();
    if (!selector) {
      throw new Error("play_audio requires selector");
    }
    const before = await rawAudioSnapshot(client, selector);
    const started = await client.evaluate(`(async () => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) {
        return { ok: false, error: "missing audio node" };
      }
      try {
        node.muted = true;
        await node.play();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error && error.message ? error.message : String(error) };
      }
    })()`);
    if (!started || !started.ok) {
      throw new Error(`Could not start audio playback: ${started?.error || "unknown error"}`);
    }
    await rawWaitForValue(
      client,
      `(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        return Boolean(node && !node.paused && Number(node.currentTime || 0) > 0.25);
      })()`,
      value => Boolean(value),
      timeoutMs,
      "Audio playback"
    );
    const after = await rawAudioSnapshot(client, selector);
    return { kind: op.kind, selector, before, after, detail: await rawDescribePage(client) };
  }
  if (op.kind === "fill_selector") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("fill_selector requires selector");
    }
    await rawFillSelector(client, selector, String(op.value || ""), timeoutMs);
    return { kind: op.kind, selector, value: String(op.value || ""), detail: await rawDescribePage(client) };
  }
  if (op.kind === "set_input_files") {
    const selector = String(op.selector || "").trim();
    const filePaths = Array.isArray(op.files) ? op.files.map(item => String(item || "")).filter(Boolean) : [];
    if (!selector) {
      throw new Error("set_input_files requires selector");
    }
    if (!filePaths.length) {
      throw new Error("set_input_files requires files");
    }
    await rawSetInputFiles(client, selector, filePaths, timeoutMs);
    return { kind: op.kind, selector, files: filePaths, detail: await rawDescribePage(client) };
  }
  if (op.kind === "set_proof_reply_delay_ms") {
    const delayMs = Math.max(0, Number(op.value || 0) || 0);
    await client.evaluate(`window.PuckyComposerProofReplyDelayMs = ${delayMs}; true;`);
    return { kind: op.kind, value: delayMs, detail: await rawDescribePage(client) };
  }
  if (op.kind === "wait_for_pending_feed_status") {
    const token = String(op.token || "").trim();
    const status = String(op.status || "").trim();
    if (!token || !status) {
      throw new Error("wait_for_pending_feed_status requires token and status");
    }
    await rawWaitForPendingFeedStatus(client, token, status, timeoutMs);
    return { kind: op.kind, token, status, detail: await rawDescribePage(client) };
  }
  if (op.kind === "thread_compose_snapshot") {
    return { kind: op.kind, snapshot: await rawThreadComposeSnapshot(client), detail: await rawDescribePage(client) };
  }
  if (op.kind === "wait_for_thread_compose_ready") {
    const draftToken = String(op.draft_token || "").trim();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await rawThreadComposeSnapshot(client);
      if (!snapshot.send_disabled && (!draftToken || String(snapshot.composer_text || "").includes(draftToken))) {
        return { kind: op.kind, draft_token: draftToken, snapshot, detail: await rawDescribePage(client) };
      }
      await delay(100);
    }
    throw new Error(`Thread composer did not become ready for ${draftToken || "send"} after ${timeoutMs}ms`);
  }
  if (op.kind === "wait_for_thread_compose_thread_id") {
    const expectedThreadId = String(op.thread_id || "").trim();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await rawThreadComposeSnapshot(client);
      if (String(snapshot.thread_id || "").trim() && (!expectedThreadId || snapshot.thread_id === expectedThreadId)) {
        return { kind: op.kind, thread_id: expectedThreadId, snapshot, detail: await rawDescribePage(client) };
      }
      await delay(100);
    }
    throw new Error(`Thread composer did not resolve a thread id after ${timeoutMs}ms`);
  }
  if (op.kind === "turn_request_count") {
    return { kind: op.kind, count: await rawTurnRequestCount(client), detail: await rawDescribePage(client) };
  }
  if (op.kind === "wait_for_turn_request_count") {
    const minimum = Math.max(0, Number(op.count || op.minimum || 1) || 0);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const count = await rawTurnRequestCount(client);
      if (count >= minimum) {
        return { kind: op.kind, count, minimum, detail: await rawDescribePage(client) };
      }
      await delay(100);
    }
    throw new Error(`Turn request count >= ${minimum} timed out after ${timeoutMs}ms`);
  }
  if (op.kind === "turn_request_events") {
    return { kind: op.kind, requests: await rawTurnRequestEvents(client), detail: await rawDescribePage(client) };
  }
  if (op.kind === "screenshot") {
    const screenshotPath = String(op.path || "").trim();
    if (!screenshotPath) {
      throw new Error("screenshot operation requires path");
    }
    await client.captureScreenshot(screenshotPath);
    return { kind: op.kind, path: screenshotPath, ok: true, detail: await rawDescribePage(client) };
  }
  if (op.kind === "describe") {
    return { kind: op.kind, detail: await rawDescribePage(client) };
  }
  throw new Error(`Unsupported browser operation: ${op.kind}`);
}

async function runPlaywrightProof(request) {
  let browser;
  networkEvents.length = 0;
  try {
    browser = await chromium.connectOverCDP(String(request.cdp_url || ""));
    const page = await findCoverPage(browser, request);
    if (!page.__puckyThreadComposeNetworkBound) {
      page.__puckyThreadComposeNetworkBound = true;
      page.on("request", req => {
        networkEvents.push({
          method: String(req.method() || ""),
          url: String(req.url() || ""),
          post_data: String(req.postData() || ""),
        });
      });
    }
    await waitForAppShell(page, Number(request.timeout_ms || 15000));
    const operations = Array.isArray(request.operations) && request.operations.length
      ? request.operations
      : [{ kind: "describe" }];
    const results = [];
    for (const op of operations) {
      results.push(await runOperation(page, request, op));
    }
    return {
      ok: true,
      page_title: await safeTitle(page),
      page_url: page.url(),
      final_surface: await describePage(page),
      operations: results
    };
  } finally {
    if (browser) {
      await Promise.race([
        browser.close().catch(() => {}),
        delay(1000)
      ]);
    }
  }
}

async function runRawProof(request) {
  const { client, descriptor } = await RawCdpClient.connect(request);
  try {
    await rawWaitForAppShell(client, Number(request.timeout_ms || 15000));
    await rawInstallNetworkCapture(client);
    const operations = Array.isArray(request.operations) && request.operations.length
      ? request.operations
      : [{ kind: "describe" }];
    const results = [];
    for (const op of operations) {
      results.push(await runRawOperation(client, request, op));
    }
    const finalSurface = await rawDescribePage(client);
    return {
      ok: true,
      page_title: String(finalSurface?.title || descriptor.title || ""),
      page_url: String(finalSurface?.url || descriptor.url || ""),
      final_surface: finalSurface,
      operations: results,
      cdp_transport: "raw_page_websocket",
    };
  } finally {
    await client.close().catch(() => {});
  }
}

function writeOutput(request, payload) {
  const outputPath = String(request.output_path || "").trim();
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    return;
  }
  process.stdout.write(JSON.stringify(payload, null, 2));
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error("Usage: phone_walkie_thread_proof_browser.js <request.json>");
  }
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  try {
    const output = await runPlaywrightProof(request);
    writeOutput(request, output);
  } catch (error) {
    if (!shouldFallbackToRawCdp(error)) {
      throw error;
    }
    const output = await runRawProof(request);
    output.playwright_fallback_error = String(error && error.message ? error.message : error || "");
    writeOutput(request, output);
  }
}

main().catch(error => {
  const payload = {
    ok: false,
    error: error && error.message ? error.message : String(error)
  };
  try {
    const requestPath = process.argv[2];
    if (requestPath) {
      const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
      if (request.output_path) {
        fs.mkdirSync(path.dirname(request.output_path), { recursive: true });
        fs.writeFileSync(request.output_path, JSON.stringify(payload, null, 2));
        process.exit(1);
      }
    }
  } catch (_) {
    // Fall back to stderr below.
  }
  process.stderr.write(JSON.stringify(payload, null, 2));
  process.exit(1);
});
