import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FLY_ENV_CACHE = new Map();

function normalizeKey(value) {
  return String(value || "").trim();
}

function decodeValue(raw) {
  const text = String(raw || "");
  if (!text) {
    return "";
  }
  const quoted = text.match(/^(['"])([\s\S]*)\1$/);
  if (!quoted) {
    return text.trim();
  }
  const inner = quoted[2];
  if (quoted[1] === "'") {
    return inner;
  }
  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function resolveFlyctlBinary() {
  const explicit = normalizeKey(process.env.FLYCTL_BIN);
  if (explicit) {
    return explicit;
  }
  const bundled = path.join(String(process.env.HOME || ""), ".fly", "bin", "flyctl");
  if (bundled && fs.existsSync(bundled)) {
    return bundled;
  }
  return "flyctl";
}

export function readRepoDotEnv(options = {}) {
  const rootDir = path.resolve(String(options.rootDir || DEFAULT_ROOT));
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const payload = {};
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/);
    if (!match) {
      continue;
    }
    payload[match[1]] = decodeValue(match[2]);
  }
  return payload;
}

export function loadProofRuntimeEnv(options = {}) {
  const dotEnv = readRepoDotEnv(options);
  for (const [key, value] of Object.entries(dotEnv)) {
    if (!normalizeKey(process.env[key])) {
      process.env[key] = String(value || "");
    }
  }
  return dotEnv;
}

export function loadFlyEnvironment(options = {}) {
  const app = normalizeKey(options.app || "pucky") || "pucky";
  const rootDir = path.resolve(String(options.rootDir || DEFAULT_ROOT));
  const cacheKey = `${app}:${rootDir}`;
  if (FLY_ENV_CACHE.has(cacheKey)) {
    return FLY_ENV_CACHE.get(cacheKey);
  }
  const flyctl = resolveFlyctlBinary();
  const output = execFileSync(
    flyctl,
    ["ssh", "console", "-a", app, "--command", "env"],
    {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const payload = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) {
      continue;
    }
    payload[line.slice(0, index).trim()] = line.slice(index + 1);
  }
  FLY_ENV_CACHE.set(cacheKey, payload);
  return payload;
}

function firstPopulatedValue(keys, options = {}) {
  const env = options.env && typeof options.env === "object" ? options.env : process.env;
  const dotEnv = options.dotEnv && typeof options.dotEnv === "object" ? options.dotEnv : readRepoDotEnv(options);
  for (const key of keys) {
    const envValue = normalizeKey(env[key]);
    if (envValue) {
      return envValue;
    }
  }
  for (const key of keys) {
    const dotEnvValue = normalizeKey(dotEnv[key]);
    if (dotEnvValue) {
      return dotEnvValue;
    }
  }
  return "";
}

export function resolveWriteToken(options = {}) {
  const explicitToken = normalizeKey(options.explicitToken);
  if (explicitToken) {
    return explicitToken;
  }
  const envKeys = Array.isArray(options.envKeys)
    ? options.envKeys.map(normalizeKey).filter(Boolean)
    : [];
  const dotEnv = options.dotEnv && typeof options.dotEnv === "object"
    ? options.dotEnv
    : loadProofRuntimeEnv(options);
  const sharedKeys = ["PUCKY_OPERATOR_TOKEN", "PUCKY_API_TOKEN"];
  const resolved = firstPopulatedValue([...envKeys, ...sharedKeys], {
    ...options,
    dotEnv,
  });
  if (resolved) {
    return resolved;
  }
  if (typeof options.remoteEnvLoader === "function") {
    const remoteValue = options.remoteEnvLoader();
    if (typeof remoteValue === "string") {
      return normalizeKey(remoteValue);
    }
    if (remoteValue && typeof remoteValue === "object") {
      return firstPopulatedValue([...envKeys, ...sharedKeys], {
        ...options,
        env: remoteValue,
        dotEnv: {},
      });
    }
  }
  return "";
}
