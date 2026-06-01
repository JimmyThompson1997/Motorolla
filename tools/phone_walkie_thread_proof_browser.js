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
    const node = document.querySelector(innerSelector);
    return Boolean(node && node.textContent && node.textContent.includes(innerExpected));
  }, { selector, expected }, { timeout: timeoutMs });
  await page.waitForTimeout(120);
}

async function selectorText(page, selector, timeoutMs) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const value = await locator.textContent();
  return (value || "").trim();
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
    const text = String(op.text || "").trim();
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
    await page.screenshot({ path: screenshotPath, timeout: timeoutMs });
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
  let browser;
  try {
    browser = await chromium.connectOverCDP(String(request.cdp_url || ""));
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
  } finally {
    if (browser) {
      await Promise.race([
        browser.close().catch(() => {}),
        delay(1000)
      ]);
    }
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
