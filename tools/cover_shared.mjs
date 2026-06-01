import fs from "node:fs";
import path from "node:path";

export const MIN_PLAYBACK_SPEED = 0.5;
export const MAX_PLAYBACK_SPEED = 3;

export function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

export function resolveChromePath() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("Chrome executable not found");
}

export function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/")}`;
}

export function basename(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

export function clampSpeed(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, parsed));
}

export function formatSpeed(value) {
  return `${Number(clampSpeed(value).toFixed(2)).toString()}x`;
}

export function readRuntimeFixtures(repoRoot) {
  const deployPath = path.join(repoRoot, "pucky_vm", "ui_src", "fixtures", "reply_cards_deploy.json");
  const deployFixture = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  const cards = Array.isArray(deployFixture.cards) ? deployFixture.cards.map(runtimeCardFromDeploy) : [];
  return {
    schema: "pucky.reply_cards.v1",
    count: cards.length,
    cards
  };
}

function runtimeCardFromDeploy(rawCard) {
  const card = JSON.parse(JSON.stringify(rawCard || {}));
  const audioArtifact = String(card.audio_artifact || "").trim();
  const htmlArtifact = String(card.html_artifact || "").trim();
  const deviceAudioPath = String(card.device_audio_path || "").trim();
  const publicAudioPath = String(card.public_audio_path || "").trim();
  const publicAudioPlaylistPath = String(card.public_audio_playlist_path || "").trim();
  const impliedAudioArtifact = inferredAudioArtifactName({
    card,
    htmlArtifact,
    deviceAudioPath,
    publicAudioPath
  });

  delete card.audio_artifact;
  delete card.html_artifact;
  delete card.device_audio_path;
  delete card.public_audio_path;
  delete card.public_audio_playlist_path;

  if (audioArtifact) {
    card.audio_path = artifactMockPath(audioArtifact);
  } else if (impliedAudioArtifact) {
    card.audio_path = artifactMockPath(impliedAudioArtifact);
  } else if (deviceAudioPath) {
    card.audio_path = deviceAudioPath;
  } else if (publicAudioPath) {
    card.audio_path = publicAudioPath;
  }
  if (publicAudioPlaylistPath) {
    card.audio_playlist_path = publicAudioPlaylistPath;
  }
  if (htmlArtifact) {
    card.html_path = artifactMockPath(htmlArtifact);
  }
  if (Array.isArray(card.attachments)) {
    card.attachments = card.attachments.map(runtimeAttachmentFromDeploy);
  }
  if (Array.isArray(card.images)) {
    card.images = card.images.map(runtimeAttachmentFromDeploy);
  }
  if (Array.isArray(card.transcript_messages)) {
    card.transcript_messages = card.transcript_messages.map((message) => {
      const copy = JSON.parse(JSON.stringify(message || {}));
      if (Array.isArray(copy.attachments)) {
        copy.attachments = copy.attachments.map(runtimeAttachmentFromDeploy);
      }
      if (Array.isArray(copy.images)) {
        copy.images = copy.images.map(runtimeAttachmentFromDeploy);
      }
      return copy;
    });
  }
  return card;
}

function runtimeAttachmentFromDeploy(attachment) {
  const item = JSON.parse(JSON.stringify(attachment || {}));
  const artifact = String(item.artifact || "").trim();
  if (artifact && !String(item.path || "").trim()) {
    item.path = artifactMockPath(artifact);
  }
  return item;
}

function artifactMockPath(artifactName) {
  return `/mock/${String(artifactName || "").replace(/^\/+/, "")}`;
}

function inferredAudioArtifactName({ card, htmlArtifact, deviceAudioPath, publicAudioPath }) {
  if (!htmlArtifact || !(deviceAudioPath || publicAudioPath)) {
    return "";
  }
  if (!Array.isArray(card.audio_timestamps) || !card.audio_timestamps.length) {
    return "";
  }
  return `${path.parse(htmlArtifact).name}.wav`;
}

export async function installCodexPuckyBridge(context, handler) {
  await context.exposeBinding("__codexPuckyPostMessage", async ({ page }, raw) => {
    let callbackId = "";
    let payload;
    try {
      const parsed = JSON.parse(String(raw || "{}"));
      callbackId = String(parsed.id || "");
      payload = {
        ok: true,
        result: await handler(parsed)
      };
    } catch (error) {
      payload = {
        ok: false,
        error: error.message || String(error),
        error_type: error.name || "Error"
      };
    }
    if (callbackId) {
      await page.evaluate(
        ({ id, result }) => {
          window.Pucky && window.Pucky.__resolve && window.Pucky.__resolve(id, result);
        },
        { id: callbackId, result: payload }
      );
    }
    return null;
  });
  await context.addInitScript(() => {
    window.PuckyAndroid = {
      postMessage(raw) {
        window.__codexPuckyPostMessage(raw);
      }
    };
  });
}

export function attachPageLogging(page, consoleLogPath) {
  page.on("console", (message) => {
    fs.appendFileSync(consoleLogPath, `[console:${message.type()}] ${message.text()}\n`, "utf8");
  });
  page.on("pageerror", (error) => {
    fs.appendFileSync(consoleLogPath, `[pageerror] ${error.message}\n`, "utf8");
  });
}

export function writeAutomationError(reportDir, error) {
  ensureDir(reportDir);
  fs.writeFileSync(path.join(reportDir, "automation-error.txt"), `${error.stack || error.message}\n`, "utf8");
}
