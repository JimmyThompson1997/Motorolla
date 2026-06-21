import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  attachPageLogging,
  ensureDir,
  idleTurnStatus,
  installCodexPuckyBridge,
  readRuntimeFixtures,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const DEFAULT_PAGE_URL = "http://127.0.0.1:8766/index.html?theme=light&reset_nav=1";
const VIEWPORT = { width: 430, height: 932 };
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const bundledNodeModules = String(process.env.CODEX_NODE_MODULES || "").trim();
  const candidates = [
    () => require("playwright-core"),
    () => require("playwright"),
    () => bundledNodeModules ? require(path.join(bundledNodeModules, "playwright-core")) : null,
    () => bundledNodeModules ? require(path.join(bundledNodeModules, "playwright")) : null,
  ];
  for (const candidate of candidates) {
    try {
      const resolved = candidate();
      if (resolved?.chromium) {
        return resolved;
      }
    } catch {
      // Try the next resolution path.
    }
  }
  throw new Error("Could not resolve playwright-core or playwright from local tools or bundled runtime");
}

const { chromium } = loadPlaywright();

function parseArgs(argv) {
  const config = {
    pageUrl: DEFAULT_PAGE_URL,
    reportDir: path.join(repoRoot, "artifacts", "light-walkthrough-port")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--page-url") {
      config.pageUrl = String(argv[++index] || config.pageUrl);
    } else if (arg === "--report-dir") {
      config.reportDir = String(argv[++index] || config.reportDir);
    }
  }
  return config;
}

function bridgeState() {
  return {
    browserOpenCommands: [],
    replyCards: readRuntimeFixtures(repoRoot),
    meetings: proofMeetings()
  };
}

function proofMeetings() {
  return [
    {
      meeting_id: "meeting-light-proof",
      state: "completed",
      title: "Light proof meeting title that should wrap cleanly without colliding with the audio rail",
      recording_title: "light-proof-meeting-2026-06-08",
      started_at: "2026-06-08T18:23:00Z",
      stopped_at: "2026-06-08T18:38:00Z",
      duration_ms: 900000,
      transcript_status: "completed",
      transcript_text: "Jimmy: Let's verify the light meetings port. Pucky: The canonical meeting card opened from the light shell.",
      audio_path: "/sdcard/Pucky/light-proof-meeting.wav",
      archived: false
    },
    {
      meeting_id: "meeting-light-proof-processing",
      state: "processing",
      title: "Light proof processing meeting with another intentionally long row title",
      recording_title: "light-proof-processing",
      started_at: "2026-06-08T17:15:00Z",
      duration_ms: 180000,
      transcript_status: "processing",
      archived: false
    }
  ];
}

function bridgeResponse(state, message) {
  const command = String(message?.command || "");
  if (command === "ui.reply_cards.get" || command === "pucky.feed.sync") {
    return state.replyCards;
  }
  if (command === "pucky.turn.status") {
    return idleTurnStatus();
  }
  if (command === "wake.status") {
    return {
      schema: "pucky.wake_word_status.v4",
      enabled: false,
      requested_enabled: false,
      running: false,
      state: "idle",
      proof_indicator: { active: false, visual_state: "idle", matched_phrase: "", transcript: "", remaining_ms: 0 }
    };
  }
  if (command === "pucky.turn.settings.get") {
    return {
      schema: "pucky.turn_settings.v1",
      reply_mode: "card_only",
      spoken_reply_enabled: false,
      arrival_cue_mode: "chime",
      accepted_chime_enabled: true,
      modes: ["card_only", "card_and_spoken"],
      arrival_cue_modes: ["none", "haptic", "chime", "haptic_and_chime"]
    };
  }
  if (command === "ui.surface.get") {
    return {
      schema: "pucky.ui_surface_status.v1",
      source_kind: "bundle_current",
      entrypoint_url: "",
      ui_version: "light-walkthrough-port-proof"
    };
  }
  if (command === "ui.default_audio_speed.get") {
    return { schema: "pucky.default_audio_speed.v1", speed: 1 };
  }
  if (command === "meeting.recording.status") {
    return { schema: "pucky.meeting_recording_status.v1", state: "idle", active_meeting_id: null, meetings: [] };
  }
  if (command === "pucky.config.get") {
    return { schema: "pucky.config.v1", api_base_url: "https://pucky.test", has_native_bridge: true };
  }
  if (command === "pucky.authorization.get") {
    return {
      schema: "pucky.authorization.v1",
      authorization: "Bearer proof-token",
      authorized: true
    };
  }
  if (command === "browser.open") {
    const args = message?.args && typeof message.args === "object" ? message.args : {};
    state.browserOpenCommands.push({ url: String(args.url || ""), at: new Date().toISOString() });
    return { ok: true };
  }
  if (command === "artifact.read_base64") {
    const html = "<!doctype html><html><body><h1>Mock HTML artifact</h1><p>Light proof artifact.</p></body></html>";
    return { content_base64: Buffer.from(html, "utf8").toString("base64"), mime_type: "text/html" };
  }
  if (command === "voice.thread_scope.clear" || command === "voice.thread_scope.set") {
    return { ok: true };
  }
  if (command === "player.state") {
    return { schema: "pucky.player_state.v1", is_playing: false, position_ms: 0, duration_ms: 0, speed: 1 };
  }
  return {};
}

