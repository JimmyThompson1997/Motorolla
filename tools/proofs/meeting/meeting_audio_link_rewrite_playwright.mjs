import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  emptyPlayerState,
  ensureDir,
  fileUrl,
  idleTurnStatus,
  installCodexPuckyBridge,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const uiPath = path.join(repoRoot, "pucky_vm", "ui_src", "index.html");
const reportDir = path.join(repoRoot, ".tmp", "meeting-audio-link-rewrite");
const consoleLogPath = path.join(reportDir, "console.log");
const summaryPath = path.join(reportDir, "summary.json");
const VIEWPORT = { width: 430, height: 932 };

const meetingId = "meeting-proof-local-audio";
const localAudioPath = "/data/data/com.pucky.device.debug/files/meetings/Jimmy_and_Jack_Follow_ups_06.03.26.m4a";
const localAudioUrl = `https://pucky.local/artifact?path=${encodeURIComponent(localAudioPath)}`;
const rawVmAudioUrl = `https://pucky.example.test/api/meetings/${meetingId}/audio`;
const htmlPath = "meeting-summary-proof.html";
const transcriptText = [
  "[00:00-00:02] Jimmy: I'm Jimmy and this is Jack.",
  "[00:02-00:05] Jack: Pucky, after this meeting, prepare follow-up notes for both of us."
].join("\n");
const htmlContent = `<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meeting Summary</title>
<h1>Jimmy and Jack Follow-ups</h1>
<h2>Overview</h2>
<p>Jimmy and Jack agreed on follow-up notes.</p>
<h2>Action Items by Person</h2>
<ul><li>Jimmy: review the transcript.</li><li>Jack: prepare notes.</li></ul>
<h2>Pucky Follow-Up</h2>
<p>Pucky prepared follow-up notes.</p>
<p>{{PUCKY_MEETING_AUDIO_LINK}}</p>
<p><a href="${rawVmAudioUrl}">Legacy raw audio URL</a></p>`;

function meetingCard() {
  return {
    schema: "pucky.feed_item.v1",
    card_id: `pucky_card_${meetingId}`,
    session_id: meetingId,
    turn_id: meetingId,
    title: "Jimmy and Jack Follow-ups",
    summary: "Meeting processed with participant-owned follow-ups.",
    icon: "mic",
    archived: false,
    read: false,
    created_at: "2026-06-03T18:00:00Z",
    updated_at: "2026-06-03T18:01:00Z",
    audio_path: localAudioPath,
    audio_url: rawVmAudioUrl,
    canonical_basename: "Jimmy_and_Jack_Follow_ups_06.03.26",
    meeting_id: meetingId,
    transcript_messages: [
      {
        role: "user",
        text: "Meeting recording",
        created_at: "2026-06-03T18:00:00Z"
      },
      {
        role: "assistant",
        text: "Meeting processed with participant-owned follow-ups.",
        created_at: "2026-06-03T18:01:00Z",
        attachments: [
          {
            id: `${meetingId}:html`,
            kind: "html",
            title: "Meeting Summary",
            mime_type: "text/html",
            viewer_path: htmlPath,
            meeting_id: meetingId,
            device_path: localAudioPath,
            audio_url: rawVmAudioUrl,
            canonical_basename: "Jimmy_and_Jack_Follow_ups_06.03.26",
            started_at: "2026-06-03T18:00:00Z",
            mime_type_audio: "audio/mp4"
          },
          {
            id: `${meetingId}:transcript`,
            kind: "text",
            title: "Meeting Transcript",
            mime_type: "text/plain",
            text: transcriptText
          }
        ]
      }
    ]
  };
}

function cardsSnapshot() {
  return {
    schema: "pucky.reply_cards.v1",
    count: 1,
    cards: [meetingCard()]
  };
}

function dispatch(state, message) {
  const command = String(message.command || "");
  const args = message.args && typeof message.args === "object" ? message.args : {};
  state.commands.push({ command, args });
  switch (command) {
    case "ui.reply_cards.get":
      return cardsSnapshot();
    case "pucky.turn.status":
      return idleTurnStatus();
    case "player.state":
      return state.playerState;
    case "artifact.read_base64":
      if (String(args.path || "") === htmlPath) {
        return {
          schema: "pucky.artifact_read.v1",
          mime_type: "text/html",
          content_base64: Buffer.from(htmlContent, "utf8").toString("base64"),
          bytes: Buffer.byteLength(htmlContent, "utf8")
        };
      }
      return {
        schema: "pucky.artifact_read.v1",
        mime_type: "text/plain",
        content_base64: Buffer.from(transcriptText, "utf8").toString("base64"),
        bytes: Buffer.byteLength(transcriptText, "utf8")
      };
    case "meeting.recording.resolve_audio_link":
      return {
        schema: "pucky.meeting_audio_link.v1",
        meeting_id: String(args.meeting_id || meetingId),
        device_path: localAudioPath,
        canonical_basename: "Jimmy_and_Jack_Follow_ups_06.03.26",
        url: localAudioUrl,
        source: "renamed_local"
      };
    case "artifact.url":
      return {
        schema: "pucky.artifact_url.v1",
        url: localAudioUrl,
        path: localAudioPath,
        mime_type: "audio/mp4"
      };
    default:
      throw new Error(`Unsupported bridge command: ${command}`);
  }
}

