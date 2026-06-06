import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
} from "./cover_shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const DEFAULT_BASE_URL = "https://pucky.fly.dev";
const VIEWPORT = { width: 430, height: 932 };
const DEFAULT_REPORT_ROOT = path.join(repoRoot, ".tmp", "meeting-mode-real-vm-proof");

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    headless: true,
    reportDir: "",
    scenarioNames: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (token === "--base-url" && argv[index + 1]) {
      options.baseUrl = String(argv[index + 1] || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
      index += 1;
      continue;
    }
    if (token === "--report-dir" && argv[index + 1]) {
      options.reportDir = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }
    if (token === "--scenario" && argv[index + 1]) {
      options.scenarioNames.push(String(argv[index + 1] || "").trim());
      index += 1;
      continue;
    }
    if (token === "--headed") {
      options.headless = false;
      continue;
    }
  }
  return options;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeTextFile(targetPath, text) {
  fs.writeFileSync(targetPath, String(text || ""), "utf8");
}

function runProcess(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} ${args.join(" ")} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return String(result.stdout || "").trim();
}

function runProcessResult(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50
  });
}

function gitOutput(args) {
  return runProcess("git", args, { cwd: repoRoot });
}

function repoState() {
  const branchStatus = gitOutput(["status", "--short", "--branch"]);
  const head = gitOutput(["rev-parse", "HEAD"]);
  const upstream = gitOutput(["rev-parse", "@{u}"]);
  return {
    branch_status: branchStatus,
    head,
    upstream,
    clean: !branchStatus.split(/\r?\n/).slice(1).some((line) => String(line || "").trim())
  };
}

function ensureCanonicalMasterClean() {
  const status = repoState();
  if (!String(status.branch_status || "").startsWith("## master...origin/master")) {
    throw new Error(`Canonical repo must be on master tracking origin/master. Saw: ${status.branch_status}`);
  }
  if (!status.clean) {
    throw new Error(`Canonical repo must be clean before real VM proof. Saw:\n${status.branch_status}`);
  }
  if (status.head !== status.upstream) {
    throw new Error(`Canonical repo HEAD ${status.head} does not match upstream ${status.upstream}`);
  }
  return status;
}

function resolveFlyctl() {
  const candidates = [
    "C:\\Users\\jimmy\\.fly\\bin\\flyctl.exe",
    "flyctl"
  ];
  for (const candidate of candidates) {
    try {
      const output = runProcess(candidate, ["version"], { cwd: repoRoot });
      if (output) {
        return candidate;
      }
    } catch (_) {
      // Try next candidate.
    }
  }
  throw new Error("Could not find flyctl for live VM token discovery");
}

function loadFlyEnvironment() {
  const flyctl = resolveFlyctl();
  const processResult = runProcessResult(flyctl, ["ssh", "console", "-a", "pucky", "--command", "env"], { cwd: repoRoot });
  const envText = String(processResult.stdout || "").trim();
  if (!envText) {
    throw new Error(String(processResult.stderr || processResult.stdout || "Could not read live Fly environment"));
  }
  const result = {};
  for (const line of envText.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1);
    result[key] = value;
  }
  return result;
}

function resolveApiToken() {
  const direct = String(process.env.PUCKY_API_TOKEN || "").trim();
  if (direct) {
    return direct;
  }
  const flyEnv = loadFlyEnvironment();
  const token = String(flyEnv.PUCKY_API_TOKEN || "").trim();
  if (!token) {
    throw new Error("Could not resolve PUCKY_API_TOKEN from environment or live Fly app");
  }
  return token;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload.detail || payload.error || `HTTP ${response.status}`));
  }
  return payload;
}

async function apiJson(baseUrl, apiToken, pathName, options = {}) {
  const headers = {
    Authorization: `Bearer ${apiToken}`,
    ...(options.headers || {})
  };
  return fetchJson(`${baseUrl}${pathName}`, {
    method: options.method || "GET",
    headers,
    body: options.body
  });
}

async function fetchManifest(baseUrl) {
  return fetchJson(`${baseUrl}/ui/pucky/latest/manifest.json`);
}

async function fetchHealth(baseUrl) {
  return fetchJson(`${baseUrl}/healthz`);
}

async function fetchFeedSnapshot(baseUrl, apiToken) {
  const payload = await apiJson(baseUrl, apiToken, "/api/feed?limit=200");
  return {
    schema: "pucky.reply_cards.v1",
    count: Array.isArray(payload.items) ? payload.items.length : 0,
    cards: Array.isArray(payload.items) ? payload.items : []
  };
}

async function browserFeedSnapshot(page) {
  return page.evaluate(() => {
    if (window.PuckyUiDebug && typeof window.PuckyUiDebug.describe === "function") {
      return window.PuckyUiDebug.describe();
    }
    const cards = Array.from(document.querySelectorAll("article[data-card-id]")).map((node) => ({
      kind: node.getAttribute("data-card-kind") || "",
      card_id: node.getAttribute("data-card-id") || "",
      session_id: node.getAttribute("data-card-session-id") || "",
      thread_id: node.getAttribute("data-card-thread-id") || "",
      preview: (node.querySelector(".preview, .card-outbound-preview, .title")?.textContent || "").trim()
    }));
    return {
      schema: "pucky.ui_surface.v1",
      route: document.querySelector(".app-shell")?.getAttribute("data-view") || "",
      detail: {
        open: false,
        type: "",
        card_id: "",
        session_id: "",
        thread_id: "",
        viewer: ""
      },
      visible_cards: cards
    };
  });
}

