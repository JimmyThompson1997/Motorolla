import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, webkit } from "playwright-core";

import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RESULT_SCHEMA = "pucky.inbox_thread_compose_browser_proof.v1";
const THREAD_COMPOSE_NOTE = "thread-compose-note.txt";
const THREAD_COMPOSE_IMAGE = "thread-compose-proof.png";
const RUN_PREFIX = `THREAD-COMPOSE-${Date.now().toString(36).toUpperCase()}`;
const MOBILE_VIEWPORT = { width: 430, height: 932 };

const scenarios = [
  { key: "closed_lane_draft", token: `${RUN_PREFIX}-DRAFT-ONLY`, attachment_queued: THREAD_COMPOSE_NOTE },
  { key: "open_lane_smoke", token: `${RUN_PREFIX}-SMOKE-1`, expected: `ACK ${RUN_PREFIX}-SMOKE-1` },
  { key: "blocked_second_send", token: `${RUN_PREFIX}-BLOCK-1`, blocked_second_send: true, proof_reply_delay_ms: 6000, request_count_before_release: 1 },
  { key: "text_attachment", token: `${RUN_PREFIX}-TEXT-ATTACH`, expected: `TEXT-ATTACH-ACK ${RUN_PREFIX}`, attachment_queued: THREAD_COMPOSE_NOTE },
  { key: "binary_attachment", token: `${RUN_PREFIX}-IMAGE-ATTACH`, expected: `IMAGE-ATTACH-ACK ${RUN_PREFIX}`, attachment_queued: THREAD_COMPOSE_IMAGE },
  { key: "draft_back_return", token: `${RUN_PREFIX}-DRAFT-BACK`, attachment_queued: THREAD_COMPOSE_NOTE },
];

