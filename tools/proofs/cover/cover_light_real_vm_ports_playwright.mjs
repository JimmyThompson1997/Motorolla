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

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

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

function routeUrl(pageUrl, route, refreshKey = "") {
  const url = new URL(pageUrl);
  url.searchParams.set("route", String(route || "").trim());
  url.searchParams.set("reset_nav", "1");
  if (refreshKey) {
    url.searchParams.set("_pucky_refresh", refreshKey);
  }
  return url.toString();
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

function feedCardSelector(item) {
  const sessionId = String(item?.session_id || item?.meeting_id || "").trim();
  if (sessionId) {
    return `article[data-card-session-id="${sessionId}"]`;
  }
  const cardId = String(item?.card_id || item?.id || "").trim();
  if (cardId) {
    return `article[data-card-id="${cardId}"]`;
  }
  return "";
}

function pickConnectedFeedItem(feedItems) {
  return (Array.isArray(feedItems) ? feedItems : []).find(item => Array.isArray(item?.connected_records) && item.connected_records.length > 0) || null;
}

function feedMeetingId(item) {
  const origin = item && typeof item.origin === "object" ? item.origin : {};
  for (const candidate of [origin.meeting_id, item?.meeting_id, item?.turn_id, item?.session_id, origin.thread_id]) {
    const value = String(candidate || "").trim();
    if (/^meeting-[A-Za-z0-9._:-]{1,160}$/.test(value)) {
      return value;
    }
  }
  return "";
}

function meetingCardKind(item) {
  const origin = item && typeof item.origin === "object" ? item.origin : {};
  const card = item && typeof item.card === "object" ? item.card : {};
  const cardOrigin = card && typeof card.origin === "object" ? card.origin : {};
  return String(item?.card_kind || card.card_kind || origin.card_kind || cardOrigin.card_kind || "").trim().toLowerCase();
}

function meetingState(item) {
  const origin = item && typeof item.origin === "object" ? item.origin : {};
  const card = item && typeof item.card === "object" ? item.card : {};
  const cardOrigin = card && typeof card.origin === "object" ? card.origin : {};
  return String(item?.meeting_state || card.meeting_state || origin.meeting_state || cardOrigin.meeting_state || "").trim().toLowerCase();
}

function isLegacyMeetingNoiseCard(item) {
  if (!feedMeetingId(item)) {
    return false;
  }
  const connectedCount = Array.isArray(item?.connected_records) ? item.connected_records.length : 0;
  if (connectedCount > 0) {
    return false;
  }
  const title = normalizeText(item?.title || "").toLowerCase();
  const summary = normalizeText(item?.summary || item?.text || "").toLowerCase();
  const kind = meetingCardKind(item);
  const state = meetingState(item);
  if (kind === "meeting_failed" || kind === "meeting_processing" || state === "failed" || state === "processing") {
    return true;
  }
  return title === "meeting needs review" || summary.includes("usable meeting transcript attachment yet");
}

async function clickLightTile(page, route) {
  const tile = page.locator(`.light-app-tile[data-route="${route}"]`);
  await tile.waitFor({ state: "visible", timeout: 10000 });
  await tile.click();
}

async function waitForUniversalInboxReady(page, timeoutMs) {
  await page.locator('.light-shell[data-light-route="inbox"] .light-inbox-surface').waitFor({ state: "visible", timeout: timeoutMs });
  await page.waitForFunction(() => {
    const shell = document.querySelector('.light-shell[data-light-route="inbox"]');
    if (!shell) {
      return false;
    }
    if (shell.querySelector("article.card")) {
      return true;
    }
    const empty = shell.querySelector(".empty");
    if (!empty) {
      return false;
    }
    const text = String(empty.textContent || "").trim();
    return Boolean(text) && !/loading inbox/i.test(text);
  }, null, { timeout: timeoutMs });
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

async function readInboxTranscriptConnectedState(page) {
  return page.evaluate(() => ({
    connectedChipCount: document.querySelectorAll("#detail .bubble-connected-record-row .light-record-chip").length,
    connectedChipLabels: Array.from(document.querySelectorAll("#detail .bubble-connected-record-row .light-record-chip"))
      .map(node => String(node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
    legacyArtifactLabels: Array.from(document.querySelectorAll("#detail .bubble-attachment-chip"))
      .map(node => String(node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(label => /meeting summary|meeting transcript html|transcript \(plain text\)|meeting transcript|^transcript$/i.test(label)),
  }));
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);

  const feedPayload = await fetchJson(apiUrl(config.pageUrl, "/api/feed?limit=100&include_archived=0&compact=1"));
  const archivedFeedPayload = await fetchJson(apiUrl(config.pageUrl, "/api/feed?limit=100&include_archived=1&compact=1"));
  const meetingsPayload = await fetchJson(apiUrl(config.pageUrl, "/api/meetings?compact=1"));
  const feedItems = Array.isArray(feedPayload.items) ? feedPayload.items : Array.isArray(feedPayload.cards) ? feedPayload.cards : [];
  const archivedFeedItems = Array.isArray(archivedFeedPayload.items) ? archivedFeedPayload.items : Array.isArray(archivedFeedPayload.cards) ? archivedFeedPayload.cards : [];
  const meetingItems = Array.isArray(meetingsPayload.meetings) ? meetingsPayload.meetings : [];
  const archivedMeetingNoise = archivedFeedItems.filter(item => Boolean(item?.archived) && isLegacyMeetingNoiseCard(item));
  assert(feedItems.length > 0, "VM /api/feed returned no cards");
  assert(meetingItems.length > 0, "VM /api/meetings returned no meetings");
  assert(archivedMeetingNoise.length === 0, `Archived Inbox API should exclude legacy failed/processing/review meeting noise (found ${archivedMeetingNoise.length}: ${JSON.stringify(archivedMeetingNoise.slice(0, 5).map(item => item?.title || item?.card_id || ""))}).`);

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
    await waitForUniversalInboxReady(page, config.timeoutMs);
    const inboxCardCount = await page.locator(".light-shell[data-light-route=\"inbox\"] .card-wrap article.card").count();
    const inboxTitles = await visibleTitles(page, ".light-shell[data-light-route=\"inbox\"] article.card .title");
    const apiFeedTitles = titleSet(feedItems);
    const matchingInboxTitles = inboxTitles.filter(title => apiFeedTitles.has(title));
    assert(inboxCardCount > 0, "Light Inbox did not render canonical Home card DOM");
    assert(matchingInboxTitles.length > 0, `Light Inbox visible titles did not match VM /api/feed titles: ${JSON.stringify(inboxTitles.slice(0, 5))}`);
    screenshots.inbox = await saveScreenshot(page, config.reportDir, "02-vm-light-inbox");

    const coldInboxUrl = routeUrl(config.pageUrl, "inbox", `cold-${Date.now()}`);
    await page.goto(coldInboxUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await waitForUniversalInboxReady(page, config.timeoutMs);
    const coldInboxCardCount = await page.locator(".light-shell[data-light-route=\"inbox\"] .card-wrap article.card").count();
    const coldInboxTitles = await visibleTitles(page, ".light-shell[data-light-route=\"inbox\"] article.card .title");
    const matchingColdInboxTitles = coldInboxTitles.filter(title => apiFeedTitles.has(title));
    const coldInboxEmptyText = normalizeText(await page.locator(".light-shell[data-light-route=\"inbox\"] .empty").first().textContent().catch(() => ""));
    const inboxPageAction = page.locator(".light-shell[data-light-route=\"inbox\"] [data-card-action=\"page\"], .light-shell[data-light-route=\"inbox\"] [data-card-action=\"attachment\"]");
    const inboxPageActionCount = await inboxPageAction.count();
    assert(coldInboxCardCount > 0, "Light Inbox cold load did not render canonical Home card DOM");
    assert(matchingColdInboxTitles.length > 0, `Light Inbox cold-load titles did not match VM /api/feed titles: ${JSON.stringify(coldInboxTitles.slice(0, 5))}`);
    assert(!/No replies yet\./i.test(coldInboxEmptyText), `Light Inbox cold load regressed to the reply-only empty state: ${coldInboxEmptyText}`);
    assert(inboxPageActionCount === 0, `Light Inbox should not expose compact page/attachment actions after the graph-first cutover (found ${inboxPageActionCount}).`);
    screenshots.inboxCold = await saveScreenshot(page, config.reportDir, "03-vm-light-inbox-cold");

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
    optionalActions.inbox_page_action_count = inboxPageActionCount;
    optionalActions.inbox_page_click = "retired";

    const connectedFeedItem = pickConnectedFeedItem(feedItems);
    if (connectedFeedItem) {
      const selector = feedCardSelector(connectedFeedItem);
      const bodySelector = selector ? `${selector} .card-body` : "";
      optionalActions.connected_feed_card_selector = bodySelector;
      assert(bodySelector, "Light Inbox could not build a DOM selector for the connected API feed item.");
      assert(await page.locator(bodySelector).count(), "Light Inbox did not render the connected API feed item in the canonical card list.");
      if (bodySelector && await page.locator(bodySelector).count()) {
        await page.locator(bodySelector).first().click();
        await page.locator(".detail-panel.is-open").waitFor({ state: "visible", timeout: config.timeoutMs });
        const connectedDetail = await readInboxTranscriptConnectedState(page);
        assert(connectedDetail.connectedChipCount > 0, "Light Inbox transcript detail should surface inline connected record chips for connected feed items.");
        assert(connectedDetail.legacyArtifactLabels.length === 0, `Light Inbox transcript detail should hide legacy meeting summary/transcript artifacts once connected notes exist (saw ${JSON.stringify(connectedDetail.legacyArtifactLabels)}).`);
        screenshots.inboxConnectedDetail = await saveScreenshot(page, config.reportDir, "05-vm-light-inbox-connected-detail");
        optionalActions.inbox_connected_detail_chip_count = connectedDetail.connectedChipCount;
        optionalActions.inbox_connected_detail_labels = connectedDetail.connectedChipLabels.slice(0, 6);
        optionalActions.inbox_connected_detail_legacy_artifacts = connectedDetail.legacyArtifactLabels.slice(0, 6);
        await dismissDetail(page);
      } else {
        optionalActions.inbox_connected_detail_chip_count = 0;
        optionalActions.inbox_connected_detail_labels = [];
        optionalActions.inbox_connected_detail_legacy_artifacts = [];
      }
    }

    const archivedToggle = page.locator('.light-shell[data-light-route="inbox"] .inbox-archive-toggle');
    await archivedToggle.click();
    await waitForUniversalInboxReady(page, config.timeoutMs);
    await page.waitForFunction(() => {
      const button = document.querySelector('.light-shell[data-light-route="inbox"] .inbox-archive-toggle');
      return Boolean(button && button.getAttribute("aria-pressed") === "true");
    }, null, { timeout: config.timeoutMs });
    const archivedInboxTitles = await visibleTitles(page, '.light-shell[data-light-route="inbox"] article.card .title');
    const archivedApiTitles = titleSet(archivedFeedItems.filter(item => Boolean(item?.archived)));
    const matchingArchivedInboxTitles = archivedInboxTitles.filter(title => archivedApiTitles.has(title));
    if (archivedApiTitles.size > 0) {
      assert(matchingArchivedInboxTitles.length > 0, `Light Inbox archived view did not match archived /api/feed titles: ${JSON.stringify(archivedInboxTitles.slice(0, 6))}`);
    }
    screenshots.inboxArchived = await saveScreenshot(page, config.reportDir, "06-vm-light-inbox-archived");
    optionalActions.archived_inbox_matching_titles = matchingArchivedInboxTitles.slice(0, 10);

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
      archived_feed_api_count: archivedFeedItems.length,
      archived_meeting_noise_api_count: archivedMeetingNoise.length,
      meetings_api_count: meetingItems.length,
      connected_feed_api_count: Array.isArray(feedItems) ? feedItems.filter(item => Array.isArray(item?.connected_records) && item.connected_records.length > 0).length : 0,
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