async function fetchMeetingDetail(baseUrl, apiToken, meetingId) {
  return apiJson(baseUrl, apiToken, `/api/meetings/${encodeURIComponent(meetingId)}`);
}

async function fetchArtifactBase64(baseUrl, apiToken, artifactId) {
  const response = await fetch(`${baseUrl}/api/artifacts/${encodeURIComponent(artifactId)}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiToken}` }
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

async function postMeeting(baseUrl, apiToken, payload) {
  return apiJson(baseUrl, apiToken, "/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function waitForMeetingState(baseUrl, apiToken, meetingId, expectedState, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload = {};
  while (Date.now() < deadline) {
    lastPayload = await fetchMeetingDetail(baseUrl, apiToken, meetingId);
    const meeting = lastPayload.meeting || {};
    const state = String(meeting.state || "");
    if (state === expectedState) {
      return meeting;
    }
    if (state === "failed") {
      throw new Error(`Meeting ${meetingId} failed during wait for ${expectedState}: ${meeting.failure_stage || "unknown_stage"}: ${meeting.failure_reason || "unknown reason"}`);
    }
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${meetingId} to reach ${expectedState}; last payload: ${JSON.stringify(lastPayload).slice(0, 2000)}`);
}

async function waitForMeetingProcessing(baseUrl, apiToken, meetingId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await fetchMeetingDetail(baseUrl, apiToken, meetingId);
    const meeting = payload.meeting || {};
    const state = String(meeting.state || "");
    if (state === "processing" || state === "completed") {
      return meeting;
    }
    if (state === "failed") {
      throw new Error(`Meeting ${meetingId} failed before processing: ${meeting.failure_stage || "unknown_stage"}: ${meeting.failure_reason || "unknown reason"}`);
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${meetingId} to enter processing`);
}

async function triggerFeedRefresh(page) {
  await page.evaluate(() => window.PuckyUiDebug.dispatch("refresh_cards"));
  await delay(500);
}

async function waitForCardText(page, meetingId, text, timeoutMs = 60000) {
  const selector = `[data-card-session-id="${meetingId}"]`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await triggerFeedRefresh(page);
    const content = await page.locator(selector).textContent().catch(() => "");
    if (String(content || "").includes(text)) {
      return;
    }
    await delay(500);
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

async function playAttachmentAudioAndWaitForAdvance(page, timeoutMs = 15000) {
  const locator = page.locator("#detail audio.attachment-audio-player").last();
  const before = await locator.evaluate((node) => ({
    currentTime: Number(node.currentTime || 0),
    duration: Number(node.duration || 0),
    paused: Boolean(node.paused),
    readyState: Number(node.readyState || 0)
  }));
  const playResult = await locator.evaluate(async (node) => {
    try {
      node.muted = true;
      await node.play();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  });
  if (!playResult?.ok) {
    throw new Error(`Audio playback could not start: ${playResult?.error || "unknown error"}`);
  }
  await page.waitForFunction(() => {
    const players = Array.from(document.querySelectorAll("#detail audio.attachment-audio-player"));
    const audio = players.length ? players[players.length - 1] : null;
    return Boolean(audio && !audio.paused && Number(audio.currentTime || 0) > 0.25);
  }, {}, { timeout: timeoutMs });
  const after = await locator.evaluate((node) => ({
    currentTime: Number(node.currentTime || 0),
    duration: Number(node.duration || 0),
    paused: Boolean(node.paused),
    readyState: Number(node.readyState || 0)
  }));
  if (!(after.currentTime > before.currentTime)) {
    throw new Error(`Audio playback time did not advance (before=${before.currentTime}, after=${after.currentTime})`);
  }
  return { before, after };
}

async function waitForAudioViewerResolution(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const detail = document.getElementById("detail");
      const players = Array.from(document.querySelectorAll("#detail audio.attachment-audio-player"));
      const audio = players.length ? players[players.length - 1] : null;
      const error = detail?.querySelector(".attachment-error");
      return {
        detail_html: String(detail?.innerHTML || ""),
        audio_outer_html: String(audio?.outerHTML || ""),
        src: String(audio?.getAttribute("src") || ""),
        current_src: String(audio?.currentSrc || ""),
        error_text: String(error?.textContent || "").trim()
      };
    });
    if (state.error_text || state.src || state.current_src) {
      return state;
    }
    await delay(200);
  }
  return await page.evaluate(() => {
    const detail = document.getElementById("detail");
    const players = Array.from(document.querySelectorAll("#detail audio.attachment-audio-player"));
    const audio = players.length ? players[players.length - 1] : null;
    const error = detail?.querySelector(".attachment-error");
    return {
      detail_html: String(detail?.innerHTML || ""),
      audio_outer_html: String(audio?.outerHTML || ""),
      src: String(audio?.getAttribute("src") || ""),
      current_src: String(audio?.currentSrc || ""),
      error_text: String(error?.textContent || "").trim()
    };
  });
}

function createSilenceWavBuffer(durationMs = 450, sampleRate = 16000) {
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

function resolveFfmpegPath() {
  const output = runProcess("where.exe", ["ffmpeg"], { cwd: repoRoot });
  const candidate = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!candidate) {
    throw new Error("ffmpeg not found on PATH");
  }
  return candidate;
}

function runEdgeTts({ voice, text, targetPath }) {
  runProcess("python", ["-m", "edge_tts", "--voice", voice, "--text", text, "--write-media", targetPath], { cwd: repoRoot });
}

function transcodeToWav(ffmpegPath, inputPath, outputPath) {
  runProcess(ffmpegPath, ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", outputPath], { cwd: repoRoot });
}

function concatWavFiles(ffmpegPath, orderedPaths, outputPath, workDir) {
  const concatPath = path.join(workDir, "concat.txt");
  const body = orderedPaths.map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`).join("\n");
  writeTextFile(concatPath, body);
  runProcess(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-acodec", "pcm_s16le", outputPath], { cwd: workDir });
}

function buildScenarioTimestamp(offsetMinutes = 0) {
  const value = new Date(Date.now() + offsetMinutes * 60_000);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  const second = String(value.getUTCSeconds()).padStart(2, "0");
  return {
    meetingDate: `${year}${month}${day}`,
    isoStart: `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
    datePart: `${year}${month}${day}-${hour}${minute}${second}`
  };
}

function normalizeStem(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeProofText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueMeetingId(label, offsetMinutes = 0) {
  const stamp = buildScenarioTimestamp(offsetMinutes);
  return {
    meetingId: `meeting-${stamp.datePart}-codex-realvm-${label}`,
    startedAt: stamp.isoStart
  };
}

function wavDurationMs(audioPath) {
  const buffer = fs.readFileSync(audioPath);
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Expected a PCM WAV fixture at ${audioPath}`);
  }
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const dataSize = buffer.readUInt32LE(40);
  const bytesPerSecond = Math.max(1, sampleRate * channels * Math.max(1, bitsPerSample / 8));
  return Math.max(1000, Math.round((dataSize / bytesPerSecond) * 1000));
}

function livePayload({ meetingId, startedAt, audioPath }) {
  const durationMs = wavDurationMs(audioPath);
  return {
    meeting_id: meetingId,
    started_at: startedAt,
    stopped_at: new Date(Date.parse(startedAt) + durationMs).toISOString().replace(".000Z", "Z"),
    duration_ms: durationMs,
    device_id: "codex-realvm-browser-proof",
    device_path: `/data/user/0/com.pucky.device.debug/files/voice/${meetingId}.wav`,
    mime_type: "audio/wav",
    audio_base64: fs.readFileSync(audioPath).toString("base64")
  };
}

function ensureGeneratedFixtures(reportDir) {
  const ffmpegPath = resolveFfmpegPath();
  const fixtureDir = path.join(reportDir, "generated-fixtures");
  const segmentDir = path.join(fixtureDir, "segments");
  ensureDir(fixtureDir);
  ensureDir(segmentDir);

  const silencePath = path.join(segmentDir, "silence-1600ms.wav");
  if (!fs.existsSync(silencePath)) {
    fs.writeFileSync(silencePath, createSilenceWavBuffer(1600));
  }

  const namedTrioOut = path.join(fixtureDir, "named-trio-60s-generated.wav");
  const anonymousTrioOut = path.join(fixtureDir, "anonymous-trio-60s-generated.wav");

  const buildFixture = (name, segments) => {
    const wavParts = [];
    for (let index = 0; index < segments.length; index += 1) {
      const item = segments[index];
      const mp3Path = path.join(segmentDir, `${name}-${String(index + 1).padStart(2, "0")}.mp3`);
      const wavPath = path.join(segmentDir, `${name}-${String(index + 1).padStart(2, "0")}.wav`);
      if (!fs.existsSync(mp3Path)) {
        runEdgeTts({ voice: item.voice, text: item.text, targetPath: mp3Path });
      }
      if (!fs.existsSync(wavPath)) {
        transcodeToWav(ffmpegPath, mp3Path, wavPath);
      }
      wavParts.push(wavPath);
      if (index !== segments.length - 1) {
        wavParts.push(silencePath);
      }
    }
    return wavParts;
  };

  if (!fs.existsSync(namedTrioOut)) {
    const namedParts = buildFixture("named-trio-60s", [
      { voice: "en-US-GuyNeural", text: "Hi Jack and Maya, I'm Jimmy. Thanks for joining the launch readiness meeting for the partner rollout this morning." },
      { voice: "en-US-ChristopherNeural", text: "I'm Jack. I reviewed the partner checklist today, and the biggest open item is the intro email for the reseller group." },
      { voice: "en-US-AriaNeural", text: "I'm Maya. I updated the budget workbook last night, and I still need the final finance headcount before I lock the totals." },
      { voice: "en-US-GuyNeural", text: "This is Jimmy again. I will send the launch deck to leadership by Tuesday June ninth, and I will include the reseller email draft in that packet." },
      { voice: "en-US-ChristopherNeural", text: "Jack here again. I will schedule the partner check in for Thursday June eleventh, and I will add the reseller questions to the agenda before lunch." },
      { voice: "en-US-AriaNeural", text: "Maya speaking again. I will send the revised budget table by Wednesday June tenth, right after finance confirms the headcount this afternoon." },
      { voice: "en-US-GuyNeural", text: "We also need the frequently asked questions cleaned up. Jack, please own the first draft, and Maya, please review the pricing section after that draft is ready." },
      { voice: "en-US-ChristopherNeural", text: "Understood. I'm Jack, and I will circulate the frequently asked questions draft by Monday June eighth so Maya has time to review it before the Thursday call." },
      { voice: "en-US-AriaNeural", text: "That works for me. I'm Maya, and I will review the pricing section by Tuesday June ninth and send comments back on the same day." },
      { voice: "en-US-GuyNeural", text: "Perfect. Jimmy owns the launch deck, Jack owns the partner meeting and the questions draft, and Maya owns the budget table plus the pricing review." }
    ]);
    concatWavFiles(ffmpegPath, namedParts, namedTrioOut, fixtureDir);
  }

  if (!fs.existsSync(anonymousTrioOut)) {
    const anonymousParts = buildFixture("anonymous-trio-60s", [
      { voice: "en-US-GuyNeural", text: "Thanks for joining the launch readiness meeting for the partner rollout. The first issue is the reseller introduction email and the open deck notes." },
      { voice: "en-US-ChristopherNeural", text: "I reviewed the partner checklist today, and I can own the reseller agenda. I will schedule the partner check in for Thursday June eleventh." },
      { voice: "en-US-AriaNeural", text: "I updated the budget workbook last night, and I still need the finance headcount. I will send the revised budget table by Wednesday June tenth." },
      { voice: "en-US-GuyNeural", text: "I will send the launch deck to leadership by Tuesday June ninth, and I will include the reseller introduction draft in that packet." },
      { voice: "en-US-ChristopherNeural", text: "I can also draft the frequently asked questions page. I will circulate that draft by Monday June eighth so the pricing section can be reviewed in time." },
      { voice: "en-US-AriaNeural", text: "I will review the pricing section by Tuesday June ninth, and I will reply with edits the same day after the frequently asked questions draft arrives." },
      { voice: "en-US-GuyNeural", text: "The biggest risk is missing the partner rollout window, so the deck, the questions page, and the budget numbers all need to land on their due dates." },
      { voice: "en-US-ChristopherNeural", text: "Understood. The partner check in stays on Thursday June eleventh, and the agenda will cover reseller concerns, pricing, and the final launch timeline." },
      { voice: "en-US-AriaNeural", text: "The budget update will call out the headcount change, the revised travel estimate, and the pricing impact once finance confirms the numbers." },
      { voice: "en-US-GuyNeural", text: "Great. The launch deck is due Tuesday June ninth, the budget table is due Wednesday June tenth, and the partner meeting happens Thursday June eleventh." }
    ]);
    concatWavFiles(ffmpegPath, anonymousParts, anonymousTrioOut, fixtureDir);
  }

  return { namedTrioOut, anonymousTrioOut };
}

function buildScenarios(reportDir, namesFilter = []) {
  const fixtures = ensureGeneratedFixtures(reportDir);
  const namedTrio = uniqueMeetingId("named-trio-60s", 0);
  const anonymousTrio = uniqueMeetingId("anonymous-trio-60s", 1);
  const scenarios = [
    {
      name: "named_trio_60s",
      meetingId: namedTrio.meetingId,
      payload: livePayload({
        meetingId: namedTrio.meetingId,
        startedAt: namedTrio.startedAt,
        audioPath: fixtures.namedTrioOut
      }),
      expectedNames: ["Jimmy", "Jack", "Maya"],
      forbiddenNeutralLabels: ["speaker_0", "speaker_1", "speaker_2"],
      expectedSummarySnippets: [
        "Jimmy",
        "Jack",
        "Maya",
        "launch deck",
        "budget",
        "June 9",
        "June 10",
        "June 11"
      ],
      expectedDueDateSnippets: ["June 9", "June 10", "June 11"]
    },
    {
      name: "anonymous_trio_60s",
      meetingId: anonymousTrio.meetingId,
      payload: livePayload({
        meetingId: anonymousTrio.meetingId,
        startedAt: anonymousTrio.startedAt,
        audioPath: fixtures.anonymousTrioOut
      }),
      forbiddenNames: ["Jimmy", "Jack", "Maya"],
      expectedNeutralSpeakerCount: 3,
      expectedSummarySnippets: [
        "launch",
        "budget",
        "partner",
        "June 9",
        "June 10",
        "June 11"
      ]
    }
  ];
  if (!namesFilter.length) {
    return scenarios;
  }
  return scenarios.filter((item) => namesFilter.includes(item.name));
}

function summarizeAttachments(meeting) {
  const messages = Array.isArray(meeting?.feed_item?.transcript_messages) ? meeting.feed_item.transcript_messages : [];
  const assistant = messages.find((item) => String(item?.role || "").toLowerCase() === "assistant") || {};
  return Array.isArray(assistant.attachments) ? assistant.attachments : [];
}

function assertHumanLikeTitle(label, title, meetingId) {
  const clean = String(title || "").trim();
  if (!clean) {
    throw new Error(`${label} title is empty`);
  }
  if (clean === String(meetingId || "").trim()) {
    throw new Error(`${label} title fell back to raw meeting_id`);
  }
  if (/^meeting-\d{8,}/i.test(clean)) {
    throw new Error(`${label} title still looks machine-generated: ${clean}`);
  }
}

function distinctNeutralSpeakers(transcriptText) {
  return [...new Set((String(transcriptText || "").match(/speaker_\d+/gi) || []).map((value) => value.toLowerCase()))];
}

async function runScenario({
  page,
  baseUrl,
  apiToken,
  reportDir,
  scenario,
  pathToMeetingId,
  bridgeState
}) {
  const scenarioDir = path.join(reportDir, scenario.name);
  ensureDir(scenarioDir);
  const bridgeStart = bridgeState.commands.length;
  const warnings = [];

  const feedBeforeApi = await fetchFeedSnapshot(baseUrl, apiToken);
  const feedBeforeBrowser = await browserFeedSnapshot(page);
  writeJsonFile(path.join(scenarioDir, "feed_before.json"), {
    api: feedBeforeApi,
    browser: feedBeforeBrowser
  });

  const postResponse = await postMeeting(baseUrl, apiToken, scenario.payload);
  writeJsonFile(path.join(scenarioDir, "meeting_post_response.json"), postResponse);

  await waitForMeetingProcessing(baseUrl, apiToken, scenario.meetingId);
  const processingPayload = await fetchMeetingDetail(baseUrl, apiToken, scenario.meetingId);
  writeJsonFile(path.join(scenarioDir, "meeting_processing.json"), processingPayload);

  await waitForCardText(page, scenario.meetingId, "Processing");
  const pendingScreenshot = await saveScreenshot(page, scenarioDir, "01-pending-tile");

  const completedMeeting = await waitForMeetingState(baseUrl, apiToken, scenario.meetingId, "completed");
  const completedPayload = await fetchMeetingDetail(baseUrl, apiToken, scenario.meetingId);
  writeJsonFile(path.join(scenarioDir, "meeting_completed.json"), completedPayload);

  await triggerFeedRefresh(page);
  const feedAfterBrowser = await browserFeedSnapshot(page);
  const feedAfterApi = await fetchFeedSnapshot(baseUrl, apiToken);
  writeJsonFile(path.join(scenarioDir, "feed_after.json"), {
    api: feedAfterApi,
    browser: feedAfterBrowser
  });

  const feedCard = Array.isArray(feedAfterBrowser?.visible_cards)
    ? feedAfterBrowser.visible_cards.find((item) => String(item?.session_id || "") === scenario.meetingId)
    : null;
  if (!feedCard) {
    throw new Error(`Could not find completed feed card for ${scenario.meetingId}`);
  }
  if (!String(feedCard.preview || "").trim()) {
    throw new Error(`${scenario.name} feed tile reply text is empty`);
  }
  const completedScreenshot = await saveScreenshot(page, scenarioDir, "02-completed-tile");
  const tileMarkup = await page.locator(`[data-card-session-id="${scenario.meetingId}"]`).first().innerHTML();
  if (!/svg|material-symbols|card-icon/i.test(String(tileMarkup || ""))) {
    throw new Error(`${scenario.name} feed tile did not render an icon`);
  }

  const detailMeeting = completedPayload.meeting || {};
  for (const value of [detailMeeting.device_path, detailMeeting.audio_path]) {
    const cleanPath = String(value || "").trim();
    if (cleanPath) {
      pathToMeetingId.set(cleanPath, scenario.meetingId);
    }
  }

  if (String(detailMeeting.state || "") !== "completed") {
    throw new Error(`${scenario.name} did not reach completed state`);
  }
  if (String(detailMeeting.agent?.transcription_provider || "") !== "deepgram") {
    warnings.push("transcription_provider_missing_or_not_deepgram");
  }
  if (!String(detailMeeting.agent?.transcription_model || "").trim()) {
    warnings.push("transcription_model_missing");
  }
  if (String(detailMeeting.agent?.last_meeting_tool_name || detailMeeting.feed_item?.telemetry?.last_meeting_tool_name || "") !== "meeting_deepgram_transcribe") {
    warnings.push("last_meeting_tool_name_missing");
  }
  if (!detailMeeting.feed_item?.telemetry?.meeting_recording_title) {
    throw new Error(`${scenario.name} did not preserve recording_title in telemetry`);
  }
  assertHumanLikeTitle("Feed card", detailMeeting.title, scenario.meetingId);
  assertHumanLikeTitle("Recording", detailMeeting.recording_title, scenario.meetingId);
  const recordingStem = normalizeStem(detailMeeting.recording_title);
  if (!String(detailMeeting.canonical_basename || "").startsWith(recordingStem)) {
    throw new Error(`${scenario.name} canonical_basename does not derive from recording_title`);
  }
  if (!detailMeeting.feed_item?.telemetry?.meeting_recording_title || String(detailMeeting.feed_item.telemetry.meeting_recording_title || "") !== String(detailMeeting.recording_title || "")) {
    throw new Error(`${scenario.name} feed telemetry recording title mismatch`);
  }

  const attachments = summarizeAttachments(detailMeeting);
  const summaryAttachment = attachments.find((item) => String(item?.id || "") === `${scenario.meetingId}:html`);
  const transcriptHtmlAttachment = attachments.find((item) => String(item?.title || "") === "Meeting Transcript HTML");
  if (!summaryAttachment) {
    throw new Error(`${scenario.name} is missing the HTML summary attachment`);
  }
  if (!transcriptHtmlAttachment) {
    throw new Error(`${scenario.name} is missing the Meeting Transcript HTML attachment`);
  }
  for (const requiredLabel of ["Meeting Transcript", "Meeting Transcript HTML", "Meeting Audio"]) {
    if (!attachments.some((item) => String(item?.title || "") === requiredLabel)) {
      throw new Error(`${scenario.name} is missing attachment ${requiredLabel}`);
    }
  }

  const transcriptText = String(detailMeeting.transcript_text || "");
  if (!transcriptText.trim()) {
    throw new Error(`${scenario.name} transcript_text is empty`);
  }

  if (scenario.expectedNames) {
    for (const name of scenario.expectedNames) {
      if (!transcriptText.includes(name)) {
        throw new Error(`${scenario.name} transcript is missing named speaker ${name}`);
      }
    }
    for (const label of scenario.forbiddenNeutralLabels || []) {
      if (transcriptText.includes(label)) {
        throw new Error(`${scenario.name} transcript kept neutral label ${label} despite clear names`);
      }
    }
  }
  if (scenario.forbiddenNames) {
    for (const name of scenario.forbiddenNames) {
      if (transcriptText.includes(name)) {
        throw new Error(`${scenario.name} transcript invented or preserved forbidden name ${name}`);
      }
    }
    const neutralSpeakers = distinctNeutralSpeakers(transcriptText);
    if (neutralSpeakers.length !== Number(scenario.expectedNeutralSpeakerCount || 0)) {
      throw new Error(`${scenario.name} transcript did not preserve exactly ${scenario.expectedNeutralSpeakerCount} neutral speakers`);
    }
  }

  await page.locator(`[data-card-session-id="${scenario.meetingId}"]`).first().click();
  await waitForDetail(page, "transcript");
  const transcriptDetailScreenshot = await saveScreenshot(page, scenarioDir, "03-transcript-detail");

  const chipTexts = [...new Set(await page.locator("#detail .bubble-attachment-chip span").allTextContents())];
  for (const requiredLabel of ["Meeting Transcript", "Meeting Transcript HTML", String(summaryAttachment.title || ""), "Meeting Audio"]) {
    if (!chipTexts.includes(requiredLabel)) {
      throw new Error(`${scenario.name} transcript detail is missing attachment chip ${requiredLabel}`);
    }
  }

  await page.locator("#detail .bubble-attachment-chip", { hasText: String(summaryAttachment.title || "") }).last().click();
  await waitForDetail(page, "attachment", "html_iframe");
  await page.waitForSelector("#detail iframe.document-frame", { timeout: 15000 });

  const summaryText = await page.locator("#detail iframe.document-frame").last().evaluate((node) => {
    const frame = node instanceof HTMLIFrameElement ? node : null;
    return String(frame?.contentDocument?.body?.textContent || frame?.srcdoc || "");
  });
  const summaryScreenshot = await saveScreenshot(page, scenarioDir, "04-summary-html");

  const renderedSummaryHtml = await page.locator("#detail iframe.document-frame").last().evaluate((node) => {
    const frame = node instanceof HTMLIFrameElement ? node : null;
    return String(frame?.contentDocument?.body?.innerHTML || frame?.srcdoc || "");
  });
  writeTextFile(path.join(scenarioDir, "rendered_summary_html.html"), renderedSummaryHtml);
  const summaryFrame = page.frameLocator("#detail iframe.document-frame");

  if (!summaryAttachment?.artifact) {
    throw new Error(`${scenario.name} is missing Meeting Summary artifact metadata`);
  }
  const rawSummaryHtml = Buffer.from(String((await fetchArtifactBase64(baseUrl, apiToken, String(summaryAttachment.artifact || ""))).content_base64 || ""), "base64").toString("utf8");
  writeTextFile(path.join(scenarioDir, "raw_summary_html.html"), rawSummaryHtml);
  const rawTranscriptHtml = Buffer.from(String((await fetchArtifactBase64(baseUrl, apiToken, String(transcriptHtmlAttachment.artifact || ""))).content_base64 || ""), "base64").toString("utf8");
  writeTextFile(path.join(scenarioDir, "raw_transcript_html.html"), rawTranscriptHtml);

  if (!rawSummaryHtml.includes("{{PUCKY_MEETING_TRANSCRIPT_LINK}}") || !rawSummaryHtml.includes("{{PUCKY_MEETING_AUDIO_LINK}}")) {
    throw new Error(`${scenario.name} raw summary HTML is missing the required placeholders`);
  }
  if (rawSummaryHtml.includes("/api/meetings/") || rawSummaryHtml.includes("/tmp/") || rawSummaryHtml.includes("<script")) {
    throw new Error(`${scenario.name} raw summary HTML still contains runtime links or inline script`);
  }
  if (!renderedSummaryHtml.includes("pucky-meeting-transcript-link") || !renderedSummaryHtml.includes("pucky-meeting-audio-link")) {
    throw new Error(`${scenario.name} rendered summary did not expose transcript/audio controls`);
  }
  if (renderedSummaryHtml.includes("/api/meetings/") || renderedSummaryHtml.includes("/tmp/") || renderedSummaryHtml.includes("<script")) {
    throw new Error(`${scenario.name} rendered summary still exposes raw runtime links or inline script`);
  }
  const summarySections = ["Overview", "Participants", "Action Items"];
  for (const sectionLabel of summarySections) {
    if (!summaryText.includes(sectionLabel)) {
      throw new Error(`${scenario.name} summary HTML is missing section ${sectionLabel}`);
    }
  }
  const summaryVisibleLinks = await summaryFrame.locator("a.document-open-link").allTextContents();
  if (summaryVisibleLinks.length !== 2) {
    throw new Error(`${scenario.name} summary HTML did not render exactly two visible document links`);
  }
  if (!summaryVisibleLinks.includes("Open Transcript") || !summaryVisibleLinks.includes("Listen To Audio")) {
    throw new Error(`${scenario.name} summary HTML did not render the expected transcript/audio link labels`);
  }

  if (scenario.expectedSummarySnippets) {
    const normalizedSummaryText = normalizeProofText(summaryText);
    for (const snippet of scenario.expectedSummarySnippets) {
      if (!normalizedSummaryText.includes(normalizeProofText(snippet))) {
        throw new Error(`${scenario.name} summary text is missing expected content: ${snippet}`);
      }
    }
  }
  if (scenario.expectedDueDateSnippets) {
    const normalizedSummaryText = normalizeProofText(summaryText);
    for (const dueDate of scenario.expectedDueDateSnippets) {
      if (!normalizedSummaryText.includes(normalizeProofText(dueDate))) {
        throw new Error(`${scenario.name} summary text is missing explicit due date ${dueDate}`);
      }
    }
  }
  if (scenario.forbiddenNames) {
    for (const name of scenario.forbiddenNames) {
      if (summaryText.includes(name)) {
        throw new Error(`${scenario.name} summary text invented forbidden name ${name}`);
      }
    }
  }

  await summaryFrame.locator("a.pucky-meeting-transcript-link").click();
  await waitForDetail(page, "attachment", "html_iframe");
  await page.waitForSelector("#detail iframe.document-frame", { timeout: 15000 });
  const transcriptFromHtmlText = await page.locator("#detail iframe.document-frame").last().evaluate((node) => {
    const frame = node instanceof HTMLIFrameElement ? node : null;
    return String(frame?.contentDocument?.body?.textContent || frame?.srcdoc || "");
  });
  if (!String(transcriptFromHtmlText || "").trim() || /transcript unavailable|html preview unavailable/i.test(String(transcriptFromHtmlText || ""))) {
    throw new Error(`${scenario.name} transcript link inside summary did not open transcript HTML detail`);
  }
  const transcriptFromHtmlScreenshot = await saveScreenshot(page, scenarioDir, "05-transcript-from-html");
  await backToDetail(page, "attachment", "html_iframe");

  const playerStateBeforeAudio = await page.evaluate(() => window.Pucky.request({ command: "player.state", args: {} }));
  await page.frameLocator("#detail iframe.document-frame").locator("a.pucky-meeting-audio-link").click();
  await waitForDetail(page, "attachment", "audio_player");
  const audioResolution = await waitForAudioViewerResolution(page);
  const audioFromHtmlScreenshot = await saveScreenshot(page, scenarioDir, "06-audio-from-html");
  writeJsonFile(path.join(scenarioDir, "audio_viewer_resolution.json"), audioResolution);
  if (audioResolution.error_text) {
    throw new Error(`${scenario.name} audio viewer reported an error: ${audioResolution.error_text}`);
  }
  const audioSource = String(audioResolution.src || audioResolution.current_src || "");
  if (!audioSource) {
    throw new Error(`${scenario.name} audio viewer did not resolve an audio source`);
  }
  if (audioSource.includes("/api/meetings/")) {
    throw new Error(`${scenario.name} audio viewer fell back to a raw meeting URL`);
  }
  const playbackProof = await playAttachmentAudioAndWaitForAdvance(page);
  const playerStateAfterAudio = await page.evaluate(() => window.Pucky.request({ command: "player.state", args: {} }));
  const audioPlayingScreenshot = await saveScreenshot(page, scenarioDir, "07-audio-playing");
  await backToDetail(page, "attachment", "html_iframe");
  await backToDetail(page, "transcript");
  await backToFeed(page);

  const bridgeTrace = bridgeState.commands.slice(bridgeStart);
  writeJsonFile(path.join(scenarioDir, "bridge_trace.json"), bridgeTrace);
  if (bridgeTrace.some((entry) => String(entry?.command || "") === "meeting.recording.resolve_audio_link")) {
    warnings.push("meeting_audio_html_depended_on_resolve_audio_link");
  }

  const result = {
    schema: "pucky.meeting_mode_real_vm_scenario.v1",
    name: scenario.name,
    meeting_id: scenario.meetingId,
    state: String(completedMeeting.state || ""),
    card_title: String(detailMeeting.title || ""),
    recording_title: String(detailMeeting.recording_title || ""),
    canonical_basename: String(detailMeeting.canonical_basename || ""),
    transcription_provider: String(detailMeeting.agent?.transcription_provider || ""),
    transcription_model: String(detailMeeting.agent?.transcription_model || ""),
    diarization_status: String(detailMeeting.diarization_status || ""),
    transcript_status: String(detailMeeting.transcript_status || ""),
    last_meeting_tool_name: String(detailMeeting.agent?.last_meeting_tool_name || detailMeeting.feed_item?.telemetry?.last_meeting_tool_name || ""),
    attachments: chipTexts,
    player_state_before_audio: playerStateBeforeAudio,
    player_state_after_audio: playerStateAfterAudio,
    audio_playback: playbackProof,
    audio_source: String(audioSource || ""),
    transcript_text,
    summary_text: String(summaryText || ""),
    warnings,
    screenshots: {
      pending_tile: pendingScreenshot,
      completed_tile: completedScreenshot,
      transcript_detail: transcriptDetailScreenshot,
      summary_html: summaryScreenshot,
      transcript_from_html: transcriptFromHtmlScreenshot,
      audio_from_html: audioFromHtmlScreenshot,
      audio_playing: audioPlayingScreenshot
    }
  };
  writeJsonFile(path.join(scenarioDir, "scenario_result.json"), result);
  return result;
}

function buildBridgeHandler({ baseUrl, apiToken, pathToMeetingId, bridgeState }) {
  const resolveMeetingAudioByPath = async (rawPath) => {
    const cleanPath = String(rawPath || "").trim();
    if (!cleanPath) {
      return null;
    }
    const knownMeetingId = pathToMeetingId.get(cleanPath);
    if (knownMeetingId) {
      return fetchMeetingDetail(baseUrl, apiToken, knownMeetingId);
    }
    const meetings = await apiJson(baseUrl, apiToken, "/api/meetings");
    const match = Array.isArray(meetings.meetings)
      ? meetings.meetings.find((item) => cleanPath === String(item?.device_path || "") || cleanPath === String(item?.audio_path || ""))
      : null;
    if (!match?.meeting_id) {
      return null;
    }
    pathToMeetingId.set(cleanPath, String(match.meeting_id));
    return fetchMeetingDetail(baseUrl, apiToken, String(match.meeting_id));
  };

  return async (message) => {
    const command = String(message?.command || "");
    const args = message && typeof message.args === "object" && message.args ? message.args : {};
    bridgeState.commands.push({ command, args });
    if (command === "pucky.config.get") {
      return {
        schema: "pucky.config.v1",
        api_base_url: baseUrl,
        api_token: apiToken
      };
    }
    if (command === "ui.reply_cards.get") {
      return fetchFeedSnapshot(baseUrl, apiToken);
    }
    if (command === "pucky.feed.sync") {
      return {
        schema: "pucky.feed_sync_result.v1",
        configured: true,
        reason: String(args.reason || "meeting_mode_real_vm_proof"),
        snapshot: await fetchFeedSnapshot(baseUrl, apiToken)
      };
    }
    if (command === "pucky.feed.action") {
      return {
        schema: "pucky.feed_action_result.v1",
        ok: true,
        action: String(args.action || ""),
        snapshot: await fetchFeedSnapshot(baseUrl, apiToken)
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
        duration_ms: loadedPath ? 12000 : 0
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
        return fetchArtifactBase64(baseUrl, apiToken, artifactId);
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
        headers: { Authorization: `Bearer ${apiToken}` }
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
        headers: { Authorization: `Bearer ${apiToken}` }
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
      const detail = meetingId ? await fetchMeetingDetail(baseUrl, apiToken, meetingId) : { meeting: {} };
      const meeting = detail.meeting || {};
      const response = meetingId
        ? await fetch(`${baseUrl}/api/meetings/${encodeURIComponent(meetingId)}/audio`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${apiToken}` }
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
        source: "browser_real_vm_proof"
      };
    }
    throw new Error(`Unsupported bridge command: ${command}`);
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const reportDir = options.reportDir ? path.resolve(options.reportDir) : path.join(DEFAULT_REPORT_ROOT, nowStamp());
  const videoDir = path.join(reportDir, "videos");
  const consoleLogPath = path.join(reportDir, "console.log");
  const summaryPath = path.join(reportDir, "summary.json");
  ensureDir(reportDir);
  ensureDir(videoDir);
  fs.writeFileSync(consoleLogPath, "", "utf8");

  const summary = {
    schema: "pucky.meeting_mode_real_vm_proof.v1",
    started_at: new Date().toISOString(),
    base_url: options.baseUrl,
    report_dir: reportDir,
    scenarios: []
  };

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
    const gitState = ensureCanonicalMasterClean();
    summary.git = gitState;

    const apiToken = resolveApiToken();
    const health = await fetchHealth(options.baseUrl);
    if (String(health.deepgram_key || "") !== "present") {
      throw new Error("Real VM browser proof requires deepgram_key: present from /healthz");
    }
    const manifest = await fetchManifest(options.baseUrl);
    if (String(manifest.source_commit_full || "") !== String(gitState.head || "")) {
      throw new Error(`VM manifest commit ${manifest.source_commit_full || "<empty>"} does not match local master HEAD ${gitState.head}`);
    }
    if (String(manifest.source_branch || "") !== "master" || Boolean(manifest.source_dirty)) {
      throw new Error("VM manifest is not serving a clean master bundle");
    }
    summary.health = health;
    summary.manifest = manifest;
    writeJsonFile(path.join(reportDir, "healthz.json"), health);
    writeJsonFile(path.join(reportDir, "bundle_identity.json"), manifest);

    browser = await chromium.launch({
      headless: options.headless,
      executablePath: resolveChromePath(),
      args: ["--disable-extensions", "--autoplay-policy=no-user-gesture-required"]
    });
    context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: videoDir, size: VIEWPORT }
    });
    await installCodexPuckyBridge(context, buildBridgeHandler({
      baseUrl: options.baseUrl,
      apiToken,
      pathToMeetingId,
      bridgeState
    }));
    page = await context.newPage();
    pageVideo = page.video();
    attachPageLogging(page, consoleLogPath);
    await page.goto(`${options.baseUrl}/ui/pucky/latest/`, { waitUntil: "load", timeout: 45000 });
    await page.waitForSelector("#feed", { timeout: 15000 });
    summary.screenshots = {
      home_initial: await saveScreenshot(page, reportDir, "00-home-initial")
    };

    const scenarios = buildScenarios(reportDir, options.scenarioNames);
    if (!scenarios.length) {
      throw new Error("No scenarios selected for real VM proof");
    }
    const failures = [];
    for (const scenario of scenarios) {
      try {
        const result = await runScenario({
          page,
          baseUrl: options.baseUrl,
          apiToken,
          reportDir,
          scenario,
          pathToMeetingId,
          bridgeState
        });
        summary.scenarios.push({ ok: true, ...result });
      } catch (error) {
        const scenarioDir = path.join(reportDir, scenario.name);
        ensureDir(scenarioDir);
        const failure = {
          schema: "pucky.meeting_mode_real_vm_scenario_failure.v1",
          ok: false,
          name: scenario.name,
          meeting_id: scenario.meetingId,
          error: error?.message || String(error)
        };
        failures.push(failure);
        summary.scenarios.push(failure);
        writeJsonFile(path.join(scenarioDir, "scenario_error.json"), failure);
      }
    }
    summary.ok = failures.length === 0;
    if (failures.length) {
      summary.error = `${failures.length} scenario(s) failed`;
    }
  } catch (error) {
    summary.ok = false;
    summary.error = error?.message || String(error);
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
      // Best effort.
    }
    try {
      if (browser) {
        await browser.close();
      }
    } catch (_) {
      // Best effort.
    }
    if (videoPath && fs.existsSync(summaryPath)) {
      const current = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      current.video_path = videoPath;
      current.bridge_commands = bridgeState.commands;
      writeJsonFile(summaryPath, current);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    summary_path: summaryPath
  }));
}

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
