#!/usr/bin/env node
"use strict";

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

async function delay(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function safeTitle(page) {
  try {
    return await page.title();
  } catch (_error) {
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

function isIgnoredChromeUrl(url) {
  const text = String(url || "").trim().toLowerCase();
  if (!text || text === "about:blank") {
    return true;
  }
  return (
    text.startsWith("chrome://")
    || text.startsWith("chrome-native://")
    || text.startsWith("devtools://")
    || text.startsWith("data:text/html,chromewebdata")
  );
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

function pickMatchingDescriptor(descriptors, request) {
  const mode = String(request.surface || "cover").trim() || "cover";
  const titleNeedle = String(request.page_title || "").trim();
  const urlNeedle = String(request.page_url_contains || "").trim();
  const urlNotNeedle = String(request.page_url_not_contains || "").trim();
  let chromeFallback = null;
  for (let index = descriptors.length - 1; index >= 0; index -= 1) {
    const descriptor = descriptors[index] || {};
    const title = String(descriptor.title || "");
    const url = String(descriptor.url || "");
    if (
      (!titleNeedle || title.includes(titleNeedle))
      && hasUrlNeedle(url, urlNeedle)
      && lacksUrlNeedle(url, urlNotNeedle)
    ) {
      return descriptor;
    }
    if (mode === "chrome_auth" && !chromeFallback && !isIgnoredChromeUrl(url) && lacksUrlNeedle(url, urlNotNeedle)) {
      chromeFallback = descriptor;
    }
  }
  return mode === "chrome_auth" ? chromeFallback : null;
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
  const mode = String(request.surface || "cover").trim() || "cover";
  const titleNeedle = String(request.page_title || "").trim();
  const urlNeedle = String(request.page_url_contains || "").trim();
  const timeoutMs = Number(request.timeout_ms || 15000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descriptors = await fetchTargetDescriptors(request);
    const match = pickMatchingDescriptor(descriptors, request);
    if (match && String(match.webSocketDebuggerUrl || "").trim()) {
      return match;
    }
    await delay(250);
  }
  throw new Error(`Could not find ${mode} page matching title=${titleNeedle || "<any>"} url_contains=${urlNeedle || "<any>"}`);
}

async function findTargetPage(browser, request) {
  const mode = String(request.surface || "cover").trim() || "cover";
  const titleNeedle = String(request.page_title || "").trim();
  const urlNeedle = String(request.page_url_contains || "").trim();
  const urlNotNeedle = String(request.page_url_not_contains || "").trim();
  const timeoutMs = Number(request.timeout_ms || 15000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let chromeFallback = null;
    for (const context of browser.contexts()) {
      const pages = context.pages();
      for (let index = pages.length - 1; index >= 0; index -= 1) {
        const page = pages[index];
        const title = await safeTitle(page);
        const url = page.url();
        if (
          (!titleNeedle || title.includes(titleNeedle))
          && hasUrlNeedle(url, urlNeedle)
          && lacksUrlNeedle(url, urlNotNeedle)
        ) {
          return page;
        }
        if (mode === "chrome_auth" && !chromeFallback && !isIgnoredChromeUrl(url) && lacksUrlNeedle(url, urlNotNeedle)) {
          chromeFallback = page;
        }
      }
    }
    if (mode === "chrome_auth" && chromeFallback) {
      return chromeFallback;
    }
    await delay(250);
  }
  throw new Error(`Could not find ${mode} page matching title=${titleNeedle || "<any>"} url_contains=${urlNeedle || "<any>"}`);
}

async function waitForSelector(page, selector, timeoutMs) {
  await page.waitForSelector(selector, { timeout: timeoutMs });
  await page.waitForTimeout(120);
}

async function clickLocator(page, locator, timeoutMs) {
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await locator.click({ timeout: Math.min(timeoutMs, 5000) });
  } catch (_error) {
    try {
      await locator.click({ timeout: timeoutMs, force: true });
    } catch (_forceError) {
      await locator.evaluate(node => node.click());
    }
  }
  await page.waitForTimeout(200);
}

async function ensureConnectRoute(page, timeoutMs) {
  const route = await page.evaluate(() => document.querySelector(".app-shell")?.getAttribute("data-view") || "");
  if (route !== "connect") {
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("route", "connect");
      url.searchParams.set("reset_nav", "1");
      window.location.assign(url.toString());
    });
  }
  await waitForSelector(page, ".links-search", timeoutMs);
  await page.waitForFunction(() => {
    const shell = document.querySelector(".app-shell");
    return shell?.getAttribute("data-view") === "connect";
  }, null, { timeout: timeoutMs });
  await page.waitForTimeout(150);
}

async function waitForConnectReady(page, timeoutMs) {
  await page.waitForFunction(() => {
    const metrics = window.PuckyUiDebug?.linksMetrics?.();
    return Boolean(metrics?.api_token_present) && (Boolean(metrics?.portal_token_present) || Boolean(metrics?.inline_message));
  }, null, { timeout: timeoutMs });
  await page.waitForTimeout(150);
}

async function readLinksState(page) {
  return page.evaluate(() => {
    const metrics = window.PuckyUiDebug?.linksMetrics?.() || null;
    const debugRoot = window.__PUCKY_LINKS_DEBUG__ || null;
    const rows = Array.from(document.querySelectorAll(".links-app-row")).slice(0, 20).map(node => ({
      slug: String(node.getAttribute("data-links-slug") || ""),
      text: String(node.textContent || "").replace(/\s+/g, " ").trim(),
    }));
    return {
      url: window.location.href,
      title: document.title,
      route: document.querySelector(".app-shell")?.getAttribute("data-view") || "",
      metrics,
      last_handoff: debugRoot?.last_handoff || null,
      last_event: debugRoot?.last_event || null,
      rows,
      body_text: String(document.body?.innerText || "").replace(/\s+/g, " ").trim(),
    };
  });
}

async function fillLinksSearch(page, slug, timeoutMs) {
  const search = page.locator(".links-search").first();
  await search.waitFor({ state: "visible", timeout: timeoutMs });
  await search.fill("");
  await search.fill(String(slug || ""));
  await page.waitForFunction(
    appSlug => {
      const metrics = window.PuckyUiDebug?.linksMetrics?.();
      return Boolean(Array.isArray(metrics?.filtered_slugs) && metrics.filtered_slugs.includes(appSlug));
    },
    String(slug || ""),
    { timeout: timeoutMs }
  );
  await page.waitForTimeout(120);
}

async function clickLinksApp(page, slug, timeoutMs) {
  const row = page.locator(`.links-app-row[data-links-slug="${String(slug || "")}"]`).first();
  await clickLocator(page, row, timeoutMs);
}

async function waitForHandoff(page, timeoutMs) {
  await page.waitForFunction(() => {
    const handoff = window.__PUCKY_LINKS_DEBUG__?.last_handoff;
    return Boolean(handoff?.event) && handoff.event !== "handoff_started";
  }, null, { timeout: timeoutMs });
  await page.waitForTimeout(150);
}

async function readGenericPageInfo(page) {
  return page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    body_text: String(document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 2000),
  }));
}

