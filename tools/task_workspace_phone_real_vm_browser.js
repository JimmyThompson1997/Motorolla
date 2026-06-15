#!/usr/bin/env node
"use strict";

import fs from "node:fs";
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
  throw new Error(`Could not find task WebView page matching title=${titleNeedle} url=${urlNeedle}`);
}

async function waitForShell(page, timeoutMs) {
  await page.waitForSelector(".light-shell", { timeout: timeoutMs });
  await page.waitForTimeout(150);
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

async function clickSelector(page, selector, timeoutMs) {
  await clickLocator(page, page.locator(selector).first(), timeoutMs);
}

async function waitForSelector(page, selector, timeoutMs) {
  await page.waitForSelector(selector, { timeout: timeoutMs });
  await page.waitForTimeout(120);
}

async function waitForText(page, selector, expected, timeoutMs) {
  await page.waitForFunction(({ selector: innerSelector, expected: innerExpected }) => {
    const node = document.querySelector(innerSelector);
    return Boolean(node && String(node.textContent || "").includes(innerExpected));
  }, { selector, expected }, { timeout: timeoutMs });
  await page.waitForTimeout(120);
}

async function currentRoute(page) {
  return page.evaluate(() => document.querySelector(".light-shell")?.getAttribute("data-light-route") || "");
}

async function currentTheme(page) {
  return page.evaluate(() =>
    document.querySelector(".app-shell")?.getAttribute("data-theme")
    || new URL(window.location.href).searchParams.get("theme")
    || ""
  );
}

async function waitForRoute(page, route, timeoutMs) {
  await page.waitForFunction(
    expectedRoute => document.querySelector(".light-shell")?.getAttribute("data-light-route") === expectedRoute,
    route,
    { timeout: timeoutMs }
  );
  await page.waitForTimeout(120);
}

async function waitForTaskDetail(page, taskId, timeoutMs) {
  await page.waitForFunction(
    expectedTaskId => {
      const detail = Array.from(document.querySelectorAll(".light-task-detail-surface")).find(node => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }) || document.querySelector(".light-task-detail-surface");
      return detail?.getAttribute("data-task-detail-id") === expectedTaskId;
    },
    taskId,
    { timeout: timeoutMs }
  );
  await page.waitForTimeout(120);
}

async function waitForTaskStatus(page, status, timeoutMs) {
  await page.waitForFunction(
    expectedStatus => {
      const detail = Array.from(document.querySelectorAll(".light-task-detail-surface")).find(node => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }) || document.querySelector(".light-task-detail-surface");
      return detail?.getAttribute("data-task-status") === expectedStatus;
    },
    status,
    { timeout: timeoutMs }
  );
  await page.waitForTimeout(120);
}

