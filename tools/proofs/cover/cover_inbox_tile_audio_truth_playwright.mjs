import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_PAGE_URL = "https://pucky.fly.dev/ui/pucky/latest/?theme=light&route=inbox&reset_nav=1";
const DEFAULT_REPORT_DIR = path.resolve(repoRoot, ".tmp", "cover-inbox-tile-audio-truth");
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    pageUrl: process.env.PUCKY_TILE_AUDIO_PROOF_URL || DEFAULT_PAGE_URL,
    reportDir: DEFAULT_REPORT_DIR,
    timeoutMs: 30000,
    headless: true,
    browserName: "chromium",
    preferredTitle: "Probe Check",
    sampleDurationMs: 8000,
    sampleIntervalMs: 100,
    skipCanonicalCheck: false,
    apiToken: String(process.env.PUCKY_API_TOKEN || "").trim(),
    allowAutoplayBypass: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === "--page-url" && argv[index + 1]) {
      config.pageUrl = String(argv[++index] || config.pageUrl);
    } else if (arg === "--report-dir" && argv[index + 1]) {
      config.reportDir = path.resolve(String(argv[++index] || config.reportDir));
    } else if (arg === "--timeout-ms" && argv[index + 1]) {
      config.timeoutMs = Math.max(1000, Number(argv[++index] || config.timeoutMs) || config.timeoutMs);
    } else if (arg === "--sample-duration-ms" && argv[index + 1]) {
      config.sampleDurationMs = Math.max(500, Number(argv[++index] || config.sampleDurationMs) || config.sampleDurationMs);
    } else if (arg === "--sample-interval-ms" && argv[index + 1]) {
      config.sampleIntervalMs = Math.max(50, Number(argv[++index] || config.sampleIntervalMs) || config.sampleIntervalMs);
    } else if (arg === "--preferred-title" && argv[index + 1]) {
      config.preferredTitle = String(argv[++index] || config.preferredTitle);
    } else if (arg === "--headed") {
      config.headless = false;
    } else if (arg === "--browser" && argv[index + 1]) {
      const browserName = String(argv[++index] || config.browserName).trim().toLowerCase();
      config.browserName = browserName === "webkit" ? "webkit" : "chromium";
    } else if (arg === "--skip-canonical-check") {
      config.skipCanonicalCheck = true;
    } else if (arg === "--allow-autoplay-bypass") {
      config.allowAutoplayBypass = true;
    }
  }
  return config;
}

function isLocalProofUrl(pageUrl) {
  try {
    const host = String(new URL(pageUrl).hostname || "").trim();
    return host === "127.0.0.1" || host === "localhost";
  } catch (_) {
    return false;
  }
}

function runProcess(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 20
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(executable)} ${args.join(" ")} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return String(result.stdout || "").trim();
}

function gitOutput(args) {
  return runProcess("git", args, { cwd: repoRoot });
}

function repoState() {
  const branchStatus = gitOutput(["status", "--short", "--branch", "--untracked-files=no"]);
  const head = gitOutput(["rev-parse", "HEAD"]);
  const upstream = gitOutput(["rev-parse", "@{u}"]);
  return {
    branch_status: branchStatus,
    head,
    upstream,
    clean: !branchStatus.split(/\r?\n/).slice(1).some(line => String(line || "").trim())
  };
}

function ensureCanonicalMasterReady() {
  const status = repoState();
  if (!String(status.branch_status || "").startsWith("## master...origin/master")) {
    throw new Error(`Canonical repo must be on master tracking origin/master. Saw: ${status.branch_status}`);
  }
  if (!status.clean) {
    throw new Error(`Canonical repo has tracked changes and is not ready for official proof. Saw:\n${status.branch_status}`);
  }
  if (String(status.head || "") !== String(status.upstream || "")) {
    throw new Error(`Canonical repo HEAD ${status.head} does not match upstream ${status.upstream}`);
  }
  return status;
}