async function runOperation(page, request, op) {
  const timeoutMs = Number(op.timeout_ms || request.timeout_ms || 15000);
  if (op.kind === "ensure_connect_route") {
    await ensureConnectRoute(page, timeoutMs);
    return { kind: op.kind, state: await readLinksState(page) };
  }
  if (op.kind === "wait_for_connect_ready") {
    await waitForConnectReady(page, timeoutMs);
    return { kind: op.kind, state: await readLinksState(page) };
  }
  if (op.kind === "links_state") {
    return { kind: op.kind, state: await readLinksState(page) };
  }
  if (op.kind === "search_app") {
    const slug = String(op.slug || "").trim().toLowerCase();
    if (!slug) {
      throw new Error("search_app requires slug");
    }
    await fillLinksSearch(page, slug, timeoutMs);
    return { kind: op.kind, slug, state: await readLinksState(page) };
  }
  if (op.kind === "click_app") {
    const slug = String(op.slug || "").trim().toLowerCase();
    if (!slug) {
      throw new Error("click_app requires slug");
    }
    await clickLinksApp(page, slug, timeoutMs);
    return { kind: op.kind, slug, state: await readLinksState(page).catch(() => null) };
  }
  if (op.kind === "wait_for_handoff") {
    await waitForHandoff(page, timeoutMs);
    return { kind: op.kind, state: await readLinksState(page) };
  }
  if (op.kind === "page_info") {
    return { kind: op.kind, state: await readGenericPageInfo(page) };
  }
  if (op.kind === "screenshot") {
    const screenshotPath = String(op.path || "").trim();
    if (!screenshotPath) {
      throw new Error("screenshot requires path");
    }
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, timeout: Math.min(timeoutMs, 10000) });
    return {
      kind: op.kind,
      path: screenshotPath,
      state: String(request.surface || "cover") === "cover" ? await readLinksState(page) : await readGenericPageInfo(page),
    };
  }
  throw new Error(`Unsupported links auth browser operation: ${op.kind}`);
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

