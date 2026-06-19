import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import {
  attachPageLogging,
  emptyPlayerState,
  ensureDir,
  idleTurnStatus,
  installCodexPuckyBridge,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const DEFAULT_API_TOKEN = "secret";
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const options = {
    mode: "deterministic"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (token === "--mode" && argv[index + 1]) {
      options.mode = String(argv[index + 1] || "deterministic").trim().toLowerCase();
      index += 1;
    }
  }
  if (!["deterministic", "live"].includes(options.mode)) {
    throw new Error(`Unsupported mode: ${options.mode}`);
  }
  return options;
}

async function findFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startProofServer(port, reportDir, mode) {
  const pythonPathParts = [repoRoot, process.env.PYTHONPATH || ""].filter(Boolean);
  const child = spawn(
    "python",
    ["tools/proofs/meeting/meeting_mode_agent_proof_server.py", "--port", String(port), "--report-dir", reportDir, "--mode", mode === "live" ? "live" : "fake"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONPATH: pythonPathParts.join(path.delimiter)
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  return child;
}

function attachServerLogging(child, serverLogPath) {
  const append = (prefix) => (chunk) => {
    fs.appendFileSync(serverLogPath, `${prefix}${String(chunk)}`, "utf8");
  };
  child.stdout.on("data", append(""));
  child.stderr.on("data", append("[stderr] "));
  child.on("error", (error) => {
    fs.appendFileSync(serverLogPath, `[spawn-error] ${error.stack || error.message}\n`, "utf8");
  });
}

function terminateServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  try {
    child.kill();
  } catch (_) {
    // Fall through.
  }
  if (child.exitCode === null) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
  }
}

async function waitForServerReady(baseUrl, child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Proof server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/ui/pucky/latest/manifest.json`, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch (_) {
      // Keep polling.
    }
    await delay(300);
  }
  throw new Error("Timed out waiting for proof server");
}

async function apiJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${DEFAULT_API_TOKEN}`,
      ...(options.headers || {})
    },
    method: options.method || "GET",
    body: options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload.detail || payload.error || `HTTP ${response.status}`));
  }
  return payload;
}

async function fetchFeedSnapshot(baseUrl) {
  const payload = await apiJson(baseUrl, "/api/feed?limit=100");
  return {
    schema: "pucky.reply_cards.v1",
    count: Array.isArray(payload.items) ? payload.items.length : 0,
    cards: Array.isArray(payload.items) ? payload.items : []
  };
}

async function browserFeedSnapshot(page) {
  return page.evaluate(() => window.Pucky.request({ command: "ui.reply_cards.get", args: {} }));
}

async function fetchMeetingDetail(baseUrl, meetingId) {
  return apiJson(baseUrl, `/api/meetings/${encodeURIComponent(meetingId)}`);
}

async function fetchArtifactBase64(baseUrl, artifactId) {
  const response = await fetch(`${baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${DEFAULT_API_TOKEN}` }
  });
  if (!response.ok) {
    throw new Error(`Artifact fetch failed (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    schema: "pucky.artifact_read.v1",
    mime_type: String(response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0].trim(),
    content_base64: bytes.toString("base64"),
    bytes: bytes.length
  };
}

function artifactIdFromPath(rawPath) {
  const value = String(rawPath || "");
  const prefix = "fixtures/artifacts/";
  if (value.startsWith(prefix)) {
    return decodeURIComponent(value.slice(prefix.length));
  }
  return "";
}

function mimeTypeFromPath(rawPath) {
  const value = String(rawPath || "").toLowerCase();
  if (value.endsWith(".txt")) return "text/plain";
  if (value.endsWith(".html") || value.endsWith(".htm")) return "text/html";
  if (value.endsWith(".m4a")) return "audio/mp4";
  if (value.endsWith(".wav")) return "audio/wav";
  if (value.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

async function postMeeting(baseUrl, payload) {
  return apiJson(baseUrl, "/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function waitForMeetingState(baseUrl, meetingId, expectedState, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await fetchMeetingDetail(baseUrl, meetingId);
    const meeting = payload.meeting || {};
    if (String(meeting.state || "") === expectedState) {
      return meeting;
    }
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${meetingId} to reach ${expectedState}`);
}

async function triggerFeedRefresh(page) {
  await page.evaluate(() => window.PuckyUiDebug.dispatch("refresh_cards"));
  await delay(400);
}

async function waitForCardText(page, meetingId, text, timeoutMs = 30000) {
  const selector = `[data-card-session-id="${meetingId}"]`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await triggerFeedRefresh(page);
    const content = await page.locator(selector).textContent().catch(() => "");
    if (String(content || "").includes(text)) {
      return;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for card ${meetingId} to include "${text}"`);
}

async function waitForDetail(page, detailType, viewer = null, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      hidden: document.getElementById("detail")?.getAttribute("aria-hidden") || "",
      type: document.getElementById("detail")?.getAttribute("data-detail-type") || "",
      viewer: document.getElementById("detail")?.getAttribute("data-detail-viewer") || ""
    }));
    if (state.hidden !== "true" && state.type === detailType && (viewer === null || state.viewer === viewer)) {
      return state;
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for detail ${detailType}${viewer ? `/${viewer}` : ""}`);
}