function parseArgs(argv) {
  const config = {
    pageUrl: process.env.PUCKY_THREAD_COMPOSE_URL || "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=light&route=inbox&reset_nav=1",
    browserName: "chromium",
    headless: true,
    timeoutMs: 30000,
    reportDir: path.resolve(ROOT, ".tmp", "proof-thread-compose-browser"),
    apiToken: String(process.env.PUCKY_API_TOKEN || process.env.PUCKY_WEB_UI_TOKEN || "").trim(),
    previewToken: String(process.env.PUCKY_WEB_UI_TOKEN || "").trim(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--page-url" && argv[index + 1]) config.pageUrl = String(argv[++index] || config.pageUrl);
    else if (arg === "--browser" && argv[index + 1]) config.browserName = String(argv[++index] || config.browserName);
    else if (arg === "--report-dir" && argv[index + 1]) config.reportDir = String(argv[++index] || config.reportDir);
    else if (arg === "--timeout-ms" && argv[index + 1]) config.timeoutMs = Number(argv[++index] || config.timeoutMs) || config.timeoutMs;
    else if (arg === "--api-token" && argv[index + 1]) config.apiToken = String(argv[++index] || "").trim();
    else if (arg === "--preview-token" && argv[index + 1]) config.previewToken = String(argv[++index] || "").trim();
    else if (arg === "--headed") config.headless = false;
  }
  return config;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isLocalUrl(pageUrl) {
  try {
    const host = String(new URL(pageUrl).hostname || "").trim().toLowerCase();
    return host === "127.0.0.1" || host === "localhost";
  } catch (_) {
    return false;
  }
}

function withQuery(pageUrl, updates = {}) {
  const url = new URL(pageUrl);
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      url.searchParams.delete(key);
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function loadPlaywrightBrowser(name, headless) {
  const browserName = String(name || "chromium").trim().toLowerCase();
  if (browserName === "webkit") {
    return webkit.launch({ headless });
  }
  return chromium.launch({ headless, executablePath: resolveChromePath() });
}

async function fetchManifest(pageUrl, token = "") {
  const url = new URL("manifest.json", pageUrl).toString();
  const headers = { Accept: "application/json" };
  if (String(token || "").trim()) {
    headers.Authorization = `Bearer ${String(token || "").trim()}`;
  }
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Manifest request failed (${response.status})`);
  }
  return response.json();
}

function createFixtureFiles(reportDir) {
  const assetDir = path.join(reportDir, "fixtures");
  ensureDir(assetDir);
  const notePath = path.join(assetDir, THREAD_COMPOSE_NOTE);
  const imagePath = path.join(assetDir, THREAD_COMPOSE_IMAGE);
  fs.writeFileSync(
    notePath,
    [
      `Thread compose proof token: ${RUN_PREFIX}`,
      "This text file proves queued attachments, user-side persistence, and viewer open behavior.",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbwAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  return { notePath, imagePath };
}

function createNetworkRecorder(page, outputPath) {
  const events = [];
  page.on("request", request => {
    events.push({
      type: "request",
      at: new Date().toISOString(),
      url: request.url(),
      method: request.method(),
      resource_type: request.resourceType(),
    });
  });
  page.on("response", async response => {
    events.push({
      type: "response",
      at: new Date().toISOString(),
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      content_type: String(response.headers()["content-type"] || ""),
    });
  });
  return {
    events,
    flush() {
      writeJsonFile(outputPath, events);
    }
  };
}

async function unlockPreviewIfNeeded(page, previewToken, timeoutMs) {
  const input = page.getByPlaceholder("Paste PUCKY_WEB_UI_TOKEN");
  if (!await input.count()) {
    return false;
  }
  assert(String(previewToken || "").trim(), "Preview unlock is required but no preview token was provided.");
  await input.fill(String(previewToken || "").trim());
  const button = page.getByRole("button", { name: /save token|update token|unlock preview/i }).first();
  await button.click();
  await page.waitForTimeout(700);
  return true;
}

async function waitForInbox(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const shell = document.querySelector('.light-shell[data-light-route="inbox"]');
      return Boolean(shell && document.querySelector('article[data-card-session-id], article[data-card-id]'));
    },
    undefined,
    { timeout: timeoutMs },
  );
}

async function openInbox(page, pageUrl, { previewToken = "", timeoutMs = 30000 } = {}) {
  await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await unlockPreviewIfNeeded(page, previewToken, timeoutMs).catch(() => false);
  await waitForInbox(page, timeoutMs);
  await page.waitForTimeout(400);
}

async function findThreadTarget(page) {
  const target = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('article[data-card-session-id], article[data-card-id]'));
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const mapped = cards.map(node => ({
      title: normalize(node.querySelector(".title")?.textContent),
      summary: normalize(node.querySelector(".preview, .card-outbound-preview")?.textContent),
      cardId: String(node.getAttribute("data-card-id") || "").trim(),
      sessionId: String(node.getAttribute("data-card-session-id") || "").trim(),
      threadId: String(node.getAttribute("data-card-thread-id") || "").trim(),
      hasComposerTrigger: Boolean(node.querySelector(".card-summary-trigger, .card-title-trigger, .card-outbound-preview")),
    }));
    return mapped.find(card => card.title === "Thread Compose Seed")
      || mapped.find(card => card.threadId && card.hasComposerTrigger)
      || null;
  });
  assert(target, "Could not find an Inbox thread card with transcript detail.");
  return target;
}

async function clickCardTranscript(page, target) {
  await page.evaluate((card) => {
    const selectors = [];
    if (card.cardId) {
      selectors.push(`article[data-card-id="${CSS.escape(card.cardId)}"]`);
    }
    if (card.sessionId) {
      selectors.push(`article[data-card-session-id="${CSS.escape(card.sessionId)}"]`);
    }
    if (card.threadId) {
      selectors.push(`article[data-card-thread-id="${CSS.escape(card.threadId)}"]`);
    }
    const node = selectors.map(selector => document.querySelector(selector)).find(Boolean);
    if (!node) {
      throw new Error(`Card not found for selectors: ${selectors.join(", ")}`);
    }
    const trigger = node.querySelector(".card-summary-trigger, .card-title-trigger") || node;
    trigger.click();
  }, target);
  await page.waitForFunction(
    () => {
      const detail = document.getElementById("detail");
      return Boolean(detail && detail.getAttribute("aria-hidden") === "false" && detail.querySelector(".thread-composer"));
    },
    undefined,
    { timeout: 10000 },
  );
  await page.waitForTimeout(250);
}

async function closeDetail(page) {
  const back = page.locator("#detail .light-back-button, #detail .detail-back").first();
  if (!await back.count()) {
    return;
  }
  await back.click();
  await page.waitForFunction(
    () => document.getElementById("detail")?.getAttribute("aria-hidden") === "true",
    undefined,
    { timeout: 5000 },
  );
}

async function openPendingTranscript(page) {
  await page.locator("article.card-outbound").first().click();
  await page.waitForFunction(
    () => {
      const detail = document.getElementById("detail");
      return Boolean(detail && detail.getAttribute("aria-hidden") === "false");
    },
    undefined,
    { timeout: 10000 },
  );
}

async function composerSnapshot(page) {
  return page.evaluate(() => {
    const detail = document.getElementById("detail");
    const textarea = detail?.querySelector(".thread-composer-input");
    const send = detail?.querySelector(".thread-composer-send");
    const status = detail?.querySelector(".thread-composer-status");
    const chips = Array.from(detail?.querySelectorAll(".thread-composer-chip-label") || []).map(node => String(node.textContent || "").trim());
    const bubbleTexts = Array.from(detail?.querySelectorAll(".bubble") || []).map(node => String(node.textContent || "").replace(/\s+/g, " ").trim());
    return {
      title: String(detail?.querySelector(".detail-title")?.textContent || "").trim(),
      thread_id: String(detail?.getAttribute("data-detail-thread-id") || "").trim(),
      viewer: String(detail?.getAttribute("data-detail-viewer") || "").trim(),
      kind: String(detail?.getAttribute("data-detail-kind") || "").trim(),
      composer_text: String(textarea?.value || ""),
      send_disabled: Boolean(send && send.disabled),
      status_text: String(status?.textContent || "").replace(/\s+/g, " ").trim(),
      chips,
      bubble_texts: bubbleTexts,
    };
  });
}

async function fillComposerText(page, text) {
  const textarea = page.locator("#detail .thread-composer-input").first();
  await textarea.fill(text);
}

async function queueComposerFiles(page, filePaths) {
  const input = page.locator('#detail input[type="file"]').first();
  await input.setInputFiles(filePaths);
  await page.waitForTimeout(300);
}

async function clickSend(page) {
  await page.locator("#detail .thread-composer-send").first().click();
}

async function waitForPendingFeedStatus(page, expectedText, token, timeoutMs) {
  await page.waitForFunction(
    ({ expected, tokenText }) => {
      const cards = Array.from(document.querySelectorAll("article.card-outbound"));
      return cards.some(card => {
        const preview = String(card.querySelector(".card-outbound-preview")?.textContent || "");
        const status = String(card.querySelector(".card-outbound-status")?.textContent || "");
        return preview.includes(tokenText) && status.includes(expected);
      });
    },
    { expected: expectedText, tokenText: token },
    { timeout: timeoutMs },
  );
}

async function pendingFeedState(page) {
  return page.evaluate(() => {
    const card = document.querySelector("article.card-outbound");
    return {
      present: Boolean(card),
      preview: String(card?.querySelector(".card-outbound-preview")?.textContent || "").replace(/\s+/g, " ").trim(),
      status: String(card?.querySelector(".card-outbound-status")?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });
}

async function waitForBubbleText(page, text, timeoutMs) {
  await page.waitForFunction(
    (expected) => Array.from(document.querySelectorAll("#detail .bubble")).some(node => String(node.textContent || "").includes(expected)),
    text,
    { timeout: timeoutMs },
  );
}

async function openLatestThreadDetail(page, target) {
  await closeDetail(page);
  await clickCardTranscript(page, target);
}

function countTurnTextRequests(events) {
  return events.filter(event => event.type === "request" && event.method === "POST" && /\/api\/turn\/text(?:$|[?#])/.test(String(event.url || ""))).length;
}

async function waitForAttachmentViewer(page, expectedViewer, timeoutMs) {
  await page.waitForFunction(
    (viewer) => {
      const detail = document.getElementById("detail");
      return Boolean(detail && detail.getAttribute("aria-hidden") === "false" && detail.getAttribute("data-detail-viewer") === viewer);
    },
    expectedViewer,
    { timeout: timeoutMs },
  );
}

function latestVideoPath(reportDir) {
  const videoDir = path.join(reportDir, "video");
  if (!fs.existsSync(videoDir)) {
    return "";
  }
  const files = fs.readdirSync(videoDir).filter(name => /\.(webm|mp4)$/i.test(name)).sort();
  return files.length ? path.join(videoDir, files[files.length - 1]) : "";
}

async function runClosedLaneScenario(page, target, files, scenario, config, summary) {
  await clickCardTranscript(page, target);
  await fillComposerText(page, scenario.token);
  await saveScreenshot(page, config.reportDir, "01-closed-lane-composer-idle");
  await queueComposerFiles(page, [files.notePath]);
  await saveScreenshot(page, config.reportDir, "02-closed-lane-attachment-queued");
  const snapshot = await composerSnapshot(page);
  assert(snapshot.composer_text.includes(scenario.token), "Closed-lane draft text did not persist in the composer.");
  assert(snapshot.chips.includes(THREAD_COMPOSE_NOTE), "Closed-lane queued attachment chip is missing.");
  assert(snapshot.send_disabled, "Closed-lane Send button must stay disabled.");
  assert(/draft only/i.test(snapshot.status_text), `Closed-lane reason should mention draft-only mode. Saw: ${snapshot.status_text}`);
  summary.closed_lane_draft = snapshot;
  await closeDetail(page);
}

async function runOpenLaneScenario(page, target, files, config, summary, networkEvents) {
  await clickCardTranscript(page, target);
  await saveScreenshot(page, config.reportDir, "03-open-lane-composer-idle");

  const smoke = scenarios.find(item => item.key === "open_lane_smoke");
  assert(smoke, "Smoke scenario is missing.");
  await page.evaluate(() => {
    window.PuckyComposerProofReplyDelayMs = 3500;
  });
  const smokeReplyPromise = page.waitForResponse(
    response => response.request().method() === "POST" && /\/api\/turn\/text(?:$|[?#])/.test(response.url()),
    { timeout: config.timeoutMs * 2 },
  );
  await fillComposerText(page, `${smoke.token}. Reply with exactly ${smoke.expected}.`);
  await clickSend(page);
  await closeDetail(page);
  await waitForPendingFeedStatus(page, "Sending", smoke.token, config.timeoutMs);
  summary.sending_label = "Sending";
  summary.thinking_label = "Thinking...";
  summary.open_lane_smoke = {
    sending: await pendingFeedState(page),
  };
  await saveScreenshot(page, config.reportDir, "04-sending-feed");
  await waitForPendingFeedStatus(page, "Thinking", smoke.token, config.timeoutMs);
  summary.open_lane_smoke.thinking = await pendingFeedState(page);
  await saveScreenshot(page, config.reportDir, "05-thinking-feed");
  await openPendingTranscript(page);
  await waitForBubbleText(page, "Thinking...", config.timeoutMs);
  await saveScreenshot(page, config.reportDir, "06-thinking-detail");
  const smokeResponse = await smokeReplyPromise;
  const smokePayload = await smokeResponse.json();
  await waitForBubbleText(page, smoke.expected, config.timeoutMs);
  summary.open_lane_smoke.final = await composerSnapshot(page);
  summary.open_lane_smoke.turn_response = {
    turn_id: String(smokePayload?.turn_id || ""),
    requested_thread_id: String(smokePayload?.telemetry?.requested_thread_id || ""),
    origin_thread_id: String(smokePayload?.origin?.thread_id || smokePayload?.card?.origin?.thread_id || ""),
  };
  await saveScreenshot(page, config.reportDir, "07-final-reply");
  await page.evaluate(() => {
    window.PuckyComposerProofReplyDelayMs = 0;
  });

  const blocked = scenarios.find(item => item.key === "blocked_second_send");
  assert(blocked, "Blocked-second-send scenario is missing.");
  await page.evaluate(delay => {
    window.PuckyComposerProofReplyDelayMs = delay;
  }, blocked.proof_reply_delay_ms);
  const requestCountBeforeBlocked = countTurnTextRequests(networkEvents);
  const blockedReplyPromise = page.waitForResponse(
    response => response.request().method() === "POST" && /\/api\/turn\/text(?:$|[?#])/.test(response.url()) && response.request().postData()?.includes(blocked.token),
    { timeout: config.timeoutMs * 3 },
  );
  await fillComposerText(page, `${blocked.token}. Reply with exactly ACK ${blocked.token}.`);
  await clickSend(page);
  await fillComposerText(page, `${RUN_PREFIX}-BLOCK-2. Reply with exactly ACK ${RUN_PREFIX}-BLOCK-2.`);
  await page.waitForTimeout(350);
  const blockedSnapshot = await composerSnapshot(page);
  assert(blockedSnapshot.send_disabled, "Second send must stay disabled while the first turn is active.");
  assert(blockedSnapshot.composer_text.includes(`${RUN_PREFIX}-BLOCK-2`), "Second draft should remain typed while the first turn is active.");
  assert(/waiting on a reply/i.test(blockedSnapshot.status_text), `Blocked-send reason should explain the active turn. Saw: ${blockedSnapshot.status_text}`);
  assert(countTurnTextRequests(networkEvents) === requestCountBeforeBlocked + 1, "Blocked second send emitted an unexpected second POST /api/turn/text.");
  summary.request_count_before_release = countTurnTextRequests(networkEvents) - requestCountBeforeBlocked;
  summary.blocked_second_send = blockedSnapshot;
  await saveScreenshot(page, config.reportDir, "08-blocked-second-send");
  const blockedFirstResponse = await blockedReplyPromise;
  const blockedFirstPayload = await blockedFirstResponse.json();
  await waitForBubbleText(page, `ACK ${blocked.token}`, config.timeoutMs * 2);
  await page.waitForFunction(
    (draftToken) => {
      const textarea = document.querySelector("#detail .thread-composer-input");
      const send = document.querySelector("#detail .thread-composer-send");
      return Boolean(
        textarea
          && send
          && String(textarea.value || "").includes(draftToken)
          && !send.disabled
      );
    },
    `${RUN_PREFIX}-BLOCK-2`,
    { timeout: config.timeoutMs },
  );
  const secondDraftAfterFirstReply = await composerSnapshot(page);
  assert(secondDraftAfterFirstReply.composer_text.includes(`${RUN_PREFIX}-BLOCK-2`), "Second draft vanished after the first delayed reply completed.");
  assert(!secondDraftAfterFirstReply.send_disabled, "Send should re-enable once the first delayed reply completes.");
  const secondReplyPromise = page.waitForResponse(
    response => response.request().method() === "POST" && /\/api\/turn\/text(?:$|[?#])/.test(response.url()) && response.request().postData()?.includes(`${RUN_PREFIX}-BLOCK-2`),
    { timeout: config.timeoutMs * 2 },
  );
  await clickSend(page);
  const secondBlockedPayload = await (await secondReplyPromise).json();
  await waitForBubbleText(page, `ACK ${RUN_PREFIX}-BLOCK-2`, config.timeoutMs);
  summary.blocked_second_send.turns = [
    {
      turn_id: String(blockedFirstPayload?.turn_id || ""),
      requested_thread_id: String(blockedFirstPayload?.telemetry?.requested_thread_id || ""),
    },
    {
      turn_id: String(secondBlockedPayload?.turn_id || ""),
      requested_thread_id: String(secondBlockedPayload?.telemetry?.requested_thread_id || ""),
    },
  ];
  await page.evaluate(() => {
    window.PuckyComposerProofReplyDelayMs = 0;
  });

  const textAttachment = scenarios.find(item => item.key === "text_attachment");
  assert(textAttachment, "Text-attachment scenario is missing.");
  const textReplyPromise = page.waitForResponse(
    response => response.request().method() === "POST" && /\/api\/turn\/text(?:$|[?#])/.test(response.url()),
    { timeout: config.timeoutMs * 2 },
  );
  await fillComposerText(page, `${textAttachment.token}. Reply with exactly TEXT-ATTACH-ACK ${RUN_PREFIX} and mention ${THREAD_COMPOSE_NOTE}.`);
  await queueComposerFiles(page, [files.notePath]);
  await saveScreenshot(page, config.reportDir, "09-text-attachment-queued");
  await clickSend(page);
  await (await textReplyPromise).json();
  await waitForBubbleText(page, `TEXT-ATTACH-ACK ${RUN_PREFIX}`, config.timeoutMs);
  const textUserBubble = page.locator("#detail .bubble.user").filter({ hasText: textAttachment.token }).last();
  const textChip = textUserBubble.locator(".bubble-attachment-chip").filter({ hasText: THREAD_COMPOSE_NOTE }).first();
  await textChip.click();
  await waitForAttachmentViewer(page, "text", config.timeoutMs);
  summary.text_attachment = await composerSnapshot(page);
  await saveScreenshot(page, config.reportDir, "10-text-attachment-open");
  await page.locator("#detail .light-back-button, #detail .detail-back").first().click();
  await page.waitForSelector("#detail .thread-composer");

  const imageAttachment = scenarios.find(item => item.key === "binary_attachment");
  assert(imageAttachment, "Image-attachment scenario is missing.");
  const imageReplyPromise = page.waitForResponse(
    response => response.request().method() === "POST" && /\/api\/turn\/text(?:$|[?#])/.test(response.url()),
    { timeout: config.timeoutMs * 2 },
  );
  await fillComposerText(page, `${imageAttachment.token}. Reply with exactly IMAGE-ATTACH-ACK ${RUN_PREFIX}.`);
  await queueComposerFiles(page, [files.imagePath]);
  await saveScreenshot(page, config.reportDir, "11-image-attachment-queued");
  await clickSend(page);
  await (await imageReplyPromise).json();
  await waitForBubbleText(page, `IMAGE-ATTACH-ACK ${RUN_PREFIX}`, config.timeoutMs);
  const imageUserBubble = page.locator("#detail .bubble.user").filter({ hasText: imageAttachment.token }).last();
  const imageChip = imageUserBubble.locator(".bubble-attachment-chip").filter({ hasText: THREAD_COMPOSE_IMAGE }).first();
  await imageChip.click();
  await waitForAttachmentViewer(page, "image_gallery", config.timeoutMs);
  summary.binary_attachment = await composerSnapshot(page);
  await saveScreenshot(page, config.reportDir, "12-image-attachment-open");
  await page.locator("#detail .light-back-button, #detail .detail-back").first().click();
  await page.waitForSelector("#detail .thread-composer");

  const draftReturn = scenarios.find(item => item.key === "draft_back_return");
  assert(draftReturn, "Draft-back-return scenario is missing.");
  await fillComposerText(page, draftReturn.token);
  await queueComposerFiles(page, [files.notePath]);
  const preBackSnapshot = await composerSnapshot(page);
  await saveScreenshot(page, config.reportDir, "13-draft-before-back");
  await closeDetail(page);
  await clickCardTranscript(page, target);
  const postBackSnapshot = await composerSnapshot(page);
  assert(postBackSnapshot.composer_text.includes(draftReturn.token), "Unsent draft text did not survive leaving and returning to the thread.");
  assert(postBackSnapshot.chips.includes(THREAD_COMPOSE_NOTE), "Queued file chip did not survive leaving and returning to the thread.");
  summary.back_return = {
    before: preBackSnapshot,
    after: postBackSnapshot,
  };
  await saveScreenshot(page, config.reportDir, "14-back-return");
}

async function runContext(browser, config, reportDir, setup) {
  ensureDir(reportDir);
  const videoDir = path.join(reportDir, "video");
  ensureDir(videoDir);
  const context = await browser.newContext({
    viewport: MOBILE_VIEWPORT,
    recordVideo: { dir: videoDir, size: MOBILE_VIEWPORT },
    acceptDownloads: true,
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  attachPageLogging(page, path.join(reportDir, "console.log"));
  const network = createNetworkRecorder(page, path.join(reportDir, "network.json"));
  try {
    const result = await setup({ context, page, network });
    await context.tracing.stop({ path: path.join(reportDir, "trace.zip") });
    network.flush();
    await context.close();
    return { ...result, video_path: latestVideoPath(reportDir), trace_zip: path.join(reportDir, "trace.zip") };
  } catch (error) {
    await context.tracing.stop({ path: path.join(reportDir, "trace.zip") }).catch(() => {});
    network.flush();
    await context.close().catch(() => {});
    throw error;
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const fixtureFiles = createFixtureFiles(config.reportDir);
  const manifest = await fetchManifest(config.pageUrl, config.previewToken || config.apiToken).catch(() => ({
    source_commit_full: "",
    source_branch: "",
    source_dirty: null,
  }));
  const summary = {
    schema: RESULT_SCHEMA,
    manifest_commit: String(manifest?.source_commit_full || ""),
    manifest,
    scenarios,
    sending_label: "Sending",
    thinking_label: "Thinking...",
    note_attachment: THREAD_COMPOSE_NOTE,
    image_attachment: THREAD_COMPOSE_IMAGE,
    request_count_before_release: 0,
    trace_zip: "",
    video_path: "",
  };
  const browser = await loadPlaywrightBrowser(config.browserName, config.headless);
  try {
    const closedLaneDir = path.join(config.reportDir, "closed-lane");
    const closedLane = await runContext(browser, config, closedLaneDir, async ({ page }) => {
      const pageUrl = withQuery(config.pageUrl, { api_token: "" });
      await openInbox(page, pageUrl, { previewToken: isLocalUrl(pageUrl) ? "" : config.previewToken, timeoutMs: config.timeoutMs });
      await saveScreenshot(page, config.reportDir, "00-route-top");
      const target = await findThreadTarget(page);
      const closedSummary = {};
      await runClosedLaneScenario(page, target, fixtureFiles, scenarios[0], config, closedSummary);
      return { closedSummary };
    });
    summary.closed_lane = closedLane.closedSummary;

    const openLaneDir = path.join(config.reportDir, "open-lane");
    const openLane = await runContext(browser, config, openLaneDir, async ({ page, network }) => {
      const pageUrl = withQuery(config.pageUrl, { api_token: config.apiToken });
      if (!isLocalUrl(pageUrl)) {
        assert(String(config.apiToken || "").trim(), "Open-lane proof requires --api-token or PUCKY_API_TOKEN on hosted runs.");
      }
      await openInbox(page, pageUrl, { previewToken: config.previewToken || config.apiToken, timeoutMs: config.timeoutMs });
      const target = await findThreadTarget(page);
      const openSummary = {};
      await runOpenLaneScenario(page, target, fixtureFiles, config, openSummary, network.events);
      return { openSummary };
    });
    Object.assign(summary, openLane.openSummary);
    summary.trace_zip = openLane.trace_zip;
    summary.video_path = openLane.video_path;
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