async function rawReadLinksState(client) {
  return client.evaluate(`(() => {
    const metrics = window.PuckyUiDebug?.linksMetrics?.() || null;
    const debugRoot = window.__PUCKY_LINKS_DEBUG__ || null;
    const rows = Array.from(document.querySelectorAll(".links-app-row")).slice(0, 20).map(node => ({
      slug: String(node.getAttribute("data-links-slug") || ""),
      text: String(node.textContent || "").replace(/\\s+/g, " ").trim(),
    }));
    return {
      url: window.location.href,
      title: document.title,
      route: document.querySelector(".app-shell")?.getAttribute("data-view") || "",
      metrics,
      last_handoff: debugRoot?.last_handoff || null,
      last_event: debugRoot?.last_event || null,
      rows,
      body_text: String(document.body?.innerText || "").replace(/\\s+/g, " ").trim(),
    };
  })()`);
}

async function rawReadGenericPageInfo(client) {
  return client.evaluate(`(() => ({
    url: window.location.href,
    title: document.title,
    body_text: String(document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 2000),
  }))()`);
}

async function rawEnsureConnectRoute(client, timeoutMs) {
  const route = await client.evaluate(`document.querySelector(".app-shell")?.getAttribute("data-view") || ""`);
  if (route !== "connect") {
    await client.evaluate(`(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("route", "connect");
      url.searchParams.set("reset_nav", "1");
      window.location.assign(url.toString());
      return true;
    })()`);
  }
  await rawWaitForValue(
    client,
    `(() => {
      const shell = document.querySelector(".app-shell");
      return Boolean(document.querySelector(".links-search") && shell?.getAttribute("data-view") === "connect");
    })()`,
    value => Boolean(value),
    timeoutMs,
    "Connect route"
  );
  await delay(150);
}

async function rawWaitForConnectReady(client, timeoutMs) {
  await rawWaitForValue(
    client,
    `(() => {
      const metrics = window.PuckyUiDebug?.linksMetrics?.();
      return {
        ready: Boolean(metrics?.api_token_present) && (Boolean(metrics?.portal_token_present) || Boolean(metrics?.inline_message)),
      };
    })()`,
    value => Boolean(value && value.ready),
    timeoutMs,
    "Connect ready"
  );
  await delay(150);
}