async function openMeetingTranscript(page, meetingId) {
  const result = await page.evaluate((sessionId) => window.PuckyUiDebug.dispatch("open_card_action", { session_id: sessionId, action: "transcript" }), meetingId);
  if (!result?.ok) {
    throw new Error(`Could not open transcript action for ${meetingId}: ${result?.error || "unknown error"}`);
  }
  await waitForDetail(page, "transcript");
}

async function backToDetail(page, detailType, viewer = null) {
  const result = await page.evaluate(() => window.PuckyUiDebug.dispatch("back"));
  if (!result?.ok) {
    throw new Error(`Back action failed: ${result?.error || "unknown error"}`);
  }
  await waitForDetail(page, detailType, viewer);
}

async function backToFeed(page) {
  const result = await page.evaluate(() => window.PuckyUiDebug.dispatch("back"));
  if (!result?.ok) {
    throw new Error(`Back action failed: ${result?.error || "unknown error"}`);
  }
  await page.waitForFunction(() => {
    const detail = document.getElementById("detail");
    return !detail || detail.getAttribute("aria-hidden") === "true";
  }, {}, { timeout: 5000 });
}

function base64MarkerAudio(marker) {
  return Buffer.from(`RIFF${marker}`, "utf8").toString("base64");
}

function deterministicPayload({ meetingId, startedAt, marker }) {
  return {
    meeting_id: meetingId,
    started_at: startedAt,
    stopped_at: startedAt.replace(":00Z", ":05Z"),
    duration_ms: marker === "silent-audio" ? 3000 : 5000,
    device_id: "proof-device",
    device_path: `/data/user/0/com.pucky.device.debug/files/voice/${meetingId}.m4a`,
    mime_type: "audio/mp4",
    audio_base64: base64MarkerAudio(marker)
  };
}

function livePayload({ meetingId, startedAt, audioPath }) {
  return {
    meeting_id: meetingId,
    started_at: startedAt,
    stopped_at: startedAt.replace(":00Z", ":05Z"),
    duration_ms: 5000,
    device_id: "proof-device",
    device_path: `/data/user/0/com.pucky.device.debug/files/voice/${meetingId}.wav`,
    mime_type: "audio/wav",
    audio_base64: fs.readFileSync(audioPath).toString("base64")
  };
}