async function back(page, timeoutMs) {
  const debugResult = await page.evaluate(() => {
    if (window.PuckyUiDebug && typeof window.PuckyUiDebug.dispatch === "function") {
      return window.PuckyUiDebug.dispatch("back", {});
    }
    return null;
  }).catch(() => null);
  if (debugResult && debugResult.ok) {
    await page.waitForTimeout(200);
    return;
  }
  const button = page.locator("button.light-back-button").first();
  if (await button.count()) {
    await clickLocator(page, button, timeoutMs);
    return;
  }
  await page.goBack({ waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(200);
}

async function gotoTasks(page, timeoutMs, theme = "") {
  const debugResult = await page.evaluate(() => {
    if (window.PuckyUiDebug && typeof window.PuckyUiDebug.dispatch === "function") {
      return window.PuckyUiDebug.dispatch("goto_route", { route: "tasks" });
    }
    return null;
  }).catch(() => null);
  if (debugResult && debugResult.ok) {
    await waitForRoute(page, "tasks", timeoutMs);
    return;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const route = await currentRoute(page);
    const activeTheme = await currentTheme(page);
    if (route === "tasks" && (!theme || activeTheme === theme)) {
      return;
    }
    if (route === "task-detail") {
      await back(page, timeoutMs);
      continue;
    }
    const nav = page.locator('[data-route="tasks"], button[data-route="tasks"], a[data-route="tasks"]').first();
    if (await nav.count()) {
      await clickLocator(page, nav, timeoutMs);
      if ((await currentRoute(page)) === "tasks" && (!theme || (await currentTheme(page)) === theme)) {
        return;
      }
    }
    await page.evaluate((requestedTheme) => {
      const url = new URL(window.location.href);
      url.searchParams.set("route", "tasks");
      if (requestedTheme) {
        url.searchParams.set("theme", requestedTheme);
      }
      window.location.assign(url.toString());
    }, theme);
    await waitForShell(page, timeoutMs);
  }
  await waitForRoute(page, "tasks", timeoutMs);
}

async function reloadPage(page, timeoutMs) {
  await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForShell(page, timeoutMs);
}

async function readTaskState(page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".light-shell");
    const appShell = document.querySelector(".app-shell");
    const detail = Array.from(document.querySelectorAll(".light-task-detail-surface")).find(node => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }) || document.querySelector(".light-task-detail-surface");
    const sectionTitles = Array.from(detail?.querySelectorAll(".light-section-title") || [])
      .map(node => String(node.textContent || "").trim().toLowerCase());
    const sections = Array.from(document.querySelectorAll(".light-task-section-toggle")).map(toggle => {
      const group = String(toggle.dataset.taskSection || "");
      const label = String(toggle.querySelector(".light-task-section-title")?.textContent || "").trim();
      const count = String(toggle.querySelector(".light-task-section-count")?.textContent || "").trim();
      let rowIds = [];
      const card = toggle.nextElementSibling;
      if (card && card.matches(".light-task-group")) {
        rowIds = Array.from(card.querySelectorAll(".light-task-row")).map(row => String(row.dataset.taskId || ""));
      }
      return {
        group,
        label,
        count,
        expanded: String(toggle.getAttribute("aria-expanded") || "") === "true",
        rowIds,
      };
    });
    const filterButton = document.querySelector(".light-task-filter-button");
    const filters = filterButton ? [{
      key: String(filterButton.dataset.taskFilterCurrent || filterButton.dataset.taskFilter || ""),
      label: String(filterButton.querySelector(".light-task-filter-button-label")?.textContent || filterButton.textContent || "").trim(),
      active: true,
    }] : [];
    const filterVisual = filterButton ? (() => {
      const style = getComputedStyle(filterButton);
      const chevron = filterButton.querySelector(".light-task-filter-button-chevron");
      const chevronStyle = chevron ? getComputedStyle(chevron) : null;
      const svg = chevron?.querySelector("svg");
      const path = svg?.querySelector("path");
      return {
        theme: String(appShell?.getAttribute("data-theme") || ""),
        buttonColor: String(style.color || ""),
        buttonBackground: String(style.backgroundColor || ""),
        chevronColor: String(chevronStyle?.color || ""),
        chevronPath: String(path?.getAttribute("d") || ""),
        chevronHasRect: Boolean(svg?.querySelector("rect")),
      };
    })() : null;
    const checklist = detail
      ? Array.from(detail.querySelectorAll(".light-task-checklist-row")).map(row => ({
          id: String(row.getAttribute("data-checklist-item-id") || ""),
          label: String(row.textContent || "").replace(/\s+/g, " ").trim(),
          done: row.classList.contains("is-done"),
        }))
      : [];
    const attached = detail
      ? Array.from(detail.querySelectorAll(".light-task-chip-cloud [data-workspace-target-kind]")).map(node => ({
          kind: String(node.getAttribute("data-workspace-target-kind") || ""),
          id: String(node.getAttribute("data-workspace-target-id") || ""),
          route: String(node.getAttribute("data-workspace-target-route") || ""),
          label: String(node.textContent || "").replace(/\s+/g, " ").trim(),
          hasIcon: Boolean(node.querySelector(".light-record-chip-icon")),
        }))
      : [];
    const people = detail
      ? Array.from(detail.querySelectorAll(".light-task-person-row")).map(row => {
          const chip = row.querySelector('[data-workspace-target-kind="contact"]');
          return {
            role: String(row.getAttribute("data-task-person-role") || ""),
            label: String(row.querySelector(".light-task-person-label")?.textContent || "").trim(),
            kind: String(chip?.getAttribute("data-workspace-target-kind") || ""),
            id: String(chip?.getAttribute("data-workspace-target-id") || ""),
            route: String(chip?.getAttribute("data-workspace-target-route") || ""),
            text: String(chip?.textContent || "").replace(/\s+/g, " ").trim(),
          };
        })
      : [];
    return {
      route: shell?.getAttribute("data-light-route") || "",
      taskDetailId: detail?.getAttribute("data-task-detail-id") || "",
      taskStatus: detail?.getAttribute("data-task-status") || "",
      title: String(detail?.querySelector(".light-task-detail-title")?.textContent || "").trim(),
      hasTaskHtmlFrame: Boolean(detail?.querySelector(".light-html-frame")),
      hasDescriptionSection: sectionTitles.includes("description"),
      hasPeopleSection: sectionTitles.includes("people"),
      hasChecklistSection: sectionTitles.includes("checklist"),
      hasAttachedSection: sectionTitles.includes("attached"),
      attachedChipIconCount: detail?.querySelectorAll(".light-task-chip-cloud .light-record-chip-icon").length || 0,
      hasLegacyCreatedByRow: Boolean(detail?.querySelector('.light-info-row[data-workspace-target-kind="contact"]')),
      statusTriggerPresent: Boolean(detail?.querySelector(".light-task-status-trigger")),
      statusCircleTriggerPresent: Boolean(detail?.querySelector(".light-task-status-circle-trigger")),
      people,
      sections,
      filters,
      filterVisual,
      checklist,
      attached,
    };
  });
}

