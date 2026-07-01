#!/usr/bin/env node
"use strict";

import fs from "node:fs";
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

async function findTargetPage(browser, request) {
  const titleNeedle = String(request.page_title || "").trim();
  const urlNeedle = String(request.page_url_contains || "").trim();
  const timeoutMs = Number(request.timeout_ms || 20000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      const pages = context.pages();
      for (let index = pages.length - 1; index >= 0; index -= 1) {
        const page = pages[index];
        const title = await safeTitle(page);
        const url = page.url();
        if ((!titleNeedle || title.includes(titleNeedle)) && hasUrlNeedle(url, urlNeedle)) {
          return page;
        }
      }
    }
    await delay(250);
  }
  throw new Error(`Could not find cover page matching title=${titleNeedle || "<any>"} url_contains=${urlNeedle || "<any>"}`);
}

async function maybeClickLabels(page, labels, timeoutMs) {
  const values = Array.isArray(labels) ? labels : [];
  for (const label of values) {
    const button = page.getByRole("button", { name: label }).first();
    if (await button.isVisible({ timeout: Math.min(timeoutMs, 1200) }).catch(() => false)) {
      await button.click();
      return { matched: label, role: "button" };
    }
    const link = page.getByRole("link", { name: label }).first();
    if (await link.isVisible({ timeout: Math.min(timeoutMs, 1200) }).catch(() => false)) {
      await link.click();
      return { matched: label, role: "link" };
    }
  }
  return { matched: "", role: "" };
}

async function captureState(page) {
  return page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    route: String(document.querySelector(".app-shell")?.getAttribute("data-view") || document.querySelector(".light-shell")?.getAttribute("data-light-route") || "").trim(),
    body: String(document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1600),
  }));
}

async function waitForWorkspace(page, loginUrl, workspaceHostPattern, timeoutMs) {
  await page.waitForFunction(
    ({ loginOrigin, hostPattern }) => {
      const currentUrl = window.location.href;
      const currentOrigin = (() => {
        try {
          return new URL(currentUrl).origin;
        } catch (_error) {
          return "";
        }
      })();
      const currentHost = (() => {
        try {
          return new URL(currentUrl).host;
        } catch (_error) {
          return "";
        }
      })();
      const readySelector = document.querySelector('.light-shell, .app-shell, [data-light-route]');
      const pathname = (() => {
        try {
          return new URL(currentUrl).pathname;
        } catch (_error) {
          return "";
        }
      })();
      if (hostPattern) {
        try {
          if (new RegExp(hostPattern).test(currentHost) && readySelector) {
            return true;
          }
        } catch (_error) {
          // Fall through to selector readiness.
        }
      }
      return Boolean(readySelector) && (!loginOrigin || currentOrigin !== loginOrigin || pathname !== "/sign-in");
    },
    {
      loginOrigin: (() => {
        try {
          return new URL(String(loginUrl || "")).origin;
        } catch (_error) {
          return "";
        }
      })(),
      hostPattern: String(workspaceHostPattern || ""),
    },
    { timeout: timeoutMs }
  );
}

async function waitForRoute(page, route, timeoutMs) {
  const target = String(route || "home").trim();
  await page.waitForFunction(
    expected => {
      const appShell = document.querySelector(".app-shell");
      const dataView = String(appShell?.getAttribute("data-view") || "").trim();
      const lightShell = document.querySelector(`.light-shell[data-light-route="${expected}"]`);
      if (lightShell) {
        return true;
      }
      if (expected === "home") {
        return dataView === "home" || Boolean(document.querySelector('.light-shell[data-light-route="home"]'));
      }
      return dataView === expected;
    },
    target,
    { timeout: timeoutMs }
  );
}