async function installLinksApi(context, state) {
  await context.route("**/api/feed**", async route => {
    if (route.request().method().toUpperCase() !== "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schema: "pucky.reply_cards.v1",
        count: state.replyCards.cards.length,
        items: state.replyCards.cards,
        next_cursor: "",
        has_more: false
      })
    });
  });
  await context.route("**/api/meetings**", async route => {
    const url = new URL(route.request().url());
    const method = route.request().method().toUpperCase();
    if (url.pathname.endsWith("/actions")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    const detailMatch = url.pathname.match(/\/api\/meetings\/([^/]+)$/);
    if (detailMatch) {
      const meetingId = decodeURIComponent(detailMatch[1] || "");
      const meeting = state.meetings.find(item => item.meeting_id === meetingId) || state.meetings[0];
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, meeting })
      });
      return;
    }
    if (method !== "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schema: "pucky.meetings.v1",
        ok: true,
        compact: true,
        count: state.meetings.length,
        meetings: state.meetings
      })
    });
  });
  await context.route("**/api/links/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/portal-url")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          portal_url: "https://pucky.test/connect",
          token: "proof-token",
          auth_mode: "browser"
        })
      });
      return;
    }
    if (url.pathname.endsWith("/my-apps")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, apps: [{ slug: "github", name: "GitHub", counts: { active: 1 } }] })
      });
      return;
    }
    if (url.pathname.endsWith("/oauth/start")) {
      const slug = url.searchParams.get("app") || "unknown";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          auth_mode: "browser",
          auth_url: `https://pucky.test/oauth/${encodeURIComponent(slug)}`
        })
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
}

async function screenshot(page, reportDir, name) {
  return saveScreenshot(page, reportDir, name);
}

async function assertVisible(page, selector, label) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 8000 });
  return label;
}

async function waitForHome(page) {
  await page.waitForSelector(".light-shell[data-light-route=\"home\"] .light-app-grid", { timeout: 8000 });
}

async function backToHome(page) {
  for (let index = 0; index < 6; index += 1) {
    const isHome = await page.locator(".light-shell[data-light-route=\"home\"]").count();
    if (isHome) {
      return;
    }
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await page.waitForTimeout(150);
  }
  await waitForHome(page);
}

async function clickTile(page, route) {
  await page.locator(`.light-app-tile[data-route="${route}"]`).click();
}