async function runOperation(page, request, op) {
  const timeoutMs = Number(op.timeout_ms || request.timeout_ms || 15000);
  if (op.kind === "goto_tasks") {
    await gotoTasks(page, timeoutMs, String(op.theme || "").trim().toLowerCase());
    return { kind: op.kind, state: await readTaskState(page) };
  }
  if (op.kind === "back") {
    await back(page, timeoutMs);
    return { kind: op.kind, state: await readTaskState(page) };
  }
  if (op.kind === "click_selector") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("click_selector requires selector");
    }
    await clickSelector(page, selector, timeoutMs);
    return { kind: op.kind, selector, state: await readTaskState(page) };
  }
  if (op.kind === "wait_for_selector") {
    const selector = String(op.selector || "").trim();
    if (!selector) {
      throw new Error("wait_for_selector requires selector");
    }
    await waitForSelector(page, selector, timeoutMs);
    return { kind: op.kind, selector, state: await readTaskState(page) };
  }
  if (op.kind === "wait_for_text") {
    const selector = String(op.selector || "").trim();
    const text = String(op.text || "").trim();
    if (!selector || !text) {
      throw new Error("wait_for_text requires selector and text");
    }
    await waitForText(page, selector, text, timeoutMs);
    return { kind: op.kind, selector, text, state: await readTaskState(page) };
  }
  if (op.kind === "wait_for_route") {
    const route = String(op.route || "").trim();
    if (!route) {
      throw new Error("wait_for_route requires route");
    }
    await waitForRoute(page, route, timeoutMs);
    return { kind: op.kind, route, state: await readTaskState(page) };
  }
  if (op.kind === "wait_for_task_detail") {
    const taskId = String(op.task_id || "").trim();
    if (!taskId) {
      throw new Error("wait_for_task_detail requires task_id");
    }
    await waitForTaskDetail(page, taskId, timeoutMs);
    return { kind: op.kind, task_id: taskId, state: await readTaskState(page) };
  }
  if (op.kind === "wait_for_task_status") {
    const status = String(op.status || "").trim();
    if (!status) {
      throw new Error("wait_for_task_status requires status");
    }
    await waitForTaskStatus(page, status, timeoutMs);
    return { kind: op.kind, status, state: await readTaskState(page) };
  }
  if (op.kind === "reload_page") {
    await reloadPage(page, timeoutMs);
    return { kind: op.kind, state: await readTaskState(page) };
  }
  if (op.kind === "task_state") {
    return { kind: op.kind, state: await readTaskState(page) };
  }
  if (op.kind === "screenshot") {
    const screenshotPath = String(op.path || "").trim();
    if (!screenshotPath) {
      throw new Error("screenshot requires path");
    }
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, timeout: Math.min(timeoutMs, 10000) });
    return { kind: op.kind, path: screenshotPath, state: await readTaskState(page) };
  }
  throw new Error(`Unsupported task proof browser operation: ${op.kind}`);
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    throw new Error("Usage: task_workspace_phone_real_vm_browser.js <request.json>");
  }
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  let browser;
  try {
    browser = await chromium.connectOverCDP(String(request.cdp_url || ""));
    const page = await findCoverPage(browser, request);
    await waitForShell(page, Number(request.timeout_ms || 15000));
    const operations = Array.isArray(request.operations) && request.operations.length
      ? request.operations
      : [{ kind: "task_state" }];
    const results = [];
    for (const op of operations) {
      results.push(await runOperation(page, request, op));
    }
    const output = {
      ok: true,
      page_title: await safeTitle(page),
      page_url: page.url(),
      final_surface: await readTaskState(page),
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
    if (browser) {
      await Promise.race([
        browser.close().catch(() => {}),
        delay(1000),
      ]);
    }
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
      if (request.output_path) {
        fs.mkdirSync(path.dirname(request.output_path), { recursive: true });
        fs.writeFileSync(request.output_path, JSON.stringify(payload, null, 2));
        process.exit(1);
      }
    }
  } catch (_error) {
    // Fall back to stderr below.
  }
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
