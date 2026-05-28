#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

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

async function waitForAppShell(page, timeoutMs) {
  await page.waitForSelector(".app-shell", { timeout: timeoutMs });
  await page.waitForTimeout(150);
}

async function describePage(page) {
  return page.evaluate(() => {
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

async function clickSelector(page, selector, timeoutMs) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  await locator.click();
  await page.waitForTimeout(200);
}

async function closeDetailIfOpen(page, timeoutMs) {
  const detail = page.locator("#detail.is-open .detail-back").first();
  if (await detail.count()) {
    await detail.click();
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(120);
}

async function gotoHome(page, timeoutMs) {
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

async function runOperation(page, request, op) {
  const timeoutMs = Number(op.timeout_ms || request.timeout_ms || 15000);
  if (op.kind === "goto_home") {
    return { kind: op.kind, detail: await gotoHome(page, timeoutMs) };
  }
  if (op.kind === "back") {
    await closeDetailIfOpen(page, timeoutMs);
    return { kind: op.kind, detail: await describePage(page) };
  }
  if (op.kind === "open_card_action") {
    const selector = cardActionSelector(op);
    await clickSelector(page, selector, timeoutMs);
    if (op.expected_detail_type) {
      await page.waitForSelector(`#detail.is-open[data-detail-type="${escapeAttribute(op.expected_detail_type)}"]`, {
        timeout: timeoutMs
      });
    }
    return { kind: op.kind, selector, detail: await describePage(page) };
  }
  if (op.kind === "wait_for_detail") {
    const selector = `#detail.is-open[data-detail-type="${escapeAttribute(op.detail_type || "")}"]`;
    await page.waitForSelector(selector, { timeout: timeoutMs });
    return { kind: op.kind, selector, detail: await describePage(page) };
  }
  if (op.kind === "screenshot") {
    const screenshotPath = String(op.path || "").trim();
    if (!screenshotPath) {
      throw new Error("screenshot operation requires path");
    }
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return { kind: op.kind, path: screenshotPath };
  }
  if (op.kind === "describe") {
    return { kind: op.kind, detail: await describePage(page) };
  }
  throw new Error(`Unsupported browser operation: ${op.kind}`);
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error("Usage: phone_walkie_thread_proof_browser.js <request.json>");
  }
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const browser = await chromium.connectOverCDP(String(request.cdp_url || ""));
  const page = await findCoverPage(browser, request);
  await waitForAppShell(page, Number(request.timeout_ms || 15000));
  const operations = Array.isArray(request.operations) && request.operations.length
    ? request.operations
    : [{ kind: "describe" }];
  const results = [];
  for (const op of operations) {
    results.push(await runOperation(page, request, op));
  }
  const output = {
    ok: true,
    page_title: await safeTitle(page),
    page_url: page.url(),
    final_surface: await describePage(page),
    operations: results
  };
  const outputPath = String(request.output_path || "").trim();
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    return;
  }
  process.stdout.write(JSON.stringify(output, null, 2));
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
