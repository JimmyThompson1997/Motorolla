import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import {
  attachPageLogging,
  ensureDir,
  resolveChromePath,
  saveScreenshot,
  writeAutomationError,
  writeJsonFile
} from "./cover_shared.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PAGE_URL = "https://pucky.fly.dev/ui/pucky/latest/?theme=light&route=inbox&reset_nav=1";
const DEFAULT_REPORT_DIR = path.resolve(repoRoot, ".tmp", "cover-inbox-tile-audio-truth");
const VIEWPORT = { width: 430, height: 932 };

function parseArgs(argv) {
  const config = {
    pageUrl: process.env.PUCKY_TILE_AUDIO_PROOF_URL || DEFAULT_PAGE_URL,
    reportDir: DEFAULT_REPORT_DIR,
    timeoutMs: 30000,
    headless: true,
    preferredTitle: "Probe Check",
    sampleDurationMs: 8000,
    sampleIntervalMs: 100
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
    }
  }
  return config;
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

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}: ${String(payload?.detail || payload?.error || "")}`);
  }
  return payload;
}

async function fetchManifest(pageUrl) {
  return fetchJson(new URL("manifest.json", pageUrl).toString());
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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
      window.Pucky.request = async (payload) => {
        const command = payload && payload.command;
        if (armed && command === "player.play") {
          const result = await original(payload);
          armed = false;
          stopAtMs = Date.now() + Math.max(200, Number(delayMs || 450));
          return result;
        }
        if (!injected && stopAtMs && command === "player.state" && Date.now() >= stopAtMs) {
          injected = true;
          const result = await original(payload);
          return {
            ...result,
            state: "paused",
            is_playing: false
          };
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

async function clickAudioButton(page, title) {
  const button = cardLocator(page, title).locator("button.action-audio").first();
  await button.scrollIntoViewIfNeeded();
  try {
    await button.click({ timeout: 5000 });
  } catch (_) {
    await button.evaluate(node => node.click());
  }
}

async function collectDiagnostics(page, title) {
  return page.evaluate(async (targetTitle) => {
    const surface = await window.Pucky.request({ command: "ui.surface.get", args: {} });
    const probe = await window.Pucky.request({ command: "ui.debug.audio_probe.get", args: {} });
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
  const samples = [];
  const screenshots = {};
  let firstConfirmedAtMs = null;
  const startedAt = Date.now();
  while (Date.now() - startedAt <= durationMs) {
    const elapsedMs = Date.now() - startedAt;
    const snapshot = await collectDiagnostics(page, title);
    const sample = {
      elapsed_ms: elapsedMs,
      ...snapshot
    };
    samples.push(sample);
    if (!screenshots.starting && sample.card.audio_phase === "starting") {
      screenshots.starting = await saveScreenshot(page, reportDir, `${prefix}-starting`);
    }
    if (!screenshots.playing_confirmed && sample.card.audio_phase === "playing_confirmed") {
      firstConfirmedAtMs = elapsedMs;
      screenshots.playing_confirmed = await saveScreenshot(page, reportDir, `${prefix}-playing-confirmed`);
    }
    if (firstConfirmedAtMs !== null && !screenshots.one_second_after_confirmed && elapsedMs >= firstConfirmedAtMs + 1000) {
      screenshots.one_second_after_confirmed = await saveScreenshot(page, reportDir, `${prefix}-one-second-after-confirmed`);
    }
    if (!screenshots.start_failed && sample.card.audio_phase === "start_failed") {
      screenshots.start_failed = await saveScreenshot(page, reportDir, `${prefix}-start-failed`);
    }
    if (!screenshots.ended_immediately && sample.card.audio_phase === "ended_immediately") {
      screenshots.ended_immediately = await saveScreenshot(page, reportDir, `${prefix}-ended-immediately`);
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
  await clickAudioButton(page, title);
  const timeline = await sampleTimeline(page, title, {
    durationMs: config.sampleDurationMs,
    intervalMs: config.sampleIntervalMs,
    reportDir,
    prefix: "02-probe-check"
  });
  let stopTimeline = null;
  let stopShot = "";
  if (phaseSeen(timeline.samples, "playing_confirmed")) {
    await clickAudioButton(page, title);
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
    pre_click: preClick,
    pre_click_screenshot: preClickShot,
    timeline,
    stop_timeline: stopTimeline,
    stop_screenshot: stopShot
  };
}

async function runCrossCardScenario(page, config, primaryTitle, secondaryTitle, reportDir) {
  await loadInbox(page, config);
  await installInjectionHelpers(page);
  await clickAudioButton(page, primaryTitle);
  await page.waitForTimeout(600);
  await clickAudioButton(page, secondaryTitle);
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
  await clickAudioButton(page, title);
  const timeline = await sampleTimeline(page, title, {
    durationMs: config.sampleDurationMs,
    intervalMs: config.sampleIntervalMs,
    reportDir,
    prefix: "07-injected-failure"
  });
  await resetInjection(page);
  return {
    title,
    timeline
  };
}

async function runInjectedEarlyStopScenario(page, config, title, reportDir) {
  await loadInbox(page, config);
  await installInjectionHelpers(page);
  await page.evaluate(() => {
    window.__codexAudioTruthInjectEarlyStop(450);
  });
  await clickAudioButton(page, title);
  const timeline = await sampleTimeline(page, title, {
    durationMs: config.sampleDurationMs,
    intervalMs: config.sampleIntervalMs,
    reportDir,
    prefix: "08-injected-early-stop"
  });
  await resetInjection(page);
  return {
    title,
    timeline
  };
}

function immediateFeedbackResult(scenario) {
  const firstStarting = firstSampleWithPhase(scenario.timeline.samples, "starting");
  return {
    pass: Boolean(firstStarting && firstStarting.elapsed_ms <= 500),
    first_starting_ms: firstStarting ? firstStarting.elapsed_ms : null
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
  return {
    pass: sustained,
    confirmed_at_ms: confirmed.elapsed_ms
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
  const primaryFinalPhase = String(scenario.primary_state_after_switch?.card?.audio_phase || "");
  return {
    pass: secondaryStarting && (secondaryConfirmed || phaseSeen(scenario.timeline.samples, "start_failed") || phaseSeen(scenario.timeline.samples, "ended_immediately")) && primaryFinalPhase !== "playing_confirmed",
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
  lines.push(`- Immediate feedback: ${summary.results.immediate_feedback.pass ? "PASS" : "FAIL"}${summary.results.immediate_feedback.first_starting_ms !== null ? ` (${summary.results.immediate_feedback.first_starting_ms} ms)` : ""}`);
  lines.push(`- No fake waveform before confirmed play: ${summary.results.truthful_wave.pass ? "PASS" : "FAIL"}`);
  lines.push(`- Confirmed play stayed visually stable: ${summary.results.playing_stability.pass ? "PASS" : "FAIL"}`);
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

  const repo = ensureCanonicalMasterReady();
  const manifest = await fetchManifest(config.pageUrl);
  assert(String(manifest.source_commit_full || "") === String(repo.head), `Live manifest ${manifest.source_commit_full} does not match local/pushed HEAD ${repo.head}.`);

  const chromePath = resolveChromePath();
  const browser = await chromium.launch({
    headless: config.headless,
    executablePath: chromePath,
    args: [
      "--disable-extensions",
      "--autoplay-policy=no-user-gesture-required"
    ]
  });

  const summary = {
    page_url: config.pageUrl,
    report_dir: config.reportDir,
    repo,
    manifest,
    chrome_path: chromePath,
    screenshots: {}
  };

  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);
    attachPageLogging(page, consoleLogPath);

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
      stop: stopResult(startStop),
      cross_card: crossCard ? crossCardResult(crossCard) : { pass: false, reason: "No secondary audio card found." },
      injected_failure: injectedFailureResult(injectedFailure),
      injected_early_stop: injectedEarlyStopResult(injectedEarlyStop)
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

    writeJsonFile(path.join(config.reportDir, "summary.json"), summary);
    fs.writeFileSync(path.join(config.reportDir, "analysis.md"), buildAnalysis(summary), "utf8");
    await context.close();
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