async function rawFillLinksSearch(client, slug, timeoutMs) {
  const targetSlug = String(slug || "").trim().toLowerCase();
  const searchResult = await client.evaluate(`(() => {
    const input = document.querySelector(".links-search");
    if (!input) {
      return false;
    }
    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = ${JSON.stringify(targetSlug)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!searchResult) {
    throw new Error("Could not locate .links-search");
  }
  await rawWaitForValue(
    client,
    `(() => {
      const metrics = window.PuckyUiDebug?.linksMetrics?.();
      return Array.isArray(metrics?.filtered_slugs) ? metrics.filtered_slugs : [];
    })()`,
    value => Array.isArray(value) && value.includes(targetSlug),
    timeoutMs,
    `Filtered slugs for ${targetSlug}`
  );
  await delay(120);
}

async function rawClickLinksApp(client, slug) {
  const targetSlug = String(slug || "").trim().toLowerCase();
  const clicked = await client.evaluate(`(() => {
    const row = document.querySelector('.links-app-row[data-links-slug="${targetSlug}"]');
    if (!row) {
      return false;
    }
    row.scrollIntoView({ block: "center", inline: "nearest" });
    row.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not click app row for ${targetSlug}`);
  }
  await delay(200);
}

async function rawWaitForHandoff(client, timeoutMs) {
  await rawWaitForValue(
    client,
    `(() => {
      const handoff = window.__PUCKY_LINKS_DEBUG__?.last_handoff;
      return handoff && handoff.event && handoff.event !== "handoff_started" ? handoff : null;
    })()`,
    value => Boolean(value),
    timeoutMs,
    "Connect handoff"
  );
  await delay(150);
}

async function runRawOperation(client, request, op) {
  const timeoutMs = Number(op.timeout_ms || request.timeout_ms || 15000);
  if (op.kind === "ensure_connect_route") {
    await rawEnsureConnectRoute(client, timeoutMs);
    return { kind: op.kind, state: await rawReadLinksState(client) };
  }
  if (op.kind === "wait_for_connect_ready") {
    await rawWaitForConnectReady(client, timeoutMs);
    return { kind: op.kind, state: await rawReadLinksState(client) };
  }
  if (op.kind === "links_state") {
    return { kind: op.kind, state: await rawReadLinksState(client) };
  }
  if (op.kind === "search_app") {
    const slug = String(op.slug || "").trim().toLowerCase();
    if (!slug) {
      throw new Error("search_app requires slug");
    }
    await rawFillLinksSearch(client, slug, timeoutMs);
    return { kind: op.kind, slug, state: await rawReadLinksState(client) };
  }
  if (op.kind === "click_app") {
    const slug = String(op.slug || "").trim().toLowerCase();
    if (!slug) {
      throw new Error("click_app requires slug");
    }
    await rawClickLinksApp(client, slug);
    return { kind: op.kind, slug, state: await rawReadLinksState(client).catch(() => null) };
  }
  if (op.kind === "wait_for_handoff") {
    await rawWaitForHandoff(client, timeoutMs);
    return { kind: op.kind, state: await rawReadLinksState(client) };
  }
  if (op.kind === "page_info") {
    return { kind: op.kind, state: await rawReadGenericPageInfo(client) };
  }
  if (op.kind === "screenshot") {
    const screenshotPath = String(op.path || "").trim();
    if (!screenshotPath) {
      throw new Error("screenshot requires path");
    }
    await client.captureScreenshot(screenshotPath);
    return {
      kind: op.kind,
      path: screenshotPath,
      state: String(request.surface || "cover") === "cover" ? await rawReadLinksState(client) : await rawReadGenericPageInfo(client),
    };
  }
  throw new Error(`Unsupported links auth browser operation: ${op.kind}`);
}

async function runPlaywrightProof(request) {
  let browser;
  try {
    browser = await chromium.connectOverCDP(String(request.cdp_url || ""));
    const page = await findTargetPage(browser, request);
    const operations = Array.isArray(request.operations) && request.operations.length
      ? request.operations
      : [{ kind: "page_info" }];
    const results = [];
    for (const op of operations) {
      results.push(await runOperation(page, request, op));
    }
    return {
      ok: true,
      surface: String(request.surface || "cover"),
      page_title: await safeTitle(page),
      page_url: page.url(),
      operations: results,
      final_state: String(request.surface || "cover") === "cover" ? await readLinksState(page) : await readGenericPageInfo(page),
    };
  } finally {
    if (browser) {
      await Promise.race([
        browser.close().catch(() => {}),
        delay(1000),
      ]);
    }
  }
}

async function runRawProof(request) {
  const { client, descriptor } = await RawCdpClient.connect(request);
  try {
    const operations = Array.isArray(request.operations) && request.operations.length
      ? request.operations
      : [{ kind: "page_info" }];
    const results = [];
    for (const op of operations) {
      results.push(await runRawOperation(client, request, op));
    }
    const finalState = String(request.surface || "cover") === "cover"
      ? await rawReadLinksState(client)
      : await rawReadGenericPageInfo(client);
    return {
      ok: true,
      surface: String(request.surface || "cover"),
      page_title: String(finalState?.title || descriptor.title || ""),
      page_url: String(finalState?.url || descriptor.url || ""),
      operations: results,
      final_state: finalState,
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
    throw new Error("Usage: phone_links_auth_flow_browser.js <request.json>");
  }
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  try {
    const payload = await runPlaywrightProof(request);
    writeOutput(request, payload);
  } catch (error) {
    if (!shouldFallbackToRawCdp(error)) {
      throw error;
    }
    const payload = await runRawProof(request);
    payload.playwright_fallback_error = String(error && error.message ? error.message : error || "");
    writeOutput(request, payload);
  }
}

main().catch(error => {
  const payload = {
    ok: false,
    error: error && error.message ? error.message : String(error),
  };
  try {
    const requestPath = process.argv[2];
    if (requestPath) {
      const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
      writeOutput(request, payload);
      process.exit(1);
    }
  } catch (_error) {
    // Fall through to stderr below.
  }
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