async function executeOperation(page, op, timeoutMs) {
  if (op.kind === "goto_url") {
    await page.goto(String(op.url || ""), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    return { kind: op.kind, state: await captureState(page) };
  }
  if (op.kind === "wait_ms") {
    await page.waitForTimeout(Math.max(0, Number(op.ms || 0) || 0));
    return { kind: op.kind, state: await captureState(page) };
  }
  if (op.kind === "wait_for_email") {
    await page.waitForSelector('input[type="email"], input[name*="email" i], input[autocomplete="email"]', { timeout: timeoutMs });
    return { kind: op.kind, state: await captureState(page) };
  }
  if (op.kind === "fill_email") {
    const locator = page.locator('input[type="email"], input[name*="email" i], input[autocomplete="email"]').first();
    await locator.fill(String(op.value || ""));
    return { kind: op.kind, state: await captureState(page) };
  }
  if (op.kind === "click_labels") {
    const clicked = await maybeClickLabels(page, op.labels || [], timeoutMs);
    return { kind: op.kind, clicked, state: await captureState(page) };
  }
  if (op.kind === "wait_for_otp") {
    await page.waitForSelector(
      'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i], input[id*="code" i]',
      { timeout: timeoutMs }
    );
    return { kind: op.kind, state: await captureState(page) };
  }
  if (op.kind === "fill_otp") {
    const code = String(op.value || "").trim();
    const allInputs = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i], input[id*="code" i]');
    const count = await allInputs.count().catch(() => 0);
    if (count >= code.length && count > 1) {
      for (let index = 0; index < code.length; index += 1) {
        await allInputs.nth(index).fill(code[index]);
      }
    } else {
      await allInputs.first().fill(code);
    }
    return { kind: op.kind, state: await captureState(page) };
  }
  if (op.kind === "wait_for_workspace") {
    await waitForWorkspace(page, op.login_url, op.workspace_host_pattern, timeoutMs);
    return { kind: op.kind, state: await captureState(page) };
  }
  if (op.kind === "navigate_route") {
    await page.evaluate(route => {
      const url = new URL(window.location.href);
      url.searchParams.set("route", String(route || "home"));
      url.searchParams.set("reset_nav", "1");
      window.location.assign(url.toString());
    }, String(op.route || "home"));
    return { kind: op.kind, state: await captureState(page) };
  }
  if (op.kind === "wait_for_route") {
    await waitForRoute(page, op.route, timeoutMs);
    return { kind: op.kind, state: await captureState(page) };
  }
  if (op.kind === "logout") {
    const clicked = await maybeClickLabels(page, op.labels || [], timeoutMs);
    await page.waitForSelector('input[type="email"], input[name*="email" i], input[autocomplete="email"]', { timeout: timeoutMs });
    return { kind: op.kind, clicked, state: await captureState(page) };
  }
  if (op.kind === "read_state") {
    return { kind: op.kind, state: await captureState(page) };
  }
  if (op.kind === "screenshot") {
    const targetPath = String(op.path || "").trim();
    if (!targetPath) {
      throw new Error("screenshot operation requires path");
    }
    await page.screenshot({ path: targetPath, fullPage: true });
    return { kind: op.kind, path: targetPath, state: await captureState(page) };
  }
  throw new Error(`Unsupported auth phone browser operation: ${op.kind}`);
}

async function main() {
  const requestPath = process.argv[2];
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const outputPath = String(request.output_path || "").trim();
  const browser = await chromium.connectOverCDP(String(request.cdp_url || ""));
  try {
    const page = await findTargetPage(browser, request);
    const operations = Array.isArray(request.operations) && request.operations.length
      ? request.operations
      : [{ kind: "read_state" }];
    const timeoutMs = Number(request.timeout_ms || 30000);
    const results = [];
    for (const op of operations) {
      results.push(await executeOperation(page, op, timeoutMs));
    }
    const payload = {
      ok: true,
      operations: results,
      final_surface: await captureState(page),
    };
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  } catch (error) {
    const payload = {
      ok: false,
      error: String(error && error.stack ? error.stack : error),
    };
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    throw error;
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
