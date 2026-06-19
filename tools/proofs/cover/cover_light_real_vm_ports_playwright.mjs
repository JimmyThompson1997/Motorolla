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

const DEFAULT_PAGE_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=light&reset_nav=1";
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    pageUrl: process.env.PUCKY_LIGHT_VM_PORTS_URL || DEFAULT_PAGE_URL,
    reportDir: path.resolve("artifacts", "light-real-vm-ports"),
    timeoutMs: 20000
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--page-url" && argv[index + 1]) {
      config.pageUrl = String(argv[++index] || config.pageUrl);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = String(argv[++index] || config.reportDir);
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    }
  }
  return config;
}

function apiUrl(pageUrl, pathName) {
  return new URL(pathName, new URL(pageUrl).origin).toString();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}: ${String(payload?.detail || payload?.error || "")}`);
  }
  return payload;
}

function titleSet(items) {
  return new Set(
    items
      .map(item => String(item?.title || item?.recording_title || item?.meeting_id || "").trim())
      .filter(Boolean)
  );
}

async function visibleTitles(page, selector) {
  return page.locator(selector).evaluateAll(nodes =>
    nodes.map(node => String(node.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean)
  );
}

async function clickLightTile(page, route) {
  const tile = page.locator(`.light-app-tile[data-route="${route}"]`);
  await tile.waitFor({ state: "visible", timeout: 10000 });
  await tile.click();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function dismissDetail(page) {
  if (await page.locator(".detail-panel.is-open").count()) {
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(250);
  }
}

async function backToHome(page) {
  for (let index = 0; index < 8; index += 1) {
    if (await page.locator(".light-shell[data-light-route=\"home\"]").count()) {
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(200);
  }
  await page.locator(".light-shell[data-light-route=\"home\"]").waitFor({ state: "visible", timeout: 5000 });
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);

  const feedPayload = await fetchJson(apiUrl(config.pageUrl, "/api/feed?limit=100&include_archived=0&compact=1"));
  const meetingsPayload = await fetchJson(apiUrl(config.pageUrl, "/api/meetings?compact=1"));
  const feedItems = Array.isArray(feedPayload.items) ? feedPayload.items : Array.isArray(feedPayload.cards) ? feedPayload.cards : [];
  const meetingItems = Array.isArray(meetingsPayload.meetings) ? meetingsPayload.meetings : [];
  assert(feedItems.length > 0, "VM /api/feed returned no cards");
  assert(meetingItems.length > 0, "VM /api/meetings returned no meetings");

  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT, hasTouch: true, isMobile: true });
  const requestLog = [];
  context.on("request", request => {
    requestLog.push({ method: request.method(), url: request.url(), resource_type: request.resourceType() });
  });
  const page = await context.newPage();
  attachPageLogging(page, path.join(config.reportDir, "console.log"));

  const screenshots = {};
  const optionalActions = {};
  try {
    await page.goto(config.pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await page.locator(".light-shell[data-light-route=\"home\"] .light-app-grid").waitFor({ state: "visible", timeout: config.timeoutMs });
    screenshots.home = await saveScreenshot(page, config.reportDir, "01-vm-light-home");

    await clickLightTile(page, "inbox");
    await page.locator(".light-shell[data-light-route=\"inbox\"] .light-real-feed-list").waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.waitForFunction(() => document.querySelectorAll(".light-shell[data-light-route='inbox'] .card-wrap article.card").length > 0, null, { timeout: config.timeoutMs });
    const inboxCardCount = await page.locator(".light-shell[data-light-route=\"inbox\"] .card-wrap article.card").count();
    const inboxTitles = await visibleTitles(page, ".light-shell[data-light-route=\"inbox\"] article.card h2.title");
    const apiFeedTitles = titleSet(feedItems);
    const matchingInboxTitles = inboxTitles.filter(title => apiFeedTitles.has(title));
    assert(inboxCardCount > 0, "Light Inbox did not render canonical Home card DOM");
    assert(matchingInboxTitles.length > 0, `Light Inbox visible titles did not match VM /api/feed titles: ${JSON.stringify(inboxTitles.slice(0, 5))}`);
    screenshots.inbox = await saveScreenshot(page, config.reportDir, "02-vm-light-inbox");

    const detailTarget = page.locator(".light-shell[data-light-route=\"inbox\"] .card-wrap article.card:not(.card-meeting-processing) .card-body");
    await detailTarget.first().click();
    await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: config.timeoutMs });
    screenshots.inboxDetail = await saveScreenshot(page, config.reportDir, "03-vm-light-inbox-detail");
    await dismissDetail(page);

    const inboxAudio = page.locator(".light-shell[data-light-route=\"inbox\"] [data-card-action=\"audio\"]");
    if (await inboxAudio.count()) {
      try {
        await inboxAudio.first().click({ timeout: 5000 });
        await page.waitForTimeout(500);
        screenshots.inboxAudio = await saveScreenshot(page, config.reportDir, "04-vm-light-inbox-audio");
        optionalActions.inbox_audio_click = "ok";
        await dismissDetail(page);
      } catch (error) {
        optionalActions.inbox_audio_click = String(error?.message || error || "failed").slice(0, 240);
      }
    }
    const inboxPageAction = page.locator(".light-shell[data-light-route=\"inbox\"] [data-card-action=\"page\"], .light-shell[data-light-route=\"inbox\"] [data-card-action=\"attachment\"]");
    const inboxPageActionCount = await inboxPageAction.count();
    optionalActions.inbox_page_action_count = inboxPageActionCount;
    if (inboxPageActionCount) {
      try {
        await inboxPageAction.first().click({ timeout: 5000 });
        await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: config.timeoutMs });
        screenshots.inboxPage = await saveScreenshot(page, config.reportDir, "05-vm-light-inbox-page");
        optionalActions.inbox_page_click = "ok";
        await dismissDetail(page);
      } catch (error) {
        optionalActions.inbox_page_click = String(error?.message || error || "failed").slice(0, 240);
      }
    }
    assert(inboxPageActionCount > 0, "Light Inbox did not expose canonical page/attachment actions");

    await backToHome(page);
    await clickLightTile(page, "meetings");
    await page.locator(".light-shell[data-light-route=\"meetings\"] .meetings-page").waitFor({ state: "visible", timeout: config.timeoutMs });
    await page.waitForFunction(() => document.querySelectorAll(".light-shell[data-light-route='meetings'] .card-meeting-list").length > 0, null, { timeout: config.timeoutMs });
    const meetingCardCount = await page.locator(".light-shell[data-light-route=\"meetings\"] .card-meeting-list").count();
    const meetingTitles = await visibleTitles(page, ".light-shell[data-light-route=\"meetings\"] .card-meeting-list h2.title");
    const apiMeetingTitles = titleSet(meetingItems);
    const matchingMeetingTitles = meetingTitles.filter(title => apiMeetingTitles.has(title));
    assert(meetingCardCount > 0, "Light Meetings did not render canonical meeting card DOM");
    assert(matchingMeetingTitles.length > 0, `Light Meetings visible titles did not match VM /api/meetings titles: ${JSON.stringify(meetingTitles.slice(0, 5))}`);
    screenshots.meetings = await saveScreenshot(page, config.reportDir, "06-vm-light-meetings");

    await page.locator(".light-shell[data-light-route=\"meetings\"] .card-meeting-list .card-body").first().click();
    await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: config.timeoutMs });
    screenshots.meetingsDetail = await saveScreenshot(page, config.reportDir, "07-vm-light-meetings-detail");
    await dismissDetail(page);

    const meetingAudio = page.locator(".light-shell[data-light-route=\"meetings\"] .card-meeting-list [data-card-action=\"audio\"]");
    const meetingAudioCount = await meetingAudio.count();
    optionalActions.meeting_audio_action_count = meetingAudioCount;
    if (meetingAudioCount) {
      try {
        await meetingAudio.first().click({ timeout: 5000 });
        await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: config.timeoutMs });
        screenshots.meetingsAudio = await saveScreenshot(page, config.reportDir, "08-vm-light-meetings-audio");
        optionalActions.meetings_audio_click = "ok";
        await dismissDetail(page);
      } catch (error) {
        optionalActions.meetings_audio_click = String(error?.message || error || "failed").slice(0, 240);
      }
    }
    assert(meetingAudioCount > 0, "Light Meetings did not expose canonical meeting audio actions");

    const fixtureRequests = requestLog.filter(item => item.url.includes("/fixtures/reply_cards"));
    assert(fixtureRequests.length === 0, "VM proof observed bundled reply card fixture requests");
    assert(requestLog.some(item => item.url.includes("/api/feed")), "VM proof did not observe /api/feed request");
    assert(requestLog.some(item => item.url.includes("/api/meetings")), "VM proof did not observe /api/meetings request");

    const summary = {
      schema: "pucky.light_real_vm_ports_proof.v1",
      ok: true,
      page_url: config.pageUrl,
      feed_api_count: feedItems.length,
      meetings_api_count: meetingItems.length,
      inbox_card_count: inboxCardCount,
      meeting_card_count: meetingCardCount,
      matching_inbox_titles: matchingInboxTitles.slice(0, 10),
      matching_meeting_titles: matchingMeetingTitles.slice(0, 10),
      fixture_request_count: fixtureRequests.length,
      optional_actions: optionalActions,
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
