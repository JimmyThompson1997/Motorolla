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

function rawValue(result) {
  if (!result) {
    return undefined;
  }
  if ("value" in result) {
    return result.value;
  }
  return undefined;
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
  for (let index = descriptors.length - 1; index >= 0; index -= 1) {
    const descriptor = descriptors[index] || {};
    const url = String(descriptor.url || "");
    if (urlNeedle && !url.includes(urlNeedle)) {
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

async function ensureContactsRoute(client, request) {
  const routeUrl = String(request.page_url || "").trim();
  if (routeUrl) {
    await client.evaluate(`(() => {
      const target = ${JSON.stringify(routeUrl)};
      if (window.location.href !== target) {
        window.location.assign(target);
      }
      return true;
    })()`);
  } else {
    await client.evaluate(`(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("route", "contacts");
      url.searchParams.set("reset_nav", "1");
      window.location.assign(url.toString());
      return true;
    })()`);
  }
  await client.waitFor(
    `(() => {
      const shell = document.querySelector(".light-shell");
      const search = document.querySelector(".light-contacts-search");
      return shell?.getAttribute("data-light-route") === "contacts" && search instanceof HTMLInputElement;
    })()`,
    Number(request.timeout_ms || 15000),
    "Contacts route never became ready in Chrome."
  );
  return readContactDetailState(client);
}

async function setContactsSearchQuery(client, query) {
  return client.evaluate(`(() => {
    const input = document.querySelector(".light-contacts-search");
    if (!(input instanceof HTMLInputElement)) {
      return { ok: false, reason: "search_input_missing" };
    }
    const nextValue = ${JSON.stringify(String(query || ""))};
    input.focus({ preventScroll: true });
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("search", { bubbles: true }));
    return { ok: true, query: input.value };
  })()`);
}

async function openContactDetail(client, contactId) {
  const normalizedId = String(contactId || "").trim();
  await client.waitFor(
    `(() => document.querySelector(${JSON.stringify(`.light-contact-row[data-contact-id="${normalizedId}"]`)}) instanceof HTMLButtonElement)()`,
    15000,
    `Contact row never appeared for ${normalizedId}`
  );
  await client.evaluate(`(() => {
    const row = document.querySelector(\`.light-contact-row[data-contact-id="${normalizedId}"]\`);
    if (!(row instanceof HTMLButtonElement)) {
      return false;
    }
    row.click();
    return true;
  })()`);
  await client.waitFor(
    `(() => {
      const shell = document.querySelector(".light-shell");
      const pageRoot = document.querySelector(".light-contact-detail-page");
      return shell?.getAttribute("data-light-route") === "contact-detail"
        && pageRoot instanceof HTMLElement
        && pageRoot.getAttribute("data-contact-detail-id") === ${JSON.stringify(normalizedId)};
    })()`,
    15000,
    `Contact detail never opened for ${normalizedId}`
  );
  return readContactDetailState(client);
}

async function enterContactEditMode(client) {
  await client.evaluate(`(() => {
    const button = document.querySelector('[data-contact-detail-action="edit"]');
    if (!(button instanceof HTMLButtonElement)) {
      return false;
    }
    button.click();
    return true;
  })()`);
  await client.waitFor(
    `(() => {
      const pageRoot = document.querySelector(".light-contact-detail-page");
      return pageRoot instanceof HTMLElement && pageRoot.getAttribute("data-contact-detail-mode") === "edit";
    })()`,
    15000,
    "Contact detail never entered edit mode."
  );
  return readContactDetailState(client);
}

async function installContactEditTrace(client, fieldName) {
  const fieldKey = String(fieldName || "").trim();
  return client.evaluate(`(() => {
    if (!window.__contactEditTraceStore) {
      window.__contactEditTraceStore = {};
    }
    const store = {
      currentNode: null,
      currentToken: 0,
      events: [],
      initialToken: 0,
      initialValue: "",
    };
    const selector = \`[data-contact-edit-field="${fieldKey}"]\`;
    const bindFieldNode = () => {
      const next = document.querySelector(selector);
      if (next !== store.currentNode) {
        store.currentNode = next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement ? next : null;
        store.currentToken += 1;
        if (store.currentNode instanceof HTMLElement) {
          store.currentNode.dataset.traceToken = String(store.currentToken);
        }
        return true;
      }
      return false;
    };
    const readValue = () => store.currentNode instanceof HTMLInputElement || store.currentNode instanceof HTMLTextAreaElement
      ? store.currentNode.value
      : "";
    const record = (type, event = null) => {
      const target = event?.target instanceof HTMLElement ? event.target : null;
      const shouldRecord = !target || target.matches(selector) || target === store.currentNode;
      if (!shouldRecord) {
        return;
      }
      store.events.push({
        type,
        nodeToken: store.currentToken,
        activeName: document.activeElement?.getAttribute?.("data-contact-edit-field") || "",
        value: readValue(),
        key: event?.key || "",
        data: event?.data || "",
        inputType: event?.inputType || "",
        timestampMs: Date.now(),
      });
    };
    bindFieldNode();
    ["focusin", "focusout", "blur", "beforeinput", "input", "keydown", "keyup"].forEach(type => {
      document.addEventListener(type, event => {
        if (bindFieldNode()) {
          record("contact-edit-node-changed", null);
        }
        record(type, event);
      }, true);
    });
    new MutationObserver(() => {
      if (bindFieldNode()) {
        record("contact-edit-node-changed", null);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
    window.__contactEditTraceStore[fieldKey] = store;
    if (store.currentNode && !store.currentToken) {
      store.currentToken = 1;
      store.currentNode.dataset.traceToken = String(store.currentToken);
    }
    store.events = [];
    store.initialToken = store.currentToken;
    store.initialValue = readValue();
    return {
      initialToken: Number(store.initialToken || 0),
      initialValue: String(store.initialValue || ""),
    };
  })()`);
}

async function readContactEditTrace(client, fieldName) {
  const fieldKey = String(fieldName || "").trim();
  return client.evaluate(`(() => {
    const store = (window.__contactEditTraceStore || {})[${JSON.stringify(fieldKey)}] || {};
    const current = document.querySelector(\`[data-contact-edit-field="${fieldKey}"]\`);
    const events = Array.isArray(store.events) ? store.events.slice() : [];
    const trace_event_counts = events.reduce((counts, event) => {
      const key = String(event?.type || "");
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    return {
      initialToken: Number(store.initialToken || 0),
      initialValue: String(store.initialValue || ""),
      finalToken: Number(store.currentToken || 0),
      finalValue: current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement ? current.value : "",
      events,
      trace_event_counts,
    };
  })()`);
}

async function readContactDetailState(client) {
  return client.evaluate(`(() => {
    const shell = document.querySelector(".light-shell");
    const pageRoot = document.querySelector(".light-contact-detail-page");
    const identity = pageRoot?.querySelector(".light-contact-detail-identity");
    const titleNode = pageRoot?.querySelector(".light-contact-detail-title");
    const identityStyle = identity ? getComputedStyle(identity) : null;
    const titleStyle = titleNode ? getComputedStyle(titleNode) : null;
    const fieldValue = key => {
      const input = document.querySelector(\`[data-contact-edit-field="\${key}"]\`);
      return input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement ? input.value : "";
    };
    const activityValues = Array.from(document.querySelectorAll(".light-contact-detail-activity-host .light-info-row"))
      .map(row => String(row.querySelector(".light-text-stack span")?.textContent || row.textContent || "").replace(/\\s+/g, " ").trim())
      .filter(Boolean);
    const identityRect = identity instanceof HTMLElement
      ? (() => {
          const rect = identity.getBoundingClientRect();
          return {
            top: Number(rect.top || 0),
            left: Number(rect.left || 0),
            width: Number(rect.width || 0),
            height: Number(rect.height || 0),
          };
        })()
      : null;
    const backgroundColor = String(identityStyle?.backgroundColor || "").trim().toLowerCase();
    const hasTransparentBackground = !backgroundColor || backgroundColor === "rgba(0, 0, 0, 0)" || backgroundColor === "transparent";
    const borderWidth = [
      Number.parseFloat(identityStyle?.borderTopWidth || "0"),
      Number.parseFloat(identityStyle?.borderRightWidth || "0"),
      Number.parseFloat(identityStyle?.borderBottomWidth || "0"),
      Number.parseFloat(identityStyle?.borderLeftWidth || "0"),
    ].some(value => Number.isFinite(value) && value > 0);
    const borderRadius = Number.parseFloat(identityStyle?.borderRadius || "0");
    return {
      route: shell?.getAttribute("data-light-route") || "",
      detailId: pageRoot?.getAttribute("data-contact-detail-id") || "",
      mode: pageRoot?.getAttribute("data-contact-detail-mode") || "view",
      action: document.querySelector("[data-contact-detail-action]")?.getAttribute("data-contact-detail-action") || "",
      title: String(pageRoot?.querySelector(".light-contact-detail-title")?.textContent || "").trim(),
      titleFontSizePx: Number.parseFloat(titleStyle?.fontSize || "0") || 0,
      firstName: fieldValue("first_name"),
      lastName: fieldValue("last_name"),
      summary: fieldValue("summary"),
      email: fieldValue("email"),
      phone: fieldValue("phone"),
      activityValues,
      activeField: document.activeElement?.getAttribute?.("data-contact-edit-field") || "",
      hasPhotoPreview: Boolean(pageRoot?.querySelector(".light-avatar.has-photo img")),
      hasHeroContainer: Boolean(pageRoot?.querySelector(".light-contact-detail-hero")),
      hasIdentityHeader: Boolean(identity),
      identityHasCardChrome: Boolean(identityStyle && (!hasTransparentBackground || identityStyle.boxShadow !== "none" || borderWidth || (Number.isFinite(borderRadius) && borderRadius > 0))),
      identityRect,
      viewport: {
        width: Number(window.innerWidth || 0),
        height: Number(window.innerHeight || 0),
        devicePixelRatio: Number(window.devicePixelRatio || 1),
      },
    };
  })()`);
}

async function contactEditFieldCenter(client, fieldName) {
  const fieldKey = String(fieldName || "").trim();
  return client.evaluate(`(() => {
    const field = document.querySelector(\`[data-contact-edit-field="${fieldKey}"]\`);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
      return null;
    }
    const rect = field.getBoundingClientRect();
    return {
      x: rect.left + (rect.width / 2),
      y: rect.top + (rect.height / 2),
      width: rect.width,
      height: rect.height,
      viewportWidth: Number(window.innerWidth || 0),
      viewportHeight: Number(window.innerHeight || 0),
      devicePixelRatio: Number(window.devicePixelRatio || 1),
    };
  })()`);
}

async function runOperation(client, request, operation) {
  const kind = String(operation.kind || "").trim();
  if (kind === "ensure_contacts_route") {
    return ensureContactsRoute(client, request);
  }
  if (kind === "set_contacts_search_query") {
    return setContactsSearchQuery(client, operation.query || "");
  }
  if (kind === "open_contact_detail") {
    return openContactDetail(client, operation.contact_id || "");
  }
  if (kind === "enter_contact_edit_mode") {
    return enterContactEditMode(client);
  }
  if (kind === "install_contact_edit_trace") {
    return installContactEditTrace(client, operation.field || "first_name");
  }
  if (kind === "read_contact_edit_trace") {
    return readContactEditTrace(client, operation.field || "first_name");
  }
  if (kind === "read_contact_detail_state") {
    return readContactDetailState(client);
  }
  if (kind === "contact_edit_field_center") {
    return contactEditFieldCenter(client, operation.field || "first_name");
  }
  if (kind === "screenshot") {
    return { path: await client.screenshot(String(operation.path || "")) };
  }
  throw new Error(`Unsupported contact-detail-classic-edit browser operation: ${kind || "<missing>"}`);
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error("Expected path to request JSON.");
  }
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const outputPath = String(request.output_path || "").trim();
  if (!outputPath) {
    throw new Error("request.output_path is required");
  }
  await maybeUsePlaywright(request);
  const descriptor = await findTargetDescriptor(request);
  const client = new RawCdpClient(String(descriptor.webSocketDebuggerUrl || ""));
  const payload = {
    ok: false,
    descriptor: {
      id: descriptor.id,
      title: descriptor.title,
      url: descriptor.url,
    },
    results: [],
    final_state: null,
  };
  try {
    await client.open();
    for (const operation of request.operations || []) {
      const result = await runOperation(client, request, operation || {});
      payload.results.push({
        kind: operation.kind,
        result,
      });
      if (result && typeof result === "object") {
        payload.final_state = result;
      }
    }
    payload.ok = true;
  } catch (error) {
    payload.error = String(error && error.message ? error.message : error || "unknown error");
  } finally {
    await client.close().catch(() => {});
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  if (!payload.ok) {
    throw new Error(String(payload.error || "contact-detail-classic-edit browser helper failed"));
  }
}

main().catch(error => {
  const message = String(error && error.message ? error.message : error || "unknown error");
  console.error(message);
  process.exitCode = 1;
});
