import path from "node:path";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const DEFAULT_PAGE_URL = "http://127.0.0.1:8766/index.html?theme=light&reset_nav=1";
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    pageUrl: DEFAULT_PAGE_URL,
    reportDir: path.resolve("artifacts", "light-static-no-mock-probe"),
    timeoutMs: 10000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--page-url" && argv[index + 1]) {
      config.pageUrl = String(argv[++index] || config.pageUrl);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = String(argv[++index] || config.reportDir);
    }
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function clickTile(page, route) {
  await page.locator(`.light-app-tile[data-route="${route}"]`).click();
}

async function readState(page) {
  return page.evaluate(() => {
    const qs = selector => Array.from(document.querySelectorAll(selector));
    const text = node => String(node?.textContent || "").replace(/\s+/g, " ").trim();
    return {
      route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
      feed_text: text(document.getElementById("feed")),
      card_count: qs(".card-wrap article.card").length,
      feed_error_count: qs(".feed-load-error").length,
      meetings_error_text: text(document.querySelector(".meetings-empty")),
      fixture_request_possible: false
    };
  });
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT, hasTouch: true, isMobile: true });
  const requestLog = [];
  context.on("request", request => requestLog.push({ method: request.method(), url: request.url() }));
  const page = await context.newPage();
  attachPageLogging(page, path.join(config.reportDir, "console.log"));

  const screenshots = {};
  try {
    await page.goto(config.pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await page.locator(".light-shell[data-light-route=\"home\"] .light-app-grid").waitFor({ state: "visible", timeout: config.timeoutMs });
    screenshots.home = await saveScreenshot(page, config.reportDir, "01-static-light-home");

    await clickTile(page, "inbox");
    await page.locator(".light-shell[data-light-route=\"inbox\"]").waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.waitForFunction(() => {
      return document.querySelector(".feed-load-error")
        || document.querySelectorAll(".light-shell[data-light-route='inbox'] .card-wrap article.card").length > 0;
    }, null, { timeout: config.timeoutMs });
    const inbox = await readState(page);
    screenshots.inbox = await saveScreenshot(page, config.reportDir, "02-static-light-inbox");
    assert(inbox.feed_error_count > 0 || inbox.card_count > 0, "Static Inbox showed neither canonical API error nor real cards");
    assert(!/Real Home tiles will appear here/i.test(inbox.feed_text), "Static Inbox still showed fake light empty copy");

    await page.goto(config.pageUrl.replace("reset_nav=1", "route=meetings&reset_nav=1"), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await page.locator(".light-shell[data-light-route=\"meetings\"] .meetings-page").waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.waitForFunction(() => {
      const empty = document.querySelector(".light-shell[data-light-route='meetings'] .meetings-empty");
      const emptyText = String(empty?.textContent || "").trim();
      return (empty && emptyText && !/loading meetings/i.test(emptyText))
        || document.querySelectorAll(".light-shell[data-light-route='meetings'] .card-meeting-list").length > 0;
    }, null, { timeout: config.timeoutMs });
    const meetings = await readState(page);
    screenshots.meetings = await saveScreenshot(page, config.reportDir, "03-static-light-meetings");
    assert(!/Links request failed/i.test(meetings.meetings_error_text), "Static Meetings leaked Links request wording");

    const fixtureRequests = requestLog.filter(item => item.url.includes("/fixtures/reply_cards"));
    const summary = {
      schema: "pucky.light_static_no_mock_probe.v1",
      ok: true,
      page_url: config.pageUrl,
      inbox,
      meetings,
      fixture_request_count: fixtureRequests.length,
      screenshots
    };
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
