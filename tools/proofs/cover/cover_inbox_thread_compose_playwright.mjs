import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  attachPageLogging,
  ensureDir,
  saveScreenshot,
  writeJsonFile
} from "../../support/cover_shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RESULT_SCHEMA = "pucky.inbox_thread_compose_browser_proof.v1";
const THREAD_COMPOSE_NOTE = "thread-compose-note.txt";
const THREAD_COMPOSE_IMAGE = "thread-compose-proof.png";
const RUN_PREFIX = `THREAD-COMPOSE-${Date.now().toString(36).toUpperCase()}`;

const scenarios = [
  { key: "closed_lane_draft", token: `${RUN_PREFIX}-DRAFT-ONLY`, attachment_queued: THREAD_COMPOSE_NOTE },
  { key: "open_lane_smoke", token: `${RUN_PREFIX}-SMOKE-1`, expected: `ACK ${RUN_PREFIX}-SMOKE-1` },
  { key: "blocked_second_send", token: `${RUN_PREFIX}-BLOCK-1`, blocked_second_send: true, proof_reply_delay_ms: 6000, request_count_before_release: 1 },
  { key: "text_attachment", token: `${RUN_PREFIX}-TEXT-ATTACH`, expected: `TEXT-ATTACH-ACK ${RUN_PREFIX}`, attachment_queued: THREAD_COMPOSE_NOTE },
  { key: "binary_attachment", token: `${RUN_PREFIX}-IMAGE-ATTACH`, expected: `IMAGE-ATTACH-ACK ${RUN_PREFIX}`, attachment_queued: THREAD_COMPOSE_IMAGE },
  { key: "draft_back_return", token: `${RUN_PREFIX}-DRAFT-BACK` },
];

function parseArgs(argv) {
  const config = {
    pageUrl: process.env.PUCKY_THREAD_COMPOSE_URL || "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=light&route=inbox&reset_nav=1",
    browserName: "chromium",
    headless: true,
    timeoutMs: 30000,
    reportDir: path.resolve(ROOT, ".tmp", "proof-thread-compose-browser"),
    manifest_commit: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--page-url" && argv[index + 1]) config.pageUrl = String(argv[++index] || config.pageUrl);
    else if (arg === "--browser" && argv[index + 1]) config.browserName = String(argv[++index] || config.browserName);
    else if (arg === "--report-dir" && argv[index + 1]) config.reportDir = String(argv[++index] || config.reportDir);
    else if (arg === "--timeout-ms" && argv[index + 1]) config.timeoutMs = Number(argv[++index] || config.timeoutMs) || config.timeoutMs;
    else if (arg === "--headed") config.headless = false;
  }
  return config;
}

async function loadPlaywrightBrowser(name, headless) {
  const { chromium, webkit } = await import("playwright-core");
  return (name === "webkit" ? webkit : chromium).launch({ headless });
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  await ensureDir(config.reportDir);
  const summary = {
    schema: RESULT_SCHEMA,
    manifest_commit: config.manifest_commit,
    scenarios,
    sending_label: "Sending",
    thinking_label: "Thinking...",
    note_attachment: THREAD_COMPOSE_NOTE,
    image_attachment: THREAD_COMPOSE_IMAGE,
    trace_zip: path.join(config.reportDir, "trace.zip"),
    video_path: path.join(config.reportDir, "video.webm"),
    request_count_before_release: 0,
  };
  const browser = await loadPlaywrightBrowser(config.browserName, config.headless);
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, recordVideo: { dir: config.reportDir } });
  const page = await context.newPage();
  const consoleEvents = [];
  const networkEvents = [];
  attachPageLogging(page, consoleEvents, networkEvents);
  await page.goto(config.pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await page.waitForTimeout(1200);
  await saveScreenshot(page, path.join(config.reportDir, "route-top.png"));
  writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
  writeJsonFile(path.join(config.reportDir, "console.json"), consoleEvents);
  writeJsonFile(path.join(config.reportDir, "network.json"), networkEvents);
  fs.writeFileSync(path.join(config.reportDir, "README.txt"), `Focused thread compose proof placeholder for ${RUN_PREFIX}\n`);
  await context.close();
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
