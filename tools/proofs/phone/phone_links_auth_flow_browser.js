#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeCdpBaseUrl(cdpUrl) {
  return String(cdpUrl || "").replace(/\/+$/, "");
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

function rawValue(result) {
  if (!result) {
    return undefined;
  }
  if ("value" in result) {
    return result.value;
  }
  return undefined;
}

class RawCdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 0;
    this.pending = new Map();
    this.socket = null;
  }

  async open() {
    const WebSocketImpl = globalThis.WebSocket;
    if (!WebSocketImpl) {
      throw new Error("WebSocket is unavailable in this Node runtime.");
    }
    await new Promise((resolve, reject) => {
      const socket = new WebSocketImpl(this.wsUrl);
      this.socket = socket;
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", event => reject(event.error || new Error("CDP websocket failed")));
      socket.addEventListener("message", event => {
        const payload = JSON.parse(String(event.data || "{}"));
        if (payload.id && this.pending.has(payload.id)) {
          const entry = this.pending.get(payload.id);
          this.pending.delete(payload.id);
          if (payload.error) {
            entry.reject(new Error(String(payload.error.message || payload.error.code || "CDP error")));
          } else {
            entry.resolve(payload.result || {});
          }
        }
      });
      socket.addEventListener("close", () => {
        for (const [id, entry] of this.pending.entries()) {
          this.pending.delete(id);
          entry.reject(new Error(`CDP websocket closed before response ${id}`));
        }
      });
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  send(method, params = {}) {
    if (!this.socket) {
      throw new Error("CDP websocket is not open.");
    }
    const id = ++this.nextId;
    const message = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(message);
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return rawValue(result.result);
  }

  async waitFor(expression, timeoutMs, description) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.evaluate(expression).catch(() => false);
      if (ok) {
        return true;
      }
      await delay(200);
    }
    throw new Error(description);
  }

  async screenshot(filePath) {
    await this.send("Page.bringToFront").catch(() => {});
    const result = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(String(result.data || ""), "base64"));
    return filePath;
  }

  async close() {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      this.socket.close();
    }
  }
}

async function maybeUsePlaywright(request) {
  void request;
  void chromium.connectOverCDP;
  return false;
}

