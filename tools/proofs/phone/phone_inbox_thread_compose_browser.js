#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeCdpBaseUrl(cdpUrl) {
  return String(cdpUrl || "").replace(/\/+$/, "");
}

function jsonLiteral(value) {
  return JSON.stringify(value);
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

function pickMatchingDescriptor(descriptors, request) {
  const urlNeedle = String(request.page_url_contains || "/ui/pucky/latest").trim();
  const titleNeedle = String(request.page_title || "Pucky Cover").trim();
  for (let index = descriptors.length - 1; index >= 0; index -= 1) {
    const descriptor = descriptors[index] || {};
    const title = String(descriptor.title || "");
    const url = String(descriptor.url || "");
    if (titleNeedle && !title.includes(titleNeedle)) {
      continue;
    }
    if (urlNeedle && !url.includes(urlNeedle) && !url.includes("/ui/pucky/latest")) {
      continue;
    }
    if (String(descriptor.webSocketDebuggerUrl || "").trim()) {
      return descriptor;
    }
  }
  return null;
}

async function findTargetDescriptor(request) {
  const timeoutMs = Number(request.timeout_ms || 15000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descriptors = await fetchTargetDescriptors(request);
    const match = pickMatchingDescriptor(descriptors, request);
    if (match) {
      return match;
    }
    await delay(250);
  }
  throw new Error(`Could not find Chrome page matching ${request.page_url_contains || "/ui/pucky/latest"}`);
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

async function ensureThreadComposeTrace(client) {
  return client.evaluate(`(() => {
    if (window.__threadComposeProofTrace) {
      return { installed: true, requests: window.__threadComposeProofTrace.turnRequests.length };
    }
    const store = {
      turnRequests: [],
      installCount: 1,
    };
    const normalizeBody = (body) => {
      if (!body) return "";
      if (typeof body === "string") return body;
      if (body instanceof URLSearchParams) return body.toString();
      if (body instanceof FormData) {
        return Array.from(body.entries()).map(([key, value]) => {
          if (typeof value === "string") return key + "=" + value;
          const name = value && typeof value.name === "string" ? value.name : "blob";
          return key + "=" + name;
        }).join("&");
      }
      return String(body);
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const input = args[0];
      const init = args[1] || {};
      const url = typeof input === "string" ? input : String(input && input.url || "");
      const method = String(init.method || (input && input.method) || "GET").toUpperCase();
      let entry = null;
      if (/\\/api\\/turn\\/text(?:$|[?#])/.test(url)) {
        entry = {
          at: new Date().toISOString(),
          url,
          method,
          post_data: normalizeBody(init.body || (input && input.body) || ""),
          status: 0,
        };
        store.turnRequests.push(entry);
      }
      const response = await originalFetch(...args);
      if (entry) {
        entry.status = Number(response.status || 0);
      }
      return response;
    };
    window.__threadComposeProofTrace = store;
    return { installed: true, requests: 0 };
  })()`);
}

function appShellReadyExpression(expectedUrl = "") {
  return `(() => {
    const shell = document.querySelector(".app-shell, .light-shell");
    if (!shell) return false;
    const input = document.querySelector("#app, body");
    return Boolean(input)${expectedUrl ? ` && window.location.href.includes(${jsonLiteral(expectedUrl)})` : ""};
  })()`;
}

async function gotoUrl(client, url, timeoutMs) {
  await client.evaluate(`(() => {
    const target = ${jsonLiteral(url)};
    if (window.location.href !== target) {
      window.location.assign(target);
    }
    return true;
  })()`);
  await client.waitFor(appShellReadyExpression("/ui/pucky/latest"), timeoutMs, "App shell did not load after goto_url.");
  await ensureThreadComposeTrace(client);
  return true;
}

async function waitForSelector(client, selector, timeoutMs) {
  await client.waitFor(
    `(() => Boolean(document.querySelector(${jsonLiteral(selector)})))()`,
    timeoutMs,
    `Selector never appeared: ${selector}`,
  );
}

async function clickSelector(client, selector, timeoutMs) {
  await waitForSelector(client, selector, timeoutMs);
  const clicked = await client.evaluate(`(() => {
    const node = document.querySelector(${jsonLiteral(selector)});
    if (!node) return false;
    node.scrollIntoView({ block: "center", inline: "center" });
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    node.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not click selector: ${selector}`);
  }
  await delay(220);
}

async function clickSelectorContainingText(client, selector, expectedText, timeoutMs) {
  await client.waitFor(
    `(() => {
      const nodes = Array.from(document.querySelectorAll(${jsonLiteral(selector)}));
      return nodes.some(node => String(node.textContent || "").includes(${jsonLiteral(expectedText)}));
    })()`,
    timeoutMs,
    `Selector never matched text: ${selector} :: ${expectedText}`,
  );
  const clicked = await client.evaluate(`(() => {
    const nodes = Array.from(document.querySelectorAll(${jsonLiteral(selector)}));
    const node = nodes.find(candidate => String(candidate.textContent || "").includes(${jsonLiteral(expectedText)}));
    if (!node) return false;
    node.scrollIntoView({ block: "center", inline: "center" });
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    node.click();
    return true;
  })()`);
  if (!clicked) {
    throw new Error(`Could not click selector containing text: ${selector} :: ${expectedText}`);
  }
  await delay(220);
}

async function fillSelector(client, selector, value, timeoutMs) {
  await waitForSelector(client, selector, timeoutMs);
  const filled = await client.evaluate(`(() => {
    const node = document.querySelector(${jsonLiteral(selector)});
    if (!(node instanceof HTMLInputElement) && !(node instanceof HTMLTextAreaElement)) {
      return false;
    }
    node.focus();
    node.value = ${jsonLiteral(value)};
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!filled) {
    throw new Error(`Could not fill selector: ${selector}`);
  }
  await delay(180);
}

async function selectorRect(client, selector, timeoutMs) {
  await waitForSelector(client, selector, timeoutMs);
  const rect = await client.evaluate(`(() => {
    const node = document.querySelector(${jsonLiteral(selector)});
    if (!node) return null;
    node.scrollIntoView({ block: "center", inline: "center" });
    const box = node.getBoundingClientRect();
    return {
      left: Number(box.left || 0),
      top: Number(box.top || 0),
      width: Number(box.width || 0),
      height: Number(box.height || 0),
      center_x: Number((box.left || 0) + ((box.width || 0) / 2)),
      center_y: Number((box.top || 0) + ((box.height || 0) / 2)),
      device_scale: Number(window.devicePixelRatio || 1),
    };
  })()`);
  if (!rect) {
    throw new Error(`Could not read selector rect: ${selector}`);
  }
  return rect;
}

async function waitForText(client, selector, expected, timeoutMs) {
  await client.waitFor(
    `(() => {
      const nodes = Array.from(document.querySelectorAll(${jsonLiteral(selector)}));
      return nodes.some(node => String(node.textContent || "").includes(${jsonLiteral(expected)}));
    })()`,
    timeoutMs,
    `Text never appeared for ${selector}: ${expected}`,
  );
}

async function setProofReplyDelay(client, value) {
  await client.evaluate(`(() => {
    window.PuckyComposerProofReplyDelayMs = Number(${Number(value) || 0});
    return window.PuckyComposerProofReplyDelayMs;
  })()`);
  await delay(120);
}

async function waitForTurnRequestCount(client, minimum, timeoutMs) {
  await ensureThreadComposeTrace(client);
  await client.waitFor(
    `(() => {
      const trace = window.__threadComposeProofTrace;
      return Boolean(trace && Array.isArray(trace.turnRequests) && trace.turnRequests.length >= ${Number(minimum) || 0});
    })()`,
    timeoutMs,
    `Turn request count never reached ${minimum}`,
  );
}

async function waitForPendingFeedStatus(client, token, status, timeoutMs) {
  await client.waitFor(
    `(() => {
      const cards = Array.from(document.querySelectorAll("article.card-outbound"));
      return cards.some(card => {
        const preview = String(card.querySelector(".card-outbound-preview")?.textContent || "");
        const label = String(card.querySelector(".card-outbound-status")?.textContent || "");
        return preview.includes(${jsonLiteral(token)}) && label.includes(${jsonLiteral(status)});
      });
    })()`,
    timeoutMs,
    `Pending feed status ${status} never appeared for ${token}`,
  );
}

async function threadComposeSnapshot(client) {
  return client.evaluate(`(() => {
    const detail = document.getElementById("detail");
    const textarea = detail?.querySelector(".thread-composer-input");
    const send = detail?.querySelector(".thread-composer-send");
    const status = detail?.querySelector(".thread-composer-status");
    const chips = Array.from(detail?.querySelectorAll(".thread-composer-chip-label") || []).map(node => String(node.textContent || "").trim());
    const bubbleTexts = Array.from(detail?.querySelectorAll(".bubble") || []).map(node => String(node.textContent || "").replace(/\\s+/g, " ").trim());
    const attachmentLabels = Array.from(detail?.querySelectorAll(".bubble-attachment-chip") || []).map(node => String(node.textContent || "").replace(/\\s+/g, " ").trim());
    return {
      title: String(detail?.querySelector(".detail-title")?.textContent || "").trim(),
      thread_id: String(detail?.getAttribute("data-detail-thread-id") || "").trim(),
      type: String(detail?.getAttribute("data-detail-type") || "").trim(),
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

async function waitForThreadComposeThreadId(client, timeoutMs) {
  await client.waitFor(
    `(() => {
      const detail = document.getElementById("detail");
      return Boolean(detail && String(detail.getAttribute("data-detail-thread-id") || "").trim());
    })()`,
    timeoutMs,
    "Thread compose detail never resolved a real thread id.",
  );
  return threadComposeSnapshot(client);
}

async function waitForThreadComposeReady(client, draftToken, timeoutMs) {
  await client.waitFor(
    `(() => {
      const textarea = document.querySelector("#detail .thread-composer-input");
      const send = document.querySelector("#detail .thread-composer-send");
      return Boolean(
        textarea
        && send
        && String(textarea.value || "").includes(${jsonLiteral(draftToken || "")})
        && !send.disabled
      );
    })()`,
    timeoutMs,
    `Thread composer never became ready for draft token ${draftToken}`,
  );
  return threadComposeSnapshot(client);
}

async function describePage(client) {
  return client.evaluate(`(() => {
    if (window.PuckyUiDebug && typeof window.PuckyUiDebug.describe === "function") {
      return window.PuckyUiDebug.describe();
    }
    const shell = document.querySelector(".app-shell, .light-shell");
    const detail = document.getElementById("detail");
    return {
      route: shell?.getAttribute("data-view") || shell?.getAttribute("data-light-route") || "",
      detail: {
        open: Boolean(detail && detail.getAttribute("aria-hidden") === "false"),
        type: detail?.getAttribute("data-detail-type") || "",
        thread_id: detail?.getAttribute("data-detail-thread-id") || "",
      },
    };
  })()`);
}

async function runOperation(client, request, op) {
  const timeoutMs = Number(op.timeout_ms || request.timeout_ms || 15000);
  if (op.kind === "goto_url") {
    await gotoUrl(client, String(op.url || ""), timeoutMs);
    return { kind: op.kind, url: String(op.url || ""), detail: await describePage(client) };
  }
  if (op.kind === "screenshot") {
    const screenshotPath = String(op.path || "").trim();
    if (!screenshotPath) {
      throw new Error("screenshot requires path");
    }
    await client.screenshot(screenshotPath);
    return { kind: op.kind, path: screenshotPath };
  }
  if (op.kind === "click_selector") {
    await clickSelector(client, String(op.selector || ""), timeoutMs);
    return { kind: op.kind, selector: String(op.selector || ""), detail: await describePage(client) };
  }
  if (op.kind === "click_selector_containing_text") {
    await clickSelectorContainingText(client, String(op.selector || ""), String(op.text || op.expected || ""), timeoutMs);
    return {
      kind: op.kind,
      selector: String(op.selector || ""),
      text: String(op.text || op.expected || ""),
      detail: await describePage(client),
    };
  }
  if (op.kind === "wait_for_selector") {
    await waitForSelector(client, String(op.selector || ""), timeoutMs);
    return { kind: op.kind, selector: String(op.selector || ""), detail: await describePage(client) };
  }
  if (op.kind === "selector_rect") {
    return { kind: op.kind, selector: String(op.selector || ""), rect: await selectorRect(client, String(op.selector || ""), timeoutMs) };
  }
  if (op.kind === "thread_compose_snapshot") {
    return { kind: op.kind, snapshot: await threadComposeSnapshot(client) };
  }
  if (op.kind === "fill_selector") {
    await fillSelector(client, String(op.selector || ""), String(op.value || ""), timeoutMs);
    return { kind: op.kind, selector: String(op.selector || ""), detail: await describePage(client) };
  }
  if (op.kind === "set_proof_reply_delay_ms") {
    await setProofReplyDelay(client, op.value);
    return { kind: op.kind, value: Number(op.value || 0) };
  }
  if (op.kind === "wait_for_turn_request_count") {
    await waitForTurnRequestCount(client, Number(op.minimum || 0), timeoutMs);
    const requests = await client.evaluate(`(() => window.__threadComposeProofTrace?.turnRequests || [])()`);
    return { kind: op.kind, count: Array.isArray(requests) ? requests.length : 0 };
  }
  if (op.kind === "wait_for_pending_feed_status") {
    await waitForPendingFeedStatus(client, String(op.token || ""), String(op.status || ""), timeoutMs);
    return { kind: op.kind, token: String(op.token || ""), status: String(op.status || ""), detail: await describePage(client) };
  }
  if (op.kind === "wait_for_text") {
    await waitForText(client, String(op.selector || ""), String(op.expected || op.text || ""), timeoutMs);
    return { kind: op.kind, selector: String(op.selector || ""), expected: String(op.expected || op.text || ""), detail: await describePage(client) };
  }
  if (op.kind === "wait_for_thread_compose_thread_id") {
    return { kind: op.kind, snapshot: await waitForThreadComposeThreadId(client, timeoutMs) };
  }
  if (op.kind === "turn_request_events") {
    const requests = await client.evaluate(`(() => window.__threadComposeProofTrace?.turnRequests || [])()`);
    return { kind: op.kind, requests: Array.isArray(requests) ? requests : [] };
  }
  if (op.kind === "turn_request_count") {
    const requests = await client.evaluate(`(() => window.__threadComposeProofTrace?.turnRequests || [])()`);
    return { kind: op.kind, count: Array.isArray(requests) ? requests.length : 0 };
  }
  if (op.kind === "wait_for_thread_compose_ready") {
    return { kind: op.kind, snapshot: await waitForThreadComposeReady(client, String(op.draft_token || ""), timeoutMs) };
  }
  if (op.kind === "describe") {
    return { kind: op.kind, detail: await describePage(client) };
  }
  throw new Error(`Unsupported browser operation: ${op.kind}`);
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error("Usage: phone_inbox_thread_compose_browser.js <request.json>");
  }
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const descriptor = await findTargetDescriptor(request);
  const client = new RawCdpClient(String(descriptor.webSocketDebuggerUrl || ""));
  try {
    await client.open();
    await client.waitFor(appShellReadyExpression("/ui/pucky/latest"), Number(request.timeout_ms || 15000), "App shell never became ready in WebView.");
    await ensureThreadComposeTrace(client);
    const operations = Array.isArray(request.operations) && request.operations.length
      ? request.operations
      : [{ kind: "describe" }];
    const results = [];
    for (const op of operations) {
      results.push(await runOperation(client, request, op));
    }
    const output = {
      ok: true,
      page_url: String(descriptor.url || ""),
      final_surface: await describePage(client),
      operations: results,
    };
    const outputPath = String(request.output_path || "").trim();
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
      return;
    }
    process.stdout.write(JSON.stringify(output, null, 2));
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 1;
});