async function run() {
  ensureDir(reportDir);
  fs.writeFileSync(consoleLogPath, "", "utf8");
  const screenshots = {};
  const state = {
    commands: [],
    playerState: emptyPlayerState()
  };
  const summary = {
    ui_path: uiPath,
    ui_url: fileUrl(uiPath),
    meeting_id: meetingId,
    local_audio_path: localAudioPath,
    local_audio_url: localAudioUrl,
    raw_vm_audio_url: rawVmAudioUrl,
    screenshots
  };

  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromePath(),
    args: [
      "--disable-extensions",
      "--allow-file-access-from-files",
      "--autoplay-policy=no-user-gesture-required"
    ]
  });
  const context = await browser.newContext({ viewport: VIEWPORT });
  await installCodexPuckyBridge(context, (message) => dispatch(state, message));
  const page = await context.newPage();
  attachPageLogging(page, consoleLogPath);

  try {
    await page.goto(fileUrl(uiPath), { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector(`[data-card-session-id="${meetingId}"]`, { timeout: 10000 });
    screenshots.home = await saveScreenshot(page, reportDir, "01-home-meeting-card");

    await page.evaluate((id) => window.PuckyUiDebug.dispatch("open_card_action", { session_id: id, action: "transcript" }), meetingId);
    await page.waitForSelector("#detail.is-open", { timeout: 5000 });
    await page.waitForSelector(".bubble-attachment-chip", { timeout: 5000 });
    screenshots.transcript = await saveScreenshot(page, reportDir, "02-transcript-thread");

    const threadText = await page.locator("#detail").textContent();
    summary.no_your_audio_chip = !String(threadText || "").includes("Your audio");
    summary.transcript_first_detail_type = await page.locator("#detail").getAttribute("data-detail-type");
    summary.meeting_summary_chip_count = await page.locator('.bubble-attachment-chip:has-text("Meeting Summary")').count();
    summary.meeting_transcript_chip_count = await page.locator('.bubble-attachment-chip:has-text("Meeting Transcript")').count();

    await page.locator('.bubble-attachment-chip:has-text("Meeting Summary")').click();
    await page.waitForSelector("#detail.is-open iframe", { timeout: 5000 });
    screenshots.summaryHtml = await saveScreenshot(page, reportDir, "03-summary-html");

    const frame = page.frameLocator("#detail iframe");
    await frame.locator("a.pucky-meeting-audio-link").waitFor({ timeout: 5000 });
    const rewrittenHref = await frame.locator("a.pucky-meeting-audio-link").first().getAttribute("href");
    const legacyHref = await frame.locator("a", { hasText: "Legacy raw audio URL" }).getAttribute("href");
    const htmlText = await frame.locator("body").textContent();

    summary.rewritten_href = rewrittenHref;
    summary.legacy_href = legacyHref;
    summary.html_contains_placeholder = String(htmlText || "").includes("PUCKY_MEETING_AUDIO_LINK");
    summary.raw_vm_url_present = String(rewrittenHref || "").includes("/api/meetings/") || String(legacyHref || "").includes("/api/meetings/");
    summary.resolve_audio_link_calls = state.commands.filter(item => item.command === "meeting.recording.resolve_audio_link").length;
    summary.commands = state.commands;

    if (!summary.no_your_audio_chip) {
      throw new Error("Transcript thread still contains Your audio");
    }
    if (summary.transcript_first_detail_type !== "transcript") {
      throw new Error(`Expected transcript-first detail, got ${summary.transcript_first_detail_type}`);
    }
    if (!String(rewrittenHref || "").startsWith("https://pucky.local/artifact?")) {
      throw new Error(`Audio placeholder was not rewritten to pucky.local: ${rewrittenHref}`);
    }
    if (summary.raw_vm_url_present) {
      throw new Error("Raw VM meeting audio URL remained in rendered meeting HTML");
    }
    if (summary.resolve_audio_link_calls < 1) {
      throw new Error("meeting.recording.resolve_audio_link was not called");
    }

    summary.ok = true;
  } catch (error) {
    summary.ok = false;
    summary.error = error.message || String(error);
    writeAutomationError(reportDir, error);
    throw error;
  } finally {
    writeJsonFile(summaryPath, summary);
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