async function fetchJson(url, token = "") {
  const headers = { Accept: "application/json" };
  if (String(token || "").trim()) {
    headers.Authorization = `Bearer ${String(token || "").trim()}`;
  }
  const response = await fetch(url, { headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}: ${String(payload?.detail || payload?.error || "")}`);
  }
  return payload;
}

async function fetchManifest(pageUrl, token = "") {
  return fetchJson(new URL("manifest.json", pageUrl).toString(), token);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function launchConfiguredBrowser(config) {
  const browserName = String(config.browserName || "chromium").trim().toLowerCase();
  if (browserName === "webkit") {
    return webkit.launch({ headless: config.headless });
  }
  const browserArgs = ["--disable-extensions"];
  if (config.allowAutoplayBypass) {
    browserArgs.push("--autoplay-policy=no-user-gesture-required");
  }
  return chromium.launch({
    headless: config.headless,
    executablePath: resolveChromePath(),
    args: browserArgs
  });
}

async function loadInbox(page, config) {
  await page.goto(config.pageUrl, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
  await page.waitForFunction(
    () => document.querySelector(".light-shell")?.getAttribute("data-light-route") === "inbox",
    {},
    { timeout: config.timeoutMs }
  );
  await page.waitForSelector('article[data-card-id], article[data-card-session-id]', { timeout: config.timeoutMs });
  await page.waitForTimeout(300);
}

async function installInjectionHelpers(page) {
  await page.evaluate(() => {
    if (window.__codexAudioTruthHelpersReady) {
      window.__codexAudioTruthResetRequest?.();
      return;
    }
    const base = window.Pucky.request.bind(window.Pucky);
    window.__codexAudioTruthBaseRequest = base;
    window.__codexAudioTruthResetRequest = () => {
      window.Pucky.request = window.__codexAudioTruthBaseRequest;
    };
    window.__codexAudioTruthInjectPlayFailure = (message = "Injected browser proof play failure.") => {
      const original = window.__codexAudioTruthBaseRequest;
      let armed = true;
      window.Pucky.request = async (payload) => {
        if (armed && payload && payload.command === "player.play") {
          armed = false;
          throw new Error(message);
        }
        return original(payload);
      };
    };
    window.__codexAudioTruthInjectEarlyStop = (delayMs = 450) => {
      const original = window.__codexAudioTruthBaseRequest;
      let armed = true;
      let stopAtMs = 0;
      let injected = false;
      let pauseRequested = false;
      window.Pucky.request = async (payload) => {
        const command = payload && payload.command;
        if (armed && command === "player.play") {
          const result = await original(payload);
          armed = false;
          stopAtMs = Date.now() + Math.max(200, Number(delayMs || 450));
          return result;
        }
        if (!pauseRequested && stopAtMs && Date.now() >= stopAtMs) {
          pauseRequested = true;
          original({ command: "player.pause", args: {} }).catch(() => {});
        }
        if (!injected && command === "player.state" && pauseRequested) {
          injected = true;
        }
        return original(payload);
      };
    };
    window.__codexAudioTruthHelpersReady = true;
  });
}

async function resetInjection(page) {
  await page.evaluate(() => {
    window.__codexAudioTruthResetRequest?.();
  });
}

async function listAudioCards(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('article[data-card-id], article[data-card-session-id]'))
      .map(node => ({
        title: String(node.querySelector(".title")?.textContent || "").replace(/\s+/g, " ").trim(),
        session_id: node.getAttribute("data-card-session-id") || "",
        thread_id: node.getAttribute("data-card-thread-id") || "",
        has_audio: Boolean(node.querySelector("button.action-audio"))
      }))
      .filter(card => card.has_audio && card.title);
  });
}

function pickCards(cards, preferredTitle) {
  const preferred = cards.find(card => card.title === preferredTitle)
    || cards.find(card => card.title.includes(preferredTitle))
    || cards[0]
    || null;
  const secondary = cards.find(card => preferred && card.title !== preferred.title) || null;
  return {
    primary: preferred,
    secondary
  };
}

function cardLocator(page, title) {
  return page.locator('article[data-card-id], article[data-card-session-id]').filter({
    has: page.locator(".title", { hasText: title })
  }).first();
}

function audioClickDelivered(before, after, title) {
  const beforePhase = String(before?.card?.audio_phase || "");
  const afterPhase = String(after?.card?.audio_phase || "");
  const afterProbeTitle = String(after?.probe?.target_card?.title || "");
  const afterPlayerTitle = String(after?.player?.title || "");
  if (!after?.card?.found) {
    return false;
  }
  if (afterPhase && afterPhase !== beforePhase) {
    return true;
  }
  if (String(after?.card?.audio_busy || "") === "true") {
    return true;
  }
  if (beforePhase === "playing_confirmed") {
    return !after?.player?.is_playing || /^Play\b/.test(String(after?.card?.button_label || ""));
  }
  if (afterProbeTitle === title && afterPhase !== "idle") {
    return true;
  }
  if (beforePhase === "idle") {
    return Boolean(after?.player?.is_playing && afterPlayerTitle === title);
  }
  return false;
}

async function waitForAudioClickDelivery(page, title, before, timeoutMs = 750) {
  const startedAt = Date.now();
  let last = await collectDiagnostics(page, title);
  while (Date.now() - startedAt <= timeoutMs) {
    if (audioClickDelivered(before, last, title)) {
      return { delivered: true, diagnostics: last };
    }
    await page.waitForTimeout(75);
    last = await collectDiagnostics(page, title);
  }
  return { delivered: audioClickDelivered(before, last, title), diagnostics: last };
}

async function resolveAudioButton(page, title) {
  let lastError = null;
  for (let attemptIndex = 0; attemptIndex < 8; attemptIndex += 1) {
    const button = cardLocator(page, title).locator("button.action-audio").first();
    try {
      await button.waitFor({ state: "visible", timeout: 5000 });
      const target = await button.evaluate(node => ({
        card_id: String(node.getAttribute("data-card-id") || ""),
        session_id: String(node.getAttribute("data-card-session-id") || ""),
        label: String(node.getAttribute("aria-label") || "")
      }));
      return { button, target };
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(100 + attemptIndex * 50);
    }
  }
  throw lastError || new Error(`Could not resolve audio button for "${title}"`);
}

async function clickAudioButton(page, title) {
  const { button, target } = await resolveAudioButton(page, title);
  const before = await collectDiagnostics(page, title);
  const attempts = [];
  const attempt = async (strategy, action) => {
    try {
      await action();
    } catch (error) {
      attempts.push({
        strategy,
        delivered: false,
        error: String(error?.message || error || "")
      });
      return null;
    }
    const delivery = await waitForAudioClickDelivery(page, title, before);
    attempts.push({
      strategy,
      delivered: delivery.delivered,
      phase: String(delivery.diagnostics?.card?.audio_phase || ""),
      busy: String(delivery.diagnostics?.card?.audio_busy || ""),
      player_title: String(delivery.diagnostics?.player?.title || ""),
      player_source: String(delivery.diagnostics?.player?.source || ""),
      probe_target_title: String(delivery.diagnostics?.probe?.target_card?.title || ""),
      probe_phase: String(delivery.diagnostics?.probe?.current_tile_audio_phase || "")
    });
    return delivery.delivered ? delivery : null;
  };

  let delivered = await attempt("locator_click", () => button.click({ timeout: 5000 }));
  if (!delivered) {
    delivered = await attempt("force_locator_click", () => button.click({ timeout: 5000, force: true }));
  }
  if (!delivered) {
    delivered = await attempt("mouse_click", async () => {
      const fresh = await resolveAudioButton(page, title);
      const box = await fresh.button.boundingBox();
      if (!box) {
        throw new Error("audio button bounding box was unavailable");
      }
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    });
  }
  if (!delivered) {
    throw new Error(`Audio click did not reach "${title}" (${JSON.stringify({ target, attempts })})`);
  }
  return {
    title,
    target,
    attempts,
    delivered_strategy: attempts.find(item => item.delivered)?.strategy || ""
  };
}

async function collectDiagnostics(page, title) {
  return page.evaluate(async (targetTitle) => {
    const surface = await window.Pucky.request({ command: "ui.surface.get", args: {} });
    const probe = await window.Pucky.request({ command: "ui.debug.audio_probe.get", args: {} });
    const player = await window.Pucky.request({ command: "player.state", args: {} });
    const cards = Array.from(document.querySelectorAll('article[data-card-id], article[data-card-session-id]'));
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const node = cards.find(card => normalize(card.querySelector(".title")?.textContent) === targetTitle)
      || cards.find(card => normalize(card.querySelector(".title")?.textContent).includes(targetTitle))
      || null;
    const button = node?.querySelector("button.action-audio") || null;
    const status = node?.querySelector(".tile-audio-status") || null;
    const strip = status?.querySelector(".tile-audio-strip") || null;
    const preview = node?.querySelector(".preview") || null;
    return {
      observed_at: new Date().toISOString(),
      route: document.querySelector(".light-shell")?.getAttribute("data-light-route") || "",
      surface: {
        bridge_connected: Boolean(surface?.bridge_connected),
        audio_runtime_mode: String(surface?.audio_runtime_mode || ""),
        toast: {
          message: String(surface?.toast?.message || ""),
          shown_at: String(surface?.toast?.shown_at || "")
        }
      },
      player,
      probe,
      card: {
        found: Boolean(node),
        title: normalize(node?.querySelector(".title")?.textContent),
        session_id: node?.getAttribute("data-card-session-id") || "",
        card_id: node?.getAttribute("data-card-id") || "",
        thread_id: node?.getAttribute("data-card-thread-id") || "",
        audio_phase: node?.getAttribute("data-audio-phase") || "",
        audio_runtime_mode: node?.getAttribute("data-audio-runtime-mode") || "",
        audio_strip_kind: node?.getAttribute("data-audio-strip-kind") || "",
        audio_busy: node?.getAttribute("data-audio-busy") || "",
        button_label: button?.getAttribute("aria-label") || "",
        preview_text: normalize(preview?.textContent),
        status_label: normalize(status?.querySelector(".tile-audio-status-label")?.textContent),
        status_meta: normalize(status?.querySelector(".tile-audio-status-meta")?.textContent),
        has_status: Boolean(status),
        has_strip: Boolean(strip),
        strip_class: strip?.className || "",
        strip_kind_attr: strip?.getAttribute("data-strip-kind") || "",
        has_wave_row: Boolean(node?.querySelector(".wave-row")),
        wave_tick_count: node?.querySelectorAll(".wave-row .tick").length || 0
      }
    };
  }, title);
}

async function sampleTimeline(page, title, options = {}) {
  const durationMs = Math.max(500, Number(options.durationMs || 8000));
  const intervalMs = Math.max(50, Number(options.intervalMs || 100));
  const reportDir = options.reportDir;
  const prefix = String(options.prefix || "sample");
  const stopWhen = typeof options.stopWhen === "function" ? options.stopWhen : null;
  const samples = [];
  const screenshots = {};
  let firstConfirmedAtMs = null;
  let firstFeedbackShot = "";
  const startedAt = Date.now();
  while (Date.now() - startedAt <= durationMs) {
    const elapsedMs = Date.now() - startedAt;
    const snapshot = await collectDiagnostics(page, title);
    const sample = {
      elapsed_ms: elapsedMs,
      ...snapshot
    };
    samples.push(sample);
    if (!firstFeedbackShot && sample.card.audio_phase !== "idle") {
      firstFeedbackShot = await saveScreenshot(page, reportDir, `${prefix}-first-feedback`);
    }
    if (!screenshots.starting && sample.card.audio_phase === "starting") {
      screenshots.starting = await saveScreenshot(page, reportDir, `${prefix}-starting`);
    }
    if (!screenshots.playing_confirmed && sample.card.audio_phase === "playing_confirmed") {
      firstConfirmedAtMs = elapsedMs;
      screenshots.playing_confirmed = await saveScreenshot(page, reportDir, `${prefix}-playing-confirmed`);
      if (!screenshots.starting) {
        screenshots.starting = firstFeedbackShot || screenshots.playing_confirmed;
      }
    }
    if (firstConfirmedAtMs !== null && !screenshots.one_second_after_confirmed && elapsedMs >= firstConfirmedAtMs + 1000) {
      screenshots.one_second_after_confirmed = await saveScreenshot(page, reportDir, `${prefix}-one-second-after-confirmed`);
    }
    if (!screenshots.start_failed && sample.card.audio_phase === "start_failed") {
      screenshots.start_failed = await saveScreenshot(page, reportDir, `${prefix}-start-failed`);
      if (!screenshots.starting) {
        screenshots.starting = firstFeedbackShot || screenshots.start_failed;
      }
    }
    if (!screenshots.ended_immediately && sample.card.audio_phase === "ended_immediately") {
      screenshots.ended_immediately = await saveScreenshot(page, reportDir, `${prefix}-ended-immediately`);
      if (!screenshots.starting) {
        screenshots.starting = firstFeedbackShot || screenshots.ended_immediately;
      }
    }
    if (stopWhen && stopWhen(sample, samples)) {
      break;
    }
    await page.waitForTimeout(intervalMs);
  }
  screenshots.final = await saveScreenshot(page, reportDir, `${prefix}-final`);
  return { samples, screenshots };
}

function firstSampleWithPhase(samples, phase) {
  return samples.find(sample => sample.card.audio_phase === phase) || null;
}

function lastSample(samples) {
  return samples.length ? samples[samples.length - 1] : null;
}

function phaseSeen(samples, phase) {
  return Boolean(firstSampleWithPhase(samples, phase));
}

async function runStartStopScenario(page, config, title, reportDir) {
  await loadInbox(page, config);
  await installInjectionHelpers(page);
  const preClick = await collectDiagnostics(page, title);
  const preClickShot = await saveScreenshot(page, reportDir, "01-pre-click");
  const startClick = await clickAudioButton(page, title);
  const timeline = await sampleTimeline(page, title, {
    durationMs: config.sampleDurationMs,
    intervalMs: config.sampleIntervalMs,
    reportDir,
    prefix: "02-probe-check",
    stopWhen: (sample) => {
      if (sample.card.audio_phase === "start_failed" || sample.card.audio_phase === "ended_immediately") {
        return true;
      }
      if (sample.card.audio_phase !== "playing_confirmed") {
        return false;
      }
      const durationMs = Math.max(0, Number(sample?.player?.duration_ms || 0));
      const requiredDeltaMs = requiredPlaybackDeltaMs(durationMs);
      return Number(sample?.player?.position_ms || 0) >= requiredDeltaMs;
    }
  });
  let stopTimeline = null;
  let stopShot = "";
  let stopClick = null;
  if (phaseSeen(timeline.samples, "playing_confirmed") && lastSample(timeline.samples)?.card?.audio_phase === "playing_confirmed") {
    stopClick = await clickAudioButton(page, title);
    stopTimeline = await sampleTimeline(page, title, {
      durationMs: 2500,
      intervalMs: config.sampleIntervalMs,
      reportDir,
      prefix: "05-probe-check-stop"
    });
    stopShot = stopTimeline.screenshots.final || "";
  }
  return {
    title,
    start_click: startClick,
    pre_click: preClick,
    pre_click_screenshot: preClickShot,
    timeline,
    stop_click: stopClick,
    stop_timeline: stopTimeline,
    stop_screenshot: stopShot
  };
}

function requiredPlaybackDeltaMs(durationMs) {
  if (durationMs > 0 && durationMs < 2400) {
    return Math.max(250, Math.min(1000, Math.round(durationMs * 0.5)));
  }
  return 2000;
}

async function runCrossCardScenario(page, config, primaryTitle, secondaryTitle, reportDir) {
  await loadInbox(page, config);
  await installInjectionHelpers(page);
  const primaryClick = await clickAudioButton(page, primaryTitle);
  await page.waitForTimeout(600);
  const secondaryClick = await clickAudioButton(page, secondaryTitle);
  const timeline = await sampleTimeline(page, secondaryTitle, {
    durationMs: 3000,
    intervalMs: config.sampleIntervalMs,
    reportDir,
    prefix: "06-cross-card"
  });
  const primaryState = await collectDiagnostics(page, primaryTitle);
  return {
    primary_title: primaryTitle,
    secondary_title: secondaryTitle,
    clicks: {
      primary: primaryClick,
      secondary: secondaryClick
    },
    timeline,
    primary_state_after_switch: primaryState
  };
}

async function runInjectedFailureScenario(page, config, title, reportDir) {
  await loadInbox(page, config);
  await installInjectionHelpers(page);
  await page.evaluate(() => {
    window.__codexAudioTruthInjectPlayFailure("Injected browser proof play failure.");
  });
  const click = await clickAudioButton(page, title);
  const timeline = await sampleTimeline(page, title, {
    durationMs: config.sampleDurationMs,
    intervalMs: config.sampleIntervalMs,
    reportDir,
    prefix: "07-injected-failure"
  });
  await resetInjection(page);
  return {
    title,
    click,
    timeline
  };
}

async function runInjectedEarlyStopScenario(page, config, title, reportDir) {
  await loadInbox(page, config);
  await installInjectionHelpers(page);
  await page.evaluate(() => {
    window.__codexAudioTruthInjectEarlyStop(450);
  });
  const click = await clickAudioButton(page, title);
  const timeline = await sampleTimeline(page, title, {
    durationMs: config.sampleDurationMs,
    intervalMs: config.sampleIntervalMs,
    reportDir,
    prefix: "08-injected-early-stop"
  });
  await resetInjection(page);
  return {
    title,
    click,
    timeline
  };
}

function immediateFeedbackResult(scenario) {
  const firstFeedback = scenario.timeline.samples.find(sample =>
    sample.card.audio_phase === "starting"
      || sample.card.audio_phase === "playing_confirmed"
      || sample.card.audio_phase === "start_failed"
      || sample.card.audio_phase === "ended_immediately"
  );
  return {
    pass: Boolean(firstFeedback && firstFeedback.elapsed_ms <= 500),
    first_feedback_ms: firstFeedback ? firstFeedback.elapsed_ms : null,
    first_feedback_phase: firstFeedback?.card.audio_phase || ""
  };
}

function truthfulWaveResult(scenario) {
  const firstConfirmed = firstSampleWithPhase(scenario.timeline.samples, "playing_confirmed");
  const preConfirmed = firstConfirmed
    ? scenario.timeline.samples.filter(sample => sample.elapsed_ms <= firstConfirmed.elapsed_ms)
    : scenario.timeline.samples;
  const fakeWaveSeen = preConfirmed.some(sample => sample.card.has_wave_row || sample.card.wave_tick_count > 0 || sample.card.audio_strip_kind === "waveform");
  return {
    pass: !fakeWaveSeen,
    fake_wave_seen: fakeWaveSeen
  };
}

function playingStabilityResult(scenario) {
  const confirmed = firstSampleWithPhase(scenario.timeline.samples, "playing_confirmed");
  if (!confirmed) {
    return {
      pass: false,
      reason: "playing_confirmed never observed"
    };
  }
  const sustained = scenario.timeline.samples.some(sample =>
    sample.elapsed_ms >= confirmed.elapsed_ms + 1000 && sample.card.audio_phase === "playing_confirmed"
  );
  if (sustained) {
    return {
      pass: true,
      confirmed_at_ms: confirmed.elapsed_ms,
      stability_kind: "sustained_confirmed"
    };
  }
  const postConfirmed = scenario.timeline.samples.filter(sample => sample.elapsed_ms >= confirmed.elapsed_ms);
  const durationMs = Math.max(0, ...postConfirmed.map(sample => Number(sample?.player?.duration_ms || 0)));
  const maxPositionMs = Math.max(0, ...postConfirmed.map(sample => Number(sample?.player?.position_ms || 0)));
  const endedImmediately = postConfirmed.find(sample => sample.card.audio_phase === "ended_immediately") || null;
  const finalPostConfirmed = lastSample(postConfirmed);
  const requiredCompletionMs = durationMs > 0
    ? Math.max(250, Math.min(1000, Math.round(durationMs * 0.5)))
    : 500;
  const shortClipReadyForPause = Boolean(
    durationMs > 0
      && durationMs <= 2400
      && String(finalPostConfirmed?.card?.audio_phase || "") === "playing_confirmed"
      && maxPositionMs >= requiredCompletionMs
  );
  const shortClipCompleted = Boolean(
    endedImmediately
      && durationMs > 0
      && durationMs <= 2400
      && maxPositionMs >= requiredCompletionMs
  );
  return {
    pass: shortClipReadyForPause || shortClipCompleted,
    confirmed_at_ms: confirmed.elapsed_ms,
    stability_kind: shortClipReadyForPause
      ? "short_clip_confirmed_before_pause"
      : shortClipCompleted
        ? "short_clip_completed_after_confirmed"
        : "not_sustained",
    duration_ms: durationMs,
    max_position_ms: maxPositionMs,
    required_completion_ms: requiredCompletionMs,
    ended_immediately_at_ms: endedImmediately?.elapsed_ms ?? null
  };
}

function progressAdvancementResult(scenario) {
  const positions = scenario.timeline.samples.map(sample => Number(sample?.player?.position_ms || 0));
  const durationMs = Math.max(0, ...scenario.timeline.samples.map(sample => Number(sample?.player?.duration_ms || 0)));
  const maxPositionMs = positions.length ? Math.max(...positions) : 0;
  const minPositionMs = positions.length ? Math.min(...positions) : 0;
  const firstElapsedMs = Number(scenario.timeline.samples[0]?.elapsed_ms || 0);
  const observedStartMs = firstElapsedMs <= 500 ? 0 : minPositionMs;
  const deltaMs = Math.max(0, maxPositionMs - observedStartMs);
  const requiredDeltaMs = requiredPlaybackDeltaMs(durationMs);
  return {
    pass: deltaMs >= requiredDeltaMs,
    delta_ms: deltaMs,
    observed_start_ms: observedStartMs,
    max_position_ms: maxPositionMs,
    required_delta_ms: requiredDeltaMs,
    duration_ms: durationMs
  };
}

function stopResult(scenario) {
  if (!scenario.stop_timeline) {
    return {
      pass: false,
      reason: "second-tap stop did not run because play was never confirmed"
    };
  }
  const finalSample = lastSample(scenario.stop_timeline.samples);
  return {
    pass: Boolean(finalSample && finalSample.card.audio_phase === "idle"),
    final_phase: finalSample?.card.audio_phase || ""
  };
}

function crossCardResult(scenario) {
  const secondaryStarting = phaseSeen(scenario.timeline.samples, "starting");
  const secondaryConfirmed = phaseSeen(scenario.timeline.samples, "playing_confirmed");
  const secondaryVisibleFeedback = secondaryStarting
    || secondaryConfirmed
    || phaseSeen(scenario.timeline.samples, "start_failed")
    || phaseSeen(scenario.timeline.samples, "ended_immediately");
  const primaryFinalPhase = String(scenario.primary_state_after_switch?.card?.audio_phase || "");
  return {
    pass: secondaryVisibleFeedback && primaryFinalPhase !== "playing_confirmed",
    primary_final_phase: primaryFinalPhase,
    secondary_confirmed: secondaryConfirmed
  };
}

function injectedFailureResult(scenario) {
  const failed = firstSampleWithPhase(scenario.timeline.samples, "start_failed");
  const finalSample = lastSample(scenario.timeline.samples);
  return {
    pass: Boolean(failed && String(finalSample?.probe?.last_terminal_outcome || "") === "start_failed"),
    failed_at_ms: failed?.elapsed_ms ?? null,
    toast: String(finalSample?.surface?.toast?.message || "")
  };
}

function injectedEarlyStopResult(scenario) {
  const endedEarly = firstSampleWithPhase(scenario.timeline.samples, "ended_immediately");
  const finalSample = lastSample(scenario.timeline.samples);
  const reason = Array.isArray(finalSample?.probe?.recent_events)
    ? finalSample.probe.recent_events.find(event => event.type === "terminal")?.reason || ""
    : "";
  return {
    pass: Boolean(endedEarly && String(finalSample?.probe?.last_terminal_outcome || "") === "ended_immediately"),
    ended_immediately_at_ms: endedEarly?.elapsed_ms ?? null,
    terminal_reason: reason
  };
}

function realMediaRequestResult(events) {
  const mediaEvent = Array.isArray(events)
    ? events.find((event) => {
        const url = String(event?.url || "");
        const contentType = String(event?.content_type || "");
        return !/\/mock\//i.test(url)
          && Number(event?.status || 0) >= 200
          && Number(event?.status || 0) < 300
          && (
            String(event?.resource_type || "") === "media"
            || /audio\//i.test(contentType)
            || /\.(wav|mp3|m4a|aac|ogg|opus)(?:$|[?#])/i.test(url)
          );
      })
    : null;
  return {
    pass: Boolean(mediaEvent),
    event: mediaEvent || null
  };
}

function consoleGestureFailureResult(messages) {
  const match = Array.isArray(messages)
    ? messages.find(message => /play\(\) failed because the user didn't interact with the document first/i.test(String(message?.text || "")))
    : null;
  return {
    pass: !match,
    message: match ? String(match.text || "") : ""
  };
}

function buildAnalysis(summary) {
  const lines = [];
  lines.push("# Inbox Tile Audio Truth Proof");
  lines.push("");
  lines.push(`- Page URL: ${summary.page_url}`);
  lines.push(`- Manifest ui_version: ${summary.manifest.ui_version}`);
  lines.push(`- Manifest source_commit_full: ${summary.manifest.source_commit_full}`);
  lines.push(`- Runtime mode: ${summary.initial_surface.surface.audio_runtime_mode}`);
  lines.push(`- Bridge connected: ${summary.initial_surface.surface.bridge_connected}`);
  lines.push("");

  lines.push("## Start / Stop");
  lines.push(`- Target tile: ${summary.targets.primary_title}`);
  lines.push(`- Immediate feedback: ${summary.results.immediate_feedback.pass ? "PASS" : "FAIL"}${summary.results.immediate_feedback.first_feedback_ms !== null ? ` (${summary.results.immediate_feedback.first_feedback_ms} ms, ${summary.results.immediate_feedback.first_feedback_phase || "unknown"})` : ""}`);
  lines.push(`- No fake waveform before confirmed play: ${summary.results.truthful_wave.pass ? "PASS" : "FAIL"}`);
  lines.push(`- Confirmed play stayed visually stable: ${summary.results.playing_stability.pass ? "PASS" : "FAIL"}${summary.results.playing_stability.stability_kind ? ` (${summary.results.playing_stability.stability_kind})` : ""}`);
  lines.push(`- Real progress advanced: ${summary.results.progress_advancement.pass ? "PASS" : "FAIL"} (${summary.results.progress_advancement.delta_ms} ms / required ${summary.results.progress_advancement.required_delta_ms} ms)`);
  lines.push(`- Second-tap stop returned cleanly to idle: ${summary.results.stop.pass ? "PASS" : "FAIL"}${summary.results.stop.final_phase ? ` (${summary.results.stop.final_phase})` : ""}`);
  lines.push("");

  lines.push("## Cross Card");
  lines.push(`- Primary tile cleared after switching: ${summary.results.cross_card.pass ? "PASS" : "FAIL"} (primary final phase: ${summary.results.cross_card.primary_final_phase || "idle"})`);
  lines.push("");

  lines.push("## Injected Failure");
  lines.push(`- Start failure classified clearly: ${summary.results.injected_failure.pass ? "PASS" : "FAIL"}`);
  if (summary.results.injected_failure.toast) {
    lines.push(`- Observed toast: ${summary.results.injected_failure.toast}`);
  }
  lines.push("");

  lines.push("## Injected Early Stop");
  lines.push(`- Early stop classified as ended_immediately: ${summary.results.injected_early_stop.pass ? "PASS" : "FAIL"}`);
  if (summary.results.injected_early_stop.terminal_reason) {
    lines.push(`- Terminal reason: ${summary.results.injected_early_stop.terminal_reason}`);
  }
  lines.push("");

  lines.push("## Runtime Evidence");
  lines.push(`- Real media request observed: ${summary.results.real_media_request.pass ? "PASS" : "FAIL"}`);
  if (summary.results.real_media_request.event?.url) {
    lines.push(`- Media URL: ${summary.results.real_media_request.event.url}`);
  }
  lines.push(`- No user-gesture play() console failure: ${summary.results.console_user_gesture_failure.pass ? "PASS" : "FAIL"}`);
  lines.push("");

  lines.push("## Screenshots");
  for (const [label, target] of Object.entries(summary.screenshots)) {
    lines.push(`- ${label}: ${target}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function run() {
  const config = parseArgs(process.argv.slice(2));
  ensureDir(config.reportDir);
  const consoleLogPath = path.join(config.reportDir, "console.log");
  fs.writeFileSync(consoleLogPath, "", "utf8");

  const isLocalProof = config.skipCanonicalCheck || isLocalProofUrl(config.pageUrl);
  const repo = isLocalProof ? { head: "", upstream: "", branch_status: "", clean: true } : ensureCanonicalMasterReady();
  const manifest = await fetchManifest(config.pageUrl, config.apiToken);
  if (!isLocalProof) {
    assert(String(manifest.source_commit_full || "") === String(repo.head), `Live manifest ${manifest.source_commit_full} does not match local/pushed HEAD ${repo.head}.`);
  }

  const browser = await launchConfiguredBrowser(config);

  const summary = {
    browser_name: config.browserName,
    page_url: config.pageUrl,
    report_dir: config.reportDir,
    repo,
    manifest,
    chrome_path: config.browserName === "chromium" ? resolveChromePath() : "",
    screenshots: {}
  };

  try {
    const videoDir = path.join(config.reportDir, "video");
    ensureDir(videoDir);
    const tracePath = path.join(config.reportDir, "trace.zip");
    const networkEvents = [];
    const consoleMessages = [];
    const context = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: videoDir, size: VIEWPORT }
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    const pageVideo = page.video();
    page.setDefaultTimeout(config.timeoutMs);
    attachPageLogging(page, consoleLogPath);
    page.on("console", (message) => {
      consoleMessages.push({
        type: message.type(),
        text: message.text()
      });
    });
    page.on("response", async (response) => {
      const headers = await response.allHeaders().catch(() => ({}));
      networkEvents.push({
        url: response.url(),
        status: response.status(),
        resource_type: response.request().resourceType(),
        content_type: String(headers["content-type"] || "")
      });
    });

    await loadInbox(page, config);
    await installInjectionHelpers(page);
    const audioCards = await listAudioCards(page);
    const targets = pickCards(audioCards, config.preferredTitle);
    assert(targets.primary, "No Inbox cards with tile audio were found on the live page.");
    summary.targets = {
      primary_title: targets.primary.title,
      secondary_title: targets.secondary?.title || ""
    };
    summary.initial_surface = await collectDiagnostics(page, targets.primary.title);

    const startStop = await runStartStopScenario(page, config, targets.primary.title, config.reportDir);
    const crossCard = targets.secondary
      ? await runCrossCardScenario(page, config, targets.primary.title, targets.secondary.title, config.reportDir)
      : null;
    const injectedFailure = await runInjectedFailureScenario(page, config, targets.primary.title, config.reportDir);
    const injectedEarlyStop = await runInjectedEarlyStopScenario(page, config, targets.primary.title, config.reportDir);

    fs.writeFileSync(path.join(config.reportDir, "final-dom.html"), await page.content(), "utf8");
    writeJsonFile(path.join(config.reportDir, "network.json"), networkEvents);
    writeJsonFile(path.join(config.reportDir, "console.json"), consoleMessages);

    summary.scenarios = {
      start_stop: startStop,
      cross_card: crossCard,
      injected_failure: injectedFailure,
      injected_early_stop: injectedEarlyStop
    };
    summary.results = {
      immediate_feedback: immediateFeedbackResult(startStop),
      truthful_wave: truthfulWaveResult(startStop),
      playing_stability: playingStabilityResult(startStop),
      progress_advancement: progressAdvancementResult(startStop),
      stop: stopResult(startStop),
      cross_card: crossCard ? crossCardResult(crossCard) : { pass: false, reason: "No secondary audio card found." },
      injected_failure: injectedFailureResult(injectedFailure),
      injected_early_stop: injectedEarlyStopResult(injectedEarlyStop),
      real_media_request: realMediaRequestResult(networkEvents),
      console_user_gesture_failure: consoleGestureFailureResult(consoleMessages)
    };
    summary.screenshots = {
      pre_click: startStop.pre_click_screenshot,
      starting: startStop.timeline.screenshots.starting || "",
      playing_confirmed: startStop.timeline.screenshots.playing_confirmed || "",
      one_second_after_confirmed: startStop.timeline.screenshots.one_second_after_confirmed || "",
      stop_final: startStop.stop_screenshot || "",
      cross_card_final: crossCard?.timeline?.screenshots?.final || "",
      injected_start_failed: injectedFailure.timeline.screenshots.start_failed || injectedFailure.timeline.screenshots.final || "",
      injected_ended_immediately: injectedEarlyStop.timeline.screenshots.ended_immediately || injectedEarlyStop.timeline.screenshots.final || ""
    };
    summary.evidence = {
      trace: tracePath,
      console_log: consoleLogPath,
      console_json: path.join(config.reportDir, "console.json"),
      network_json: path.join(config.reportDir, "network.json"),
      final_dom: path.join(config.reportDir, "final-dom.html"),
      video_dir: videoDir,
      video_path: ""
    };

    await context.tracing.stop({ path: tracePath });
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    fs.writeFileSync(path.join(config.reportDir, "analysis.md"), buildAnalysis(summary), "utf8");
    await context.close();
    summary.evidence.video_path = pageVideo ? await pageVideo.path().catch(() => "") : "";
    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    assert(summary.results.immediate_feedback.pass, `Tile audio did not show prompt user feedback (saw ${summary.results.immediate_feedback.first_feedback_phase || "nothing"} at ${summary.results.immediate_feedback.first_feedback_ms ?? "never"} ms).`);
    assert(summary.results.truthful_wave.pass, "Tile audio showed a fake waveform before real playback was confirmed.");
    assert(summary.results.playing_stability.pass, `Confirmed playback did not remain stable enough to trust the UI (${summary.results.playing_stability.stability_kind || summary.results.playing_stability.reason || "unknown"}).`);
    assert(summary.results.progress_advancement.pass, `Audio did not advance enough to prove real playback (${summary.results.progress_advancement.delta_ms} ms / required ${summary.results.progress_advancement.required_delta_ms} ms).`);
    assert(summary.results.stop.pass, `Second-tap pause/stop did not return the tile to idle (${summary.results.stop.final_phase || summary.results.stop.reason || "unknown"}).`);
    assert(summary.results.cross_card.pass, `Cross-card playback handoff failed (${summary.results.cross_card.reason || summary.results.cross_card.primary_final_phase || "unknown"}).`);
    assert(summary.results.injected_failure.pass, "Injected play failure did not surface as a clear start_failed outcome.");
    assert(summary.results.injected_early_stop.pass, "Injected early stop did not surface as ended_immediately.");
    assert(summary.results.real_media_request.pass, "No successful non-mock audio media request was observed.");
    assert(summary.results.console_user_gesture_failure.pass, "Observed a browser user-gesture play() failure in the console log.");
  } catch (error) {
    writeAutomationError(config.reportDir, error);
    throw error;
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