function createSilenceWavBuffer(durationMs = 1200, sampleRate = 16000) {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const samples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const dataSize = samples * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function powershellSingleQuoted(value) {
  return String(value || "").replace(/'/g, "''");
}

function generateSsmlFixture(targetPath, ssml) {
  const command = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$ssml = @'\n${ssml}\n'@`,
    `$s.SetOutputToWaveFile('${powershellSingleQuoted(targetPath)}')`,
    "$s.SpeakSsml($ssml)",
    "$s.Dispose()"
  ].join("; ");
  const result = spawnSync("powershell", ["-NoProfile", "-Command", command], {
    windowsHide: true,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`Failed to generate SSML fixture ${targetPath}: ${result.stderr || result.stdout || "unknown error"}`);
  }
}

function ensureLiveFixtures(reportDir) {
  const fixtureDir = path.join(reportDir, "live-fixtures");
  ensureDir(fixtureDir);
  const clearPath = path.join(fixtureDir, "clear-speakers.wav");
  const ambiguousPath = path.join(fixtureDir, "ambiguous-speakers.wav");
  const silentPath = path.join(fixtureDir, "silent-audio.wav");
  if (!fs.existsSync(clearPath)) {
    generateSsmlFixture(
      clearPath,
      "<speak version='1.0' xml:lang='en-US' xmlns='http://www.w3.org/2001/10/synthesis'>"
      + "<voice name='Microsoft David Desktop'>Hello, I'm Jimmy. I will send the revised deck by Friday.</voice>"
      + "<break time='450ms'/>"
      + "<voice name='Microsoft Zira Desktop'>Hi Jimmy, I'm Jack. I will prepare the notes after the meeting.</voice>"
      + "</speak>"
    );
  }
  if (!fs.existsSync(ambiguousPath)) {
    generateSsmlFixture(
      ambiguousPath,
      "<speak version='1.0' xml:lang='en-US' xmlns='http://www.w3.org/2001/10/synthesis'>"
      + "<voice name='Microsoft David Desktop'>We should send the revised deck by Friday.</voice>"
      + "<break time='450ms'/>"
      + "<voice name='Microsoft Zira Desktop'>I can handle the budget table.</voice>"
      + "</speak>"
    );
  }
  if (!fs.existsSync(silentPath)) {
    fs.writeFileSync(silentPath, createSilenceWavBuffer(1400));
  }
  return { clearPath, ambiguousPath, silentPath };
}

function deterministicScenarios() {
  return [
    {
      name: "clear-speakers",
      meetingId: "meeting-20260603-180000-proof-clear",
      payload: deterministicPayload({
        meetingId: "meeting-20260603-180000-proof-clear",
        startedAt: "2026-06-03T18:00:00Z",
        marker: "clear-speakers"
      }),
      expectedCardTitle: "Meeting Notes",
      expectedRecordingTitle: "Jimmy and Jack Follow-ups",
      expectedCanonicalStem: "Jimmy_and_Jack_Follow_ups",
      expectedTitleQuality: "human_like",
      expectedRecordingTitleQuality: "human_like",
      expectNames: ["Jimmy:", "Jack:"],
      expectedDiarizationStatus: "speaker_turns"
    },
    {
      name: "unknown-speakers",
      meetingId: "meeting-20260603-181000-proof-unknown",
      payload: deterministicPayload({
        meetingId: "meeting-20260603-181000-proof-unknown",
        startedAt: "2026-06-03T18:10:00Z",
        marker: "unknown-speakers"
      }),
      expectedCardTitle: "Meeting Notes",
      expectedRecordingTitle: "Deck Follow-up Review",
      expectedCanonicalStem: "Deck_Follow_up_Review",
      expectedTitleQuality: "human_like",
      expectedRecordingTitleQuality: "human_like",
      forbidNames: ["Jimmy:", "Jack:"],
      expectTranscriptIncludes: ["speaker_0:", "speaker_1:"],
      expectedDiarizationStatus: "speaker_turns"
    },
    {
      name: "silent-audio",
      meetingId: "meeting-20260603-182000-proof-silent",
      payload: deterministicPayload({
        meetingId: "meeting-20260603-182000-proof-silent",
        startedAt: "2026-06-03T18:20:00Z",
        marker: "silent-audio"
      }),
      expectedCardTitle: "Meeting Notes",
      expectedRecordingTitle: "Silent Audio Check",
      expectedCanonicalStem: "Silent_Audio_Check",
      expectedTitleQuality: "human_like",
      expectedRecordingTitleQuality: "human_like",
      expectTranscriptIncludes: ["No clear speech detected"],
      expectedDiarizationStatus: "plain_transcript"
    },
    {
      name: "raw-title",
      meetingId: "meeting-20260603-183000-proof-raw-title",
      payload: deterministicPayload({
        meetingId: "meeting-20260603-183000-proof-raw-title",
        startedAt: "2026-06-03T18:30:00Z",
        marker: "clear-speakers"
      }),
      expectedCardTitle: "meeting-20260603-183000-proof-raw-title",
      expectedRecordingTitle: "meeting-20260603-183000-proof-raw-title",
      expectedTitleQuality: "machine_like",
      expectedRecordingTitleQuality: "machine_like",
      expectNames: ["Jimmy:", "Jack:"],
      expectedDiarizationStatus: "speaker_turns"
    }
  ];
}

function liveScenarios(reportDir) {
  const fixtures = ensureLiveFixtures(reportDir);
  return [
    {
      name: "live-clear-speakers",
      meetingId: "meeting-20260604-180000-live-clear",
      payload: livePayload({
        meetingId: "meeting-20260604-180000-live-clear",
        startedAt: "2026-06-04T18:00:00Z",
        audioPath: fixtures.clearPath
      }),
      expectNames: ["Jimmy", "Jack"],
      expectedProvider: "deepgram"
    },
    {
      name: "live-ambiguous-speakers",
      meetingId: "meeting-20260604-181000-live-ambiguous",
      payload: livePayload({
        meetingId: "meeting-20260604-181000-live-ambiguous",
        startedAt: "2026-06-04T18:10:00Z",
        audioPath: fixtures.ambiguousPath
      }),
      forbidNames: ["Jimmy", "Jack"],
      expectedProvider: "deepgram"
    },
    {
      name: "live-silent-audio",
      meetingId: "meeting-20260604-182000-live-silent",
      payload: livePayload({
        meetingId: "meeting-20260604-182000-live-silent",
        startedAt: "2026-06-04T18:20:00Z",
        audioPath: fixtures.silentPath
      }),
      expectedProvider: "deepgram"
    }
  ];
}

function summarizeAttachments(meeting) {
  const messages = Array.isArray(meeting?.feed_item?.transcript_messages) ? meeting.feed_item.transcript_messages : [];
  const assistant = messages.find((item) => String(item?.role || "").toLowerCase() === "assistant") || {};
  return Array.isArray(assistant.attachments) ? assistant.attachments : [];
}

async function runScenario({
  page,
  baseUrl,
  reportDir,
  scenario,
  pathToMeetingId,
  bridgeState,
  takePendingScreenshot = false,
  takeInteractionScreenshots = false
}) {
  const bridgeCommandStart = Array.isArray(bridgeState?.commands) ? bridgeState.commands.length : 0;
  await postMeeting(baseUrl, scenario.payload);
  if (takePendingScreenshot) {
    await waitForCardText(page, scenario.meetingId, "Processing");
    scenario.screenshot_pending = await saveScreenshot(page, reportDir, "01-meeting-pending");
  }
  const meeting = await waitForMeetingState(baseUrl, scenario.meetingId, "completed");
  await triggerFeedRefresh(page);
  const feedSnapshot = await browserFeedSnapshot(page);
  const feedCard = Array.isArray(feedSnapshot?.cards)
    ? feedSnapshot.cards.find((item) => String(item?.session_id || "") === scenario.meetingId)
    : null;
  if (!feedCard) {
    throw new Error(`Could not find completed feed card for ${scenario.meetingId}`);
  }
  if (String(feedCard.title || "") !== String(meeting.title || scenario.expectedCardTitle || "")) {
    throw new Error(`Feed card title mismatch for ${scenario.meetingId}: ${feedCard.title || "<empty>"} vs ${meeting.title || "<empty>"}`);
  }
  if (takeInteractionScreenshots) {
    scenario.screenshot_completed = await saveScreenshot(page, reportDir, "01b-meeting-completed");
  }
  const detailPayload = await fetchMeetingDetail(baseUrl, scenario.meetingId);
  const detailMeeting = detailPayload.meeting || {};
  for (const value of [detailMeeting.device_path, detailMeeting.audio_path]) {
    const clean = String(value || "").trim();
    if (clean) {
      pathToMeetingId.set(clean, scenario.meetingId);
    }
  }

  if (scenario.expectedCardTitle && String(detailMeeting.title || "") !== scenario.expectedCardTitle) {
    throw new Error(`Expected ${scenario.name} card title ${scenario.expectedCardTitle}, got ${detailMeeting.title || "<empty>"}`);
  }
  if (scenario.expectedRecordingTitle && String(detailMeeting.recording_title || "") !== scenario.expectedRecordingTitle) {
    throw new Error(`Expected ${scenario.name} recording title ${scenario.expectedRecordingTitle}, got ${detailMeeting.recording_title || "<empty>"}`);
  }
  if (scenario.expectedTitleQuality && String(detailMeeting.agent?.title_quality || "") !== scenario.expectedTitleQuality) {
    throw new Error(`Expected ${scenario.name} title_quality ${scenario.expectedTitleQuality}, got ${detailMeeting.agent?.title_quality || "<empty>"}`);
  }
  if (scenario.expectedRecordingTitleQuality && String(detailMeeting.agent?.recording_title_quality || "") !== scenario.expectedRecordingTitleQuality) {
    throw new Error(`Expected ${scenario.name} recording_title_quality ${scenario.expectedRecordingTitleQuality}, got ${detailMeeting.agent?.recording_title_quality || "<empty>"}`);
  }
  if (scenario.expectedProvider && String(detailMeeting.agent?.transcription_provider || "") !== scenario.expectedProvider) {
    throw new Error(`Expected ${scenario.name} transcription provider ${scenario.expectedProvider}, got ${detailMeeting.agent?.transcription_provider || "<empty>"}`);
  }
  if (scenario.expectedDiarizationStatus && String(detailMeeting.diarization_status || "") !== scenario.expectedDiarizationStatus) {
    throw new Error(`Expected ${scenario.name} diarization status ${scenario.expectedDiarizationStatus}, got ${detailMeeting.diarization_status || "<empty>"}`);
  }
  if (!detailMeeting.feed_item?.telemetry?.last_meeting_tool_name || String(detailMeeting.feed_item.telemetry.last_meeting_tool_name) !== "meeting_deepgram_transcribe") {
    throw new Error(`${scenario.name} did not report meeting_deepgram_transcribe in telemetry`);
  }
  if (!detailMeeting.feed_item?.telemetry?.meeting_recording_title || String(detailMeeting.feed_item.telemetry.meeting_recording_title || "") !== String(detailMeeting.recording_title || "")) {
    throw new Error(`${scenario.name} telemetry did not preserve recording title`);
  }
  if (String(detailMeeting.recording_title || "").trim() && String(detailMeeting.recording_title || "") !== String(detailMeeting.title || "")
      && String(detailMeeting.recording_title_source || detailMeeting.agent?.recording_title_source || "").trim() === "card_title_fallback") {
    throw new Error(`${scenario.name} recording title fell back to card title instead of agent output`);
  }
  if (scenario.expectedCanonicalStem && !String(detailMeeting.canonical_basename || "").startsWith(scenario.expectedCanonicalStem)) {
    throw new Error(`${scenario.name} canonical basename did not derive from recording title: ${detailMeeting.canonical_basename || "<empty>"}`);
  }
  if (scenario.expectedCanonicalStem && String(detailMeeting.canonical_basename || "").startsWith("Meeting_Notes")) {
    throw new Error(`${scenario.name} canonical basename incorrectly followed the card title`);
  }

  const transcriptText = String(detailMeeting.transcript_text || "");
  for (const snippet of scenario.expectNames || []) {
    if (!transcriptText.includes(snippet)) {
      throw new Error(`${scenario.name} transcript did not include ${snippet}`);
    }
  }
  for (const snippet of scenario.expectTranscriptIncludes || []) {
    if (!transcriptText.includes(snippet)) {
      throw new Error(`${scenario.name} transcript did not include ${snippet}`);
    }
  }
  for (const snippet of scenario.forbidNames || []) {
    if (transcriptText.includes(snippet)) {
      throw new Error(`${scenario.name} transcript unexpectedly included ${snippet}`);
    }
  }

  await openMeetingTranscript(page, scenario.meetingId);
  if (takeInteractionScreenshots) {
    scenario.screenshot_transcript = await saveScreenshot(page, reportDir, "02-meeting-transcript");
  }

  const chipTexts = [...new Set(await page.locator("#detail .bubble-attachment-chip span").allTextContents())];
  for (const requiredLabel of ["Meeting Transcript", "Meeting Summary", "Meeting Audio"]) {
    if (!chipTexts.includes(requiredLabel)) {
      throw new Error(`${scenario.name} transcript detail is missing attachment chip ${requiredLabel}`);
    }
  }

  await page.locator("#detail .bubble-attachment-chip", { hasText: "Meeting Transcript" }).last().click();
  await waitForDetail(page, "attachment", "text");
  await page.waitForSelector("#detail .text-preview", { timeout: 10000 });
  const transcriptAttachmentText = await page.locator("#detail .text-preview").last().textContent();
  if (!String(transcriptAttachmentText || "").trim() || /no text preview|text preview unavailable/i.test(String(transcriptAttachmentText || ""))) {
    throw new Error(`${scenario.name} transcript attachment did not render readable text`);
  }
  if (takeInteractionScreenshots) {
    scenario.screenshot_transcript_attachment = await saveScreenshot(page, reportDir, "03-meeting-transcript-attachment");
  }
  await backToDetail(page, "transcript");

  await page.locator("#detail .bubble-attachment-chip", { hasText: "Meeting Summary" }).last().click();
  await waitForDetail(page, "attachment", "html_iframe");
  await page.waitForSelector("#detail iframe.document-frame", { timeout: 10000 });
  const summaryText = await page.locator("#detail iframe.document-frame").last().evaluate((node) => {
    const frame = node instanceof HTMLIFrameElement ? node : null;
    return String(frame?.contentDocument?.body?.textContent || frame?.srcdoc || "");
  });
  if (takeInteractionScreenshots) {
    scenario.screenshot_summary = await saveScreenshot(page, reportDir, "04-meeting-summary");
  }
  const renderedSummaryHtml = await page.locator("#detail iframe.document-frame").last().evaluate((node) => {
    const frame = node instanceof HTMLIFrameElement ? node : null;
    return String(frame?.contentDocument?.body?.innerHTML || frame?.srcdoc || "");
  });
  const attachments = summarizeAttachments(detailMeeting);
  const summaryAttachment = attachments.find((item) => item && item.title === "Meeting Summary");
  const rawSummaryHtml = summaryAttachment
    ? Buffer.from(String((await fetchArtifactBase64(baseUrl, String(summaryAttachment.artifact || ""))).content_base64 || ""), "base64").toString("utf8")
    : "";
  if (!rawSummaryHtml) {
    throw new Error(`${scenario.name} is missing raw Meeting Summary HTML content`);
  }
  if (!rawSummaryHtml.includes("{{PUCKY_MEETING_TRANSCRIPT_LINK}}") || !rawSummaryHtml.includes("{{PUCKY_MEETING_AUDIO_LINK}}")) {
    throw new Error(`${scenario.name} summary HTML is missing the required transcript/audio placeholders`);
  }
  if (rawSummaryHtml.includes("/api/meetings/") || rawSummaryHtml.includes("/tmp/") || rawSummaryHtml.includes("<script")) {
    throw new Error(`${scenario.name} summary HTML still contains raw runtime links or inline script`);
  }
  if (!renderedSummaryHtml.includes("pucky-meeting-transcript-link") || !renderedSummaryHtml.includes("pucky-meeting-audio-link")) {
    throw new Error(`${scenario.name} rendered summary did not expose transcript/audio controls`);
  }
  if (renderedSummaryHtml.includes("{{PUCKY_MEETING_TRANSCRIPT_LINK}}") || renderedSummaryHtml.includes("{{PUCKY_MEETING_AUDIO_LINK}}")) {
    throw new Error(`${scenario.name} rendered summary did not rewrite the placeholder controls`);
  }
  if (renderedSummaryHtml.includes("/api/meetings/") || renderedSummaryHtml.includes("/tmp/")) {
    throw new Error(`${scenario.name} rendered summary still exposes raw meeting URLs or temp paths`);
  }
  const summaryFrame = page.frameLocator("#detail iframe.document-frame");
  await summaryFrame.locator("a.pucky-meeting-transcript-link").click();
  await waitForDetail(page, "attachment", "text");
  await page.waitForSelector("#detail .text-preview", { timeout: 10000 });
  const transcriptFromHtmlText = await page.locator("#detail .text-preview").last().textContent();
  if (!String(transcriptFromHtmlText || "").trim() || /no text preview|text preview unavailable/i.test(String(transcriptFromHtmlText || ""))) {
    throw new Error(`${scenario.name} transcript link inside summary did not open transcript detail`);
  }
  if (takeInteractionScreenshots) {
    scenario.screenshot_transcript_from_html = await saveScreenshot(page, reportDir, "05-meeting-transcript-from-html");
  }
  await backToDetail(page, "attachment", "html_iframe");

  const playerStateBeforeAudio = await page.evaluate(() => window.Pucky.request({ command: "player.state", args: {} }));
  await page.frameLocator("#detail iframe.document-frame").locator("a.pucky-meeting-audio-link").click();
  await waitForDetail(page, "attachment", "audio_player");
  await page.waitForFunction(() => {
    const players = Array.from(document.querySelectorAll("#detail audio.attachment-audio-player"));
    const audio = players.length ? players[players.length - 1] : null;
    return Boolean(audio && audio.getAttribute("src"));
  }, {}, { timeout: 10000 });
  const audioSource = await page.locator("#detail audio.attachment-audio-player").last().evaluate((node) => node.getAttribute("src") || "");
  if (!audioSource) {
    throw new Error(`${scenario.name} Meeting Audio attachment did not resolve an audio source`);
  }
  if (audioSource.includes("/api/meetings/")) {
    throw new Error(`${scenario.name} Meeting Audio attachment fell back to a raw meeting URL`);
  }
  const playerStateAfterAudio = await page.evaluate(() => window.Pucky.request({ command: "player.state", args: {} }));
  if (takeInteractionScreenshots) {
    scenario.screenshot_audio = await saveScreenshot(page, reportDir, "06-meeting-audio");
  }
  await backToDetail(page, "attachment", "html_iframe");
  await backToDetail(page, "transcript");
  await backToFeed(page);

  const bridgeCommandsForScenario = bridgeState.commands.slice(bridgeCommandStart);
  if (!bridgeCommandsForScenario.some((entry) => String(entry?.command || "") === "meeting.recording.resolve_audio_link")) {
    throw new Error(`${scenario.name} never resolved the meeting audio link through the platform bridge`);
  }
  return {
    name: scenario.name,
    meeting_id: scenario.meetingId,
    card_title: String(detailMeeting.title || ""),
    recording_title: String(detailMeeting.recording_title || ""),
    state: String(detailMeeting.state || ""),
    transcript_status: String(detailMeeting.transcript_status || ""),
    diarization_status: String(detailMeeting.diarization_status || ""),
    title_quality: String(detailMeeting.agent?.title_quality || ""),
    recording_title_quality: String(detailMeeting.agent?.recording_title_quality || ""),
    transcription_provider: String(detailMeeting.agent?.transcription_provider || ""),
    transcription_model: String(detailMeeting.agent?.transcription_model || ""),
    last_meeting_tool_name: String(detailMeeting.agent?.last_meeting_tool_name || ""),
    attachments: chipTexts,
    summary_text: String(summaryText || "").trim(),
    raw_summary_html: rawSummaryHtml,
    rendered_summary_html: renderedSummaryHtml,
    audio_source: String(audioSource || ""),
    player_state_before_audio: playerStateBeforeAudio,
    player_state_after_audio: playerStateAfterAudio,
    html_audio_transcript_detail_opened: String(transcriptFromHtmlText || "").trim(),
    telemetry: detailMeeting.feed_item?.telemetry || {},
    canonical_basename: String(detailMeeting.canonical_basename || ""),
    transcript_text: transcriptText,
    bridge_commands: bridgeCommandsForScenario
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const reportDir = path.join(repoRoot, ".tmp", "meeting-mode-agent-proof", options.mode);
  const videoDir = path.join(reportDir, "videos");
  const consoleLogPath = path.join(reportDir, "console.log");
  const serverLogPath = path.join(reportDir, "server.log");
  const summaryPath = path.join(reportDir, "summary.json");
  ensureDir(reportDir);
  ensureDir(videoDir);
  fs.writeFileSync(consoleLogPath, "", "utf8");
  fs.writeFileSync(serverLogPath, "", "utf8");

  const summary = {
    schema: "pucky.meeting_mode_agent_proof.v3",
    mode: options.mode,
    started_at: new Date().toISOString(),
    report_dir: reportDir,
    screenshots: {},
    scenarios: []
  };

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  summary.base_url = baseUrl;
  const child = startProofServer(port, reportDir, options.mode);
  attachServerLogging(child, serverLogPath);

  let browser;
  let context;
  let page;
  let pageVideo = null;
  const pathToMeetingId = new Map();
  const bridgeState = {
    commands: [],
    playerState: emptyPlayerState()
  };

  try {
    await waitForServerReady(baseUrl, child);
    const health = await apiJson(baseUrl, "/healthz", { headers: {} });
    summary.health = health;
    if (options.mode === "live" && String(health.deepgram_key || "") !== "present") {
      throw new Error("Live meeting proof requires deepgram_key: present from /healthz");
    }
    const chromePath = resolveChromePath();
    browser = await chromium.launch({
      headless: true,
      executablePath: chromePath,
      args: ["--disable-extensions", "--autoplay-policy=no-user-gesture-required"]
    });

    context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: {
        dir: videoDir,
        size: VIEWPORT
      }
    });

    const resolveMeetingAudioByPath = async (rawPath) => {
      const cleanPath = String(rawPath || "").trim();
      if (!cleanPath) {
        return null;
      }
      const knownMeetingId = pathToMeetingId.get(cleanPath);
      if (knownMeetingId) {
        return fetchMeetingDetail(baseUrl, knownMeetingId);
      }
      const meetings = await apiJson(baseUrl, "/api/meetings");
      const match = Array.isArray(meetings.meetings)
        ? meetings.meetings.find((item) => cleanPath === String(item?.device_path || "") || cleanPath === String(item?.audio_path || ""))
        : null;
      if (!match?.meeting_id) {
        return null;
      }
      pathToMeetingId.set(cleanPath, String(match.meeting_id));
      return fetchMeetingDetail(baseUrl, String(match.meeting_id));
    };

    await installCodexPuckyBridge(context, async (message) => {
      const command = String(message?.command || "");
      const args = message && typeof message.args === "object" && message.args ? message.args : {};
      bridgeState.commands.push({ command, args });
      if (command === "pucky.config.get") {
        return {
          schema: "pucky.config.v1",
          api_base_url: baseUrl,
          api_token: DEFAULT_API_TOKEN
        };
      }
      if (command === "ui.reply_cards.get") {
        return fetchFeedSnapshot(baseUrl);
      }
      if (command === "pucky.feed.sync") {
        return {
          schema: "pucky.feed_sync_result.v1",
          configured: true,
          reason: String(args.reason || "meeting_mode_agent_proof"),
          snapshot: await fetchFeedSnapshot(baseUrl)
        };
      }
      if (command === "pucky.feed.action") {
        return {
          schema: "pucky.feed_action_result.v1",
          ok: true,
          action: String(args.action || ""),
          snapshot: await fetchFeedSnapshot(baseUrl)
        };
      }
      if (command === "voice.thread_scope.get") {
        return {
          schema: "pucky.thread_scope.v1",
          mode: "new",
          thread_id: "",
          source: "",
          card_id: ""
        };
      }
      if (command === "meeting.recording.status") {
        return {
          schema: "pucky.meeting_recording_status.v1",
          state: "idle",
          active_meeting_id: null,
          meetings: []
        };
      }
      if (command === "player.state") {
        return bridgeState.playerState;
      }
      if (command === "player.load") {
        const loadedPath = String(args.path || args.device_path || args.artifact_path || "");
        bridgeState.playerState = emptyPlayerState({
          loaded: Boolean(loadedPath),
          state: loadedPath ? "paused" : "idle",
          title: String(args.title || ""),
          source: String(args.source || args.meeting_id || ""),
          path: loadedPath || null,
          filename: loadedPath ? path.basename(loadedPath) : null,
          can_seek: Boolean(loadedPath),
          duration_ms: loadedPath ? 2849 : 0
        });
        return bridgeState.playerState;
      }
      if (command === "player.play") {
        const loadedPath = String(args.path || args.device_path || bridgeState.playerState.path || "");
        bridgeState.playerState = {
          ...bridgeState.playerState,
          loaded: Boolean(loadedPath),
          state: loadedPath ? "playing" : bridgeState.playerState.state,
          is_playing: Boolean(loadedPath),
          path: loadedPath || bridgeState.playerState.path,
          filename: loadedPath ? path.basename(loadedPath) : bridgeState.playerState.filename
        };
        return bridgeState.playerState;
      }
      if (command === "pucky.turn.status") {
        return idleTurnStatus();
      }
      if (command === "artifact.read_base64") {
        const artifactId = artifactIdFromPath(args.path || "");
        if (artifactId) {
          return fetchArtifactBase64(baseUrl, artifactId);
        }
        const localPath = String(args.path || "").trim();
        if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
          const bytes = fs.readFileSync(localPath);
          return {
            schema: "pucky.artifact_read.v1",
            mime_type: mimeTypeFromPath(localPath),
            content_base64: bytes.toString("base64"),
            bytes: bytes.length
          };
        }
        const meeting = await resolveMeetingAudioByPath(args.path || "");
        if (!meeting?.meeting?.meeting_id) {
          throw new Error(`Unsupported artifact path: ${args.path || ""}`);
        }
        const response = await fetch(`${baseUrl}/api/meetings/${encodeURIComponent(String(meeting.meeting.meeting_id || ""))}/audio`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${DEFAULT_API_TOKEN}` }
        });
        const bytes = Buffer.from(await response.arrayBuffer());
        return {
          schema: "pucky.artifact_read.v1",
          mime_type: String(response.headers.get("content-type") || "audio/mp4").split(";", 1)[0].trim(),
          content_base64: bytes.toString("base64"),
          bytes: bytes.length
        };
      }
      if (command === "artifact.url") {
        const artifactId = artifactIdFromPath(args.path || "");
        if (artifactId) {
          return {
            schema: "pucky.artifact_url.v1",
            url: `${baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}`,
            path: String(args.path || ""),
            mime_type: "application/octet-stream",
            bytes: 0
          };
        }
        const localPath = String(args.path || "").trim();
        if (localPath && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
          const bytes = fs.readFileSync(localPath);
          const mimeType = mimeTypeFromPath(localPath);
          return {
            schema: "pucky.artifact_url.v1",
            url: `data:${mimeType};base64,${bytes.toString("base64")}`,
            path: localPath,
            mime_type: mimeType,
            bytes: bytes.length
          };
        }
        const meeting = await resolveMeetingAudioByPath(args.path || "");
        if (!meeting?.meeting?.meeting_id) {
          return {
            schema: "pucky.artifact_url.v1",
            url: String(args.path || ""),
            mime_type: "application/octet-stream",
            bytes: 0
          };
        }
        const response = await fetch(`${baseUrl}/api/meetings/${encodeURIComponent(String(meeting.meeting.meeting_id || ""))}/audio`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${DEFAULT_API_TOKEN}` }
        });
        const bytes = Buffer.from(await response.arrayBuffer());
        const mimeType = String(response.headers.get("content-type") || meeting.meeting.mime_type || "audio/mp4").split(";", 1)[0].trim();
        return {
          schema: "pucky.artifact_url.v1",
          url: `data:${mimeType};base64,${bytes.toString("base64")}`,
          path: String(args.path || ""),
          mime_type: mimeType,
          bytes: bytes.length
        };
      }
      if (command === "meeting.recording.resolve_audio_link") {
        const meetingId = String(args.meeting_id || "").trim();
        const detail = meetingId ? await fetchMeetingDetail(baseUrl, meetingId) : { meeting: {} };
        const meeting = detail.meeting || {};
        const response = meetingId
          ? await fetch(`${baseUrl}/api/meetings/${encodeURIComponent(meetingId)}/audio`, {
              cache: "no-store",
              headers: { Authorization: `Bearer ${DEFAULT_API_TOKEN}` }
            })
          : null;
        const bytes = response ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
        const mimeType = String(response?.headers.get("content-type") || meeting.mime_type || "audio/mp4").split(";", 1)[0].trim();
        return {
          schema: "pucky.meeting_audio_link.v1",
          meeting_id: meetingId,
          device_path: String(meeting.device_path || meeting.audio_path || ""),
          canonical_basename: String(meeting.canonical_basename || ""),
          recording_title: String(meeting.recording_title || ""),
          url: bytes.length ? `data:${mimeType};base64,${bytes.toString("base64")}` : "",
          mime_type: mimeType,
          source: "native_attachment_proof"
        };
      }
      throw new Error(`Unsupported bridge command: ${command}`);
    });

    page = await context.newPage();
    pageVideo = page.video();
    attachPageLogging(page, consoleLogPath);
    await page.goto(`${baseUrl}/ui/pucky/latest/`, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("#feed", { timeout: 10000 });
    summary.screenshots.home_initial = await saveScreenshot(page, reportDir, "00-home-initial");

    const scenarios = options.mode === "live" ? liveScenarios(reportDir) : deterministicScenarios();
    for (let index = 0; index < scenarios.length; index += 1) {
      const scenario = scenarios[index];
      const record = await runScenario({
        page,
        baseUrl,
        reportDir,
        scenario,
        pathToMeetingId,
        bridgeState,
        takePendingScreenshot: index === 0,
        takeInteractionScreenshots: index === 0
      });
      summary.scenarios.push(record);
    }

    summary.ok = true;
  } catch (error) {
    summary.ok = false;
    summary.error = error.message || String(error);
    writeAutomationError(reportDir, error);
    throw error;
  } finally {
    writeJsonFile(summaryPath, summary);
    let videoPath = "";
    try {
      if (context) {
        await context.close();
      }
      if (pageVideo) {
        videoPath = await pageVideo.path();
      }
    } catch (_) {
      // Best effort during teardown.
    }
    try {
      if (browser) {
        await browser.close();
      }
    } catch (_) {
      // Best effort during teardown.
    }
    terminateServer(child);
    if (videoPath && fs.existsSync(summaryPath)) {
      const current = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      current.video_path = videoPath;
      current.bridge_commands = bridgeState.commands;
      writeJsonFile(summaryPath, current);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    mode: options.mode,
    summary_path: summaryPath,
    console_log_path: consoleLogPath,
    server_log_path: serverLogPath
  }));
  process.exit(0);
}

run().catch((error) => {
  const options = (() => {
    try {
      return parseArgs(process.argv.slice(2));
    } catch (_) {
      return { mode: "deterministic" };
    }
  })();
  const reportDir = path.join(repoRoot, ".tmp", "meeting-mode-agent-proof", options.mode);
  ensureDir(reportDir);
  writeAutomationError(reportDir, error);
  try {
    writeJsonFile(path.join(reportDir, "summary.json"), {
      schema: "pucky.meeting_mode_agent_proof.v3",
      mode: options.mode,
      status: "failed",
      report_dir: reportDir,
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error)
      }
    });
  } catch (_) {
    // Ignore follow-on summary failures.
  }
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