async function readLinksState(client) {
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

async function readPerfState(client) {
  return client.evaluate(`(() => {
    const metrics = window.PuckyUiDebug?.perfMetrics?.() || null;
    return {
      url: window.location.href,
      title: document.title,
      route: document.querySelector(".app-shell")?.getAttribute("data-view") || "",
      metrics,
      body_text: String(document.body?.innerText || "").replace(/\\s+/g, " ").trim(),
    };
  })()`);
}

async function ensureRoute(client, route, timeoutMs) {
  const targetRoute = String(route || "").trim() || "home";
  const currentRoute = await client.evaluate(`document.querySelector(".app-shell")?.getAttribute("data-view") || ""`);
  const currentUrl = await client.evaluate(`window.location.href || ""`).catch(() => "");
  const currentPerfMetrics = await client.evaluate(`window.PuckyUiDebug?.perfMetrics?.() || null`).catch(() => null);
  const perfEnabled = Boolean(currentPerfMetrics && currentPerfMetrics.enabled);
  const perfRunId = String(process.env.PUCKY_PERF_RUN_ID || "").trim();
  const missingPerfRunId = perfRunId && !String(currentUrl || "").includes(`perf_run_id=${encodeURIComponent(perfRunId)}`);
  if (currentRoute !== targetRoute || !perfEnabled || missingPerfRunId) {
    await client.evaluate(`(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("route", ${JSON.stringify(targetRoute)});
      url.searchParams.set("reset_nav", "1");
      url.searchParams.set("debug_perf", "1");
      const perfRunId = ${JSON.stringify(perfRunId)};
      if (perfRunId) {
        url.searchParams.set("perf_run_id", perfRunId);
      }
      window.location.assign(url.toString());
      return true;
    })()`);
  }
  await client.waitFor(
    `(() => {
      const metrics = window.PuckyUiDebug?.perfMetrics?.();
      return Boolean(metrics && metrics.route === ${JSON.stringify(targetRoute)} && metrics.route_ready);
    })()`,
    timeoutMs,
    `Route ${targetRoute} never became perf-ready.`
  );
  return readPerfState(client);
}

async function ensureConnectRoute(client, timeoutMs) {
  await ensureRoute(client, "connect", timeoutMs);
  await client.waitFor(
    `(() => document.querySelector(".app-shell")?.getAttribute("data-view") === "connect" && document.querySelector(".links-search"))()`,
    timeoutMs,
    "Connect route never became active."
  );
  return readLinksState(client);
}

async function waitForConnectReady(client, timeoutMs) {
  await client.waitFor(
    `(() => {
      const metrics = window.PuckyUiDebug?.linksMetrics?.();
      return Boolean(metrics?.api_token_present) && (Boolean(metrics?.portal_token_present) || Boolean(metrics?.inline_message));
    })()`,
    timeoutMs,
    "Connect never became ready."
  );
  return readLinksState(client);
}

async function searchApp(client, slug, timeoutMs) {
  const appSlug = String(slug || "").trim();
  await client.evaluate(`(() => {
    const input = document.querySelector(".links-search");
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = ${JSON.stringify(appSlug)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await client.waitFor(
    `(() => {
      const metrics = window.PuckyUiDebug?.linksMetrics?.();
      return Array.isArray(metrics?.filtered_slugs) && metrics.filtered_slugs.includes(${JSON.stringify(appSlug)});
    })()`,
    timeoutMs,
    `Connect search never exposed ${appSlug} in filtered_slugs.`
  );
  return readLinksState(client);
}

async function clickApp(client, slug, timeoutMs) {
  const appSlug = String(slug || "").trim();
  const clicked = await client.evaluate(`(() => {
    const row = document.querySelector('.links-app-row[data-links-slug="${appSlug.replace(/"/g, '\\"')}"]');
    if (!(row instanceof HTMLElement)) return false;
    row.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not find Connect row for ${appSlug}.`);
  }
  await delay(Math.min(timeoutMs, 500));
  return readLinksState(client);
}

async function waitForHandoff(client, timeoutMs) {
  await client.waitFor(
    `(() => {
      const handoff = window.__PUCKY_LINKS_DEBUG__?.last_handoff;
      return Boolean(handoff?.event) && handoff.event !== "handoff_started";
    })()`,
    timeoutMs,
    "Connect handoff never completed."
  );
  return readLinksState(client);
}

async function pageInfo(client) {
  return client.evaluate(`(() => ({
    url: window.location.href,
    title: document.title,
    body_text: String(document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 2000),
  }))()`);
}

async function clickHomeTile(client, route, timeoutMs) {
  const targetRoute = String(route || "").trim() || "home";
  const clicked = await client.evaluate(`(() => {
    const tile = document.querySelector('.light-app-tile[data-light-app-route="${targetRoute.replace(/"/g, '\\"')}"]');
    if (!(tile instanceof HTMLElement)) return false;
    tile.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not find Home tile for ${targetRoute}.`);
  }
  await client.waitFor(
    `(() => {
      const metrics = window.PuckyUiDebug?.perfMetrics?.();
      return Boolean(metrics && metrics.route === ${JSON.stringify(targetRoute)} && metrics.route_ready);
    })()`,
    timeoutMs,
    `Home tile ${targetRoute} never became perf-ready.`
  );
  return readPerfState(client);
}

async function clickSelector(client, selector, timeoutMs) {
  const target = String(selector || "").trim();
  const clicked = await client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(target)});
    if (!(node instanceof HTMLElement)) return false;
    node.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not find selector ${target}.`);
  }
  await delay(Math.min(timeoutMs, 250));
  return {
    perf: await readPerfState(client),
    page: await pageInfo(client),
  };
}

async function waitForSelector(client, selector, timeoutMs) {
  const target = String(selector || "").trim();
  await client.waitFor(
    `(() => Boolean(document.querySelector(${JSON.stringify(target)})))()`,
    timeoutMs,
    `Selector never appeared: ${target}`
  );
  return {
    perf: await readPerfState(client),
    page: await pageInfo(client),
  };
}

async function runOperation(client, request, operation) {
  const timeoutMs = Number(operation.timeout_ms || request.timeout_ms || 15000);
  if (operation.kind === "ensure_route") {
    return { kind: operation.kind, route: String(operation.route || ""), state: await ensureRoute(client, operation.route, timeoutMs) };
  }
  if (operation.kind === "ensure_connect_route") {
    return { kind: operation.kind, state: await ensureConnectRoute(client, timeoutMs) };
  }
  if (operation.kind === "perf_state") {
    return { kind: operation.kind, state: await readPerfState(client) };
  }
  if (operation.kind === "wait_for_connect_ready") {
    return { kind: operation.kind, state: await waitForConnectReady(client, timeoutMs) };
  }
  if (operation.kind === "links_state") {
    return { kind: operation.kind, state: await readLinksState(client) };
  }
  if (operation.kind === "search_app") {
    return { kind: operation.kind, slug: String(operation.slug || ""), state: await searchApp(client, operation.slug, timeoutMs) };
  }
  if (operation.kind === "click_app") {
    return { kind: operation.kind, slug: String(operation.slug || ""), state: await clickApp(client, operation.slug, timeoutMs) };
  }
  if (operation.kind === "wait_for_handoff") {
    return { kind: operation.kind, state: await waitForHandoff(client, timeoutMs) };
  }
  if (operation.kind === "page_info") {
    return { kind: operation.kind, state: await pageInfo(client) };
  }
  if (operation.kind === "click_home_tile") {
    return { kind: operation.kind, route: String(operation.route || ""), state: await clickHomeTile(client, operation.route, timeoutMs) };
  }
  if (operation.kind === "click_selector") {
    return { kind: operation.kind, selector: String(operation.selector || ""), state: await clickSelector(client, operation.selector, timeoutMs) };
  }
  if (operation.kind === "wait_for_selector") {
    return { kind: operation.kind, selector: String(operation.selector || ""), state: await waitForSelector(client, operation.selector, timeoutMs) };
  }
  if (operation.kind === "screenshot") {
    const targetPath = path.resolve(String(operation.path || ""));
    if (!targetPath) {
      throw new Error("screenshot operation requires path");
    }
    await client.screenshot(targetPath);
    return { kind: operation.kind, path: targetPath };
  }
  throw new Error(`Unsupported operation kind: ${operation.kind}`);
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error("Usage: phone_links_auth_flow_browser.js <request.json>");
  }
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const outputPath = path.resolve(String(request.output_path || ""));
  const surface = String(request.surface || "cover").trim() || "cover";
  const mode = surface;
  const descriptor = await findTargetDescriptor(request);
  const client = new RawCdpClient(String(descriptor.webSocketDebuggerUrl || ""));
  const results = [];
  const response = {
    ok: false,
    surface: surface,
    mode,
    cdp_url: request.cdp_url,
    descriptor: {
      id: descriptor.id || "",
      title: descriptor.title || "",
      url: descriptor.url || "",
    },
    used_playwright_probe: await maybeUsePlaywright(request),
    results,
    final_state: null,
  };

  try {
    await client.open();
    for (const operation of request.operations || []) {
      const result = await runOperation(client, request, operation);
      results.push(result);
      if (result && Object.prototype.hasOwnProperty.call(result, "state")) {
        response.final_state = result.state;
      }
    }
    if (mode === "chrome_auth" && !response.final_state) {
      response.final_state = await pageInfo(client);
    }
    response.ok = true;
  } catch (error) {
    response.error = String(error?.stack || error?.message || error);
  } finally {
    await client.close().catch(() => {});
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(response, null, 2)}\n`);
    }
  }

  if (!response.ok) {
    throw new Error(String(response.error || "Unknown browser helper failure"));
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