async function assertMeetingsLayout(page, label, { expectWrapped = false } = {}) {
  const layout = await page.evaluate(() => {
    const card = document.querySelector('.light-shell[data-light-route="meetings"] .card-meeting-list');
    const title = card?.querySelector('.title');
    const meta = card?.querySelector('.card-meeting-meta');
    const stamp = card?.querySelector('.card-timestamp');
    const actions = card?.querySelector('.card-actions');
    if (!(card && title && meta && stamp && actions)) {
      return null;
    }
    const rect = (node) => {
      const box = node.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const titleStyle = window.getComputedStyle(title);
    const lineHeight = Number.parseFloat(titleStyle.lineHeight || "0") || 0;
    return {
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      card: rect(card),
      title: rect(title),
      meta: rect(meta),
      stamp: rect(stamp),
      actions: rect(actions),
      titleLineHeight: lineHeight,
    };
  });
  if (!layout) {
    throw new Error(`${label}: could not read meetings layout`);
  }
  if (layout.scrollWidth > layout.innerWidth + 1) {
    throw new Error(`${label}: meetings introduced horizontal overflow (${layout.scrollWidth} > ${layout.innerWidth})`);
  }
  const railLeft = Math.min(layout.meta.left, layout.stamp.left, layout.actions.left);
  if (layout.title.right > railLeft + 2) {
    throw new Error(`${label}: meeting title overlapped the right rail`);
  }
  if (layout.title.left < layout.card.left - 1) {
    throw new Error(`${label}: meeting title clipped past the left edge`);
  }
  if (expectWrapped && !(layout.title.height > layout.titleLineHeight * 1.5)) {
    throw new Error(`${label}: long meeting title did not wrap onto a second line`);
  }
}

async function assertProjectConnectedLayout(page) {
  const state = await page.evaluate(() => {
    const connectedSection = [...document.querySelectorAll(".light-linked-records-section")]
      .find(node => String(node.getAttribute("data-linked-records-title") || "").trim() === "connected");
    return {
      heroCount: document.querySelectorAll(".light-detail-hero").length,
      chipCloudCount: document.querySelectorAll(".light-project-detail-page .light-chip-cloud").length,
      gridCount: document.querySelectorAll(".light-project-section-grid").length,
      connectedSectionCount: connectedSection ? 1 : 0,
      connectedRows: connectedSection ? connectedSection.querySelectorAll(".light-linked-record-feed-row").length : 0,
    };
  });
  if (state.heroCount !== 0) {
    throw new Error("Projects: legacy hero card still rendered in detail");
  }
  if (state.chipCloudCount !== 0) {
    throw new Error("Projects: top chip cloud still rendered in detail");
  }
  if (state.gridCount !== 0) {
    throw new Error("Projects: legacy section grid still rendered in detail");
  }
  if (state.connectedSectionCount !== 1 || state.connectedRows < 1) {
    throw new Error("Projects: unified Connected feed did not render");
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const browser = await chromium.launch({ executablePath: resolveChromePath(), headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT, hasTouch: true, isMobile: true });
  const state = bridgeState();
  await installCodexPuckyBridge(context, message => bridgeResponse(state, message));
  await installLinksApi(context, state);
  const page = await context.newPage();
  attachPageLogging(page, path.join(config.reportDir, "console.log"));

  const screenshots = {};
  try {
    await page.goto(config.pageUrl, { waitUntil: "domcontentloaded" });
    await waitForHome(page);
    await assertVisible(page, "#voiceStatus", "voice status");
    const homeTileCount = await page.locator(".light-app-tile").count();
    if (homeTileCount !== 11) {
      throw new Error(`Expected full light app grid, found ${homeTileCount} tiles`);
    }
    if (await page.locator(".light-status-bar, .light-status-time, .light-status-battery, .light-status-signal").count()) {
      throw new Error("Fake mobile status bar is still rendered");
    }
    if (await page.locator(".light-digest-card, .light-digest-rail").count()) {
      throw new Error("Light home still renders the top digest card section");
    }
    if (await page.locator(".light-app-tile[data-route=\"notifications\"]").count()) {
      throw new Error("Notifications tile should not be present on light home");
    }
    await assertVisible(page, ".light-app-tile[data-route=\"inbox\"]", "inbox tile");
    await assertVisible(page, ".light-app-tile[data-route=\"meetings\"]", "meetings tile");
    screenshots.home = await screenshot(page, config.reportDir, "01-light-home-full-grid");

    await clickTile(page, "connect");
    await assertVisible(page, ".light-shell[data-light-route=\"connect\"] .links-page", "connect links page");
    if (await page.locator(".page-tabs:visible").count()) {
      throw new Error("Dark page tabs are visible in light Connect");
    }
    await page.waitForSelector(".links-app-row", { timeout: 8000 });
    screenshots.apps = await screenshot(page, config.reportDir, "02-light-apps-catalog");
    await page.locator(".links-search").fill("github");
    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll(".links-app-row"));
      return rows.length > 0 && rows.every(row => /github/i.test(row.textContent || ""));
    });
    screenshots.appsSearch = await screenshot(page, config.reportDir, "03-light-apps-search-github");
    await page.locator(".links-app-row").first().click();
    await page.waitForFunction(() => window.__LIGHT_PROOF_BROWSER_OPEN_COUNT__ || false, null, { timeout: 1000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector(".links-page.is-handoff-lock") || window.__PUCKY_LINKS_DEBUG__?.last_event?.event === "browser_open_requested", null, { timeout: 8000 });
    if (!state.browserOpenCommands.length) {
      throw new Error("Links browser handoff command was not captured");
    }
    screenshots.appsHandoff = await screenshot(page, config.reportDir, "04-light-apps-handoff");
    await backToHome(page);

    await clickTile(page, "settings");
    await assertVisible(page, ".light-shell[data-light-route=\"settings\"] .settings-page", "settings page");
    await assertVisible(page, ".settings-card", "settings cards");
    screenshots.settings = await screenshot(page, config.reportDir, "05-light-settings-canonical");
    await backToHome(page);

    await clickTile(page, "inbox");
    await assertVisible(page, ".light-shell[data-light-route=\"inbox\"] .light-real-feed-list", "inbox real feed");
    if ((await page.locator(".light-real-feed-list .card-wrap").count()) < 1) {
      throw new Error("Light Inbox did not render real Home feed cards");
    }
    if ((await page.locator(".light-real-feed-list [data-card-action=\"page\"]").count()) < 1) {
      throw new Error("Light Inbox did not expose canonical page attachment actions");
    }
    if ((await page.locator(".light-real-feed-list [data-card-action=\"audio\"]").count()) < 1) {
      throw new Error("Light Inbox did not expose canonical audio actions");
    }
    screenshots.inbox = await screenshot(page, config.reportDir, "06-light-inbox-fixture-cards");
    await page.locator(".light-real-feed-list .card-body").first().click();
    await assertVisible(page, ".detail-panel.is-open", "inbox detail");
    screenshots.inboxDetail = await screenshot(page, config.reportDir, "07-light-inbox-card-detail");
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await backToHome(page);

    await clickTile(page, "meetings");
    await assertVisible(page, ".light-shell[data-light-route=\"meetings\"] .meetings-page", "meetings page");
    await page.waitForSelector(".light-shell[data-light-route=\"meetings\"] .card-meeting-list", { timeout: 8000 });
    if ((await page.locator(".light-shell[data-light-route=\"meetings\"] .card-meeting-list").count()) < 1) {
      throw new Error("Light Meetings did not render canonical meeting cards");
    }
    await assertMeetingsLayout(page, "meetings-430");
    screenshots.meetings = await screenshot(page, config.reportDir, "08-light-meetings-fixture-cards");
    await page.setViewportSize({ width: 320, height: 740 });
    await assertVisible(page, ".light-shell[data-light-route=\"meetings\"] .card-meeting-list", "meetings page 320");
    await assertMeetingsLayout(page, "meetings-320", { expectWrapped: true });
    screenshots.meetingsNarrow = await screenshot(page, config.reportDir, "08b-light-meetings-fixture-cards-320");
    await page.setViewportSize(VIEWPORT);
    await assertVisible(page, ".light-shell[data-light-route=\"meetings\"] .card-meeting-list", "meetings page reset");
    await page.locator(".light-shell[data-light-route=\"meetings\"] .card-meeting-list .card-body").first().click();
    await assertVisible(page, ".detail-panel.is-open", "meeting detail");
    screenshots.meetingsDetail = await screenshot(page, config.reportDir, "09-light-meetings-detail");
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await assertVisible(page, ".light-shell[data-light-route=\"meetings\"] .meetings-page", "meetings page after detail");
    await page.locator(".light-shell[data-light-route=\"meetings\"] .card-meeting-list [data-card-action=\"audio\"]").first().click();
    await assertVisible(page, ".detail-panel.is-open", "meeting audio detail");
    screenshots.meetingsAudio = await screenshot(page, config.reportDir, "10-light-meetings-audio");
    await page.evaluate(() => window.PuckyHandleAndroidBack && window.PuckyHandleAndroidBack());
    await backToHome(page);

    await clickTile(page, "notes");
    await page.locator(".light-note-row").first().click();
    await assertVisible(page, ".light-shell[data-light-route=\"note-detail\"] .light-note-document", "note detail");
    screenshots.notes = await screenshot(page, config.reportDir, "11-light-note-detail");
    await backToHome(page);

    await clickTile(page, "tasks");
    await assertVisible(page, ".light-shell[data-light-route=\"tasks\"]", "tasks");
    for (const label of ["DO", "DO SOON", "OVERDUE", "DONE"]) {
      await page.getByText(label, { exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
    }
    screenshots.tasks = await screenshot(page, config.reportDir, "12-light-tasks-groups");
    await page.locator(".light-task-row").first().click();
    await assertVisible(page, ".light-shell[data-light-route=\"task-detail\"]", "task detail");
    await backToHome(page);

    await clickTile(page, "calendar");
    await assertVisible(page, ".light-shell[data-light-route=\"calendar\"] .light-timeline", "calendar");
    await page.locator(".light-event-block").first().click();
    await assertVisible(page, ".light-shell[data-light-route=\"meeting-detail\"] .light-event-document", "meeting detail");
    screenshots.calendar = await screenshot(page, config.reportDir, "13-light-calendar-event-detail");
    await backToHome(page);

    await clickTile(page, "meeting-notes");
    await assertVisible(page, ".light-shell[data-light-route=\"meeting-notes\"] .light-graph-row", "meeting notes");
    if (await page.locator(".light-shell[data-light-route=\"meeting-notes\"] .light-graph-row .light-graph-chip-row").count()) {
      throw new Error("Meeting Notes list still renders right-side pill chips");
    }
    if (await page.locator(".light-shell[data-light-route=\"meeting-notes\"] .light-graph-row .light-small-icon, .light-shell[data-light-route=\"meeting-notes\"] .light-graph-row .light-chevron").count()) {
      throw new Error("Meeting Notes list regressed its icon/chevron cleanup");
    }
    screenshots.meetingNotes = await screenshot(page, config.reportDir, "14-light-meeting-notes-list");
    await page.locator(".light-shell[data-light-route=\"meeting-notes\"] .light-graph-row").first().click();
    await assertVisible(page, ".light-shell[data-light-route=\"meeting-note-detail\"]", "meeting note detail");
    screenshots.meetingNoteDetail = await screenshot(page, config.reportDir, "14b-light-meeting-note-detail");
    await backToHome(page);

    await clickTile(page, "projects");
    await page.locator(".light-project-row").first().click();
    await assertVisible(page, ".light-shell[data-light-route=\"project-detail\"] .light-linked-records-section", "project detail");
    await assertProjectConnectedLayout(page);
    screenshots.projects = await screenshot(page, config.reportDir, "15-light-project-detail");
    await backToHome(page);

    await clickTile(page, "contacts");
    await page.locator(".light-contact-row").first().click();
    await assertVisible(page, ".light-shell[data-light-route=\"contact-detail\"] .light-profile-card", "contact detail");
    screenshots.contacts = await screenshot(page, config.reportDir, "16-light-contact-detail");
    await backToHome(page);

    screenshots.backHome = await screenshot(page, config.reportDir, "17-back-home");
    const summary = {
      schema: "pucky.light_walkthrough_fixture_proof.v1",
      ok: true,
      proof_data_source: "local_playwright_fixtures_and_mocked_api",
      page_url: config.pageUrl,
      screenshots,
      browser_open_commands: state.browserOpenCommands,
      home_tile_count: homeTileCount
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
