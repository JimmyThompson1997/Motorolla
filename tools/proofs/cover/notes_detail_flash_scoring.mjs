export const NOTES_DETAIL_FLASH_RESULT_SCHEMA_V2 = "pucky.notes_detail_flash_browser_proof.v2";
export const NOTES_DETAIL_FLASH_VIEWPORT = Object.freeze({ width: 430, height: 932 });
export const NOTES_DETAIL_FLASH_FAIL_OPEN_MS = 1500;
export const NOTES_DETAIL_FLASH_TRACE_SAMPLE_LIMIT = 180;
export const NOTES_DETAIL_FLASH_CAPTURE_MAX_MS = 2000;
export const NOTES_DETAIL_FLASH_CAPTURE_MIN_MS = 750;
export const NOTES_DETAIL_FLASH_CAPTURE_AFTER_READY_MS = 150;
export const NOTES_DETAIL_FLASH_ROUTE_DELAY_MS = 120;
export const NOTES_DETAIL_FLASH_IFRAME_DELAY_MS = 450;
export const NOTES_DETAIL_FLASH_OFFSETS_MS = Object.freeze([0, 12, 24, 36, 48, 72, 96, 132, 180, 260]);
export const NOTES_DETAIL_FLASH_REQUIRED_PHASES = Object.freeze([
  "note_row_pointerdown",
  "note_row_click",
  "lightNavigate_start",
  "lightNavigate_state_set",
  "render_start",
  "note_detail_page_created",
  "note_detail_wrapper_created",
  "note_iframe_srcdoc_assigned",
  "note_iframe_load",
  "note_iframe_ready",
  "note_iframe_fail_open",
  "render_end",
]);
export const NOTES_DETAIL_FLASH_FAILURE_CATEGORIES = Object.freeze([
  "build_mismatch",
  "theme_cross_flash",
  "route_transition_flash",
  "iframe_transition_flash",
  "note_never_ready",
  "seed_note_missing",
  "instrumentation_gap",
  "console_error_during_transition",
]);
export const NOTES_DETAIL_FLASH_LANES = Object.freeze(["natural_click", "route_delay", "iframe_delay"]);
export const NOTES_DETAIL_FLASH_DARK_MEAN_LUMA_MAX = 0.65;
export const NOTES_DETAIL_FLASH_DARK_BRIGHT_PIXEL_RATIO_MAX = 0.35;
export const NOTES_DETAIL_FLASH_LIGHT_MEAN_LUMA_MIN = 0.35;
export const NOTES_DETAIL_FLASH_LIGHT_DARK_PIXEL_RATIO_MAX = 0.35;

export function buildScoreCrop(viewport = NOTES_DETAIL_FLASH_VIEWPORT) {
  const width = Math.max(1, Number(viewport?.width || 0));
  const height = Math.max(1, Number(viewport?.height || 0));
  return {
    x: 24,
    y: 120,
    width: Math.max(1, width - 48),
    height: Math.max(1, height - 240),
  };
}

function clampInteger(value, minimum, maximum) {
  const numeric = Math.round(Number(value || 0));
  if (!Number.isFinite(numeric)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, numeric));
}

function srgbChannelToLinear(value) {
  const normalized = Math.max(0, Math.min(255, Number(value || 0))) / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

export function lumaFromRgb(red, green, blue) {
  const linearRed = srgbChannelToLinear(red);
  const linearGreen = srgbChannelToLinear(green);
  const linearBlue = srgbChannelToLinear(blue);
  return Number((0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue).toFixed(6));
}

export function scoreRgbaImage({ rgba, width, height, crop = buildScoreCrop({ width, height }) }) {
  const pixels = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(Array.isArray(rgba) ? rgba : []);
  const imageWidth = Math.max(1, clampInteger(width, 1, Number.MAX_SAFE_INTEGER));
  const imageHeight = Math.max(1, clampInteger(height, 1, Number.MAX_SAFE_INTEGER));
  const cropX = clampInteger(crop?.x, 0, imageWidth - 1);
  const cropY = clampInteger(crop?.y, 0, imageHeight - 1);
  const cropWidth = clampInteger(crop?.width, 1, imageWidth - cropX);
  const cropHeight = clampInteger(crop?.height, 1, imageHeight - cropY);
  let totalLuma = 0;
  let maxLuma = 0;
  let minLuma = 1;
  let brightPixels = 0;
  let darkPixels = 0;
  let sampledPixels = 0;

  for (let y = cropY; y < cropY + cropHeight; y += 1) {
    for (let x = cropX; x < cropX + cropWidth; x += 1) {
      const index = ((y * imageWidth) + x) * 4;
      if (index + 2 >= pixels.length) {
        continue;
      }
      const luma = lumaFromRgb(pixels[index], pixels[index + 1], pixels[index + 2]);
      totalLuma += luma;
      maxLuma = Math.max(maxLuma, luma);
      minLuma = Math.min(minLuma, luma);
      if (luma >= 0.9) {
        brightPixels += 1;
      }
      if (luma <= 0.2) {
        darkPixels += 1;
      }
      sampledPixels += 1;
    }
  }

  const denominator = Math.max(1, sampledPixels);
  return {
    crop: {
      x: cropX,
      y: cropY,
      width: cropWidth,
      height: cropHeight,
    },
    pixel_count: sampledPixels,
    mean_luma: Number((totalLuma / denominator).toFixed(6)),
    max_luma: Number(maxLuma.toFixed(6)),
    min_luma: Number((sampledPixels ? minLuma : 0).toFixed(6)),
    bright_pixel_ratio: Number((brightPixels / denominator).toFixed(6)),
    dark_pixel_ratio: Number((darkPixels / denominator).toFixed(6)),
  };
}

export function classifyLaneMetrics({ theme, lane, metrics }) {
  const normalizedTheme = String(theme || "").trim().toLowerCase() === "light" ? "light" : "dark";
  const normalizedLane = NOTES_DETAIL_FLASH_LANES.includes(lane) ? lane : "natural_click";
  const categories = new Set();
  const failures = [];
  if (normalizedTheme === "dark") {
    if (Number(metrics?.mean_luma || 0) > NOTES_DETAIL_FLASH_DARK_MEAN_LUMA_MAX) {
      categories.add("theme_cross_flash");
      failures.push(`mean_luma>${NOTES_DETAIL_FLASH_DARK_MEAN_LUMA_MAX}`);
    }
    if (Number(metrics?.bright_pixel_ratio || 0) > NOTES_DETAIL_FLASH_DARK_BRIGHT_PIXEL_RATIO_MAX) {
      categories.add("theme_cross_flash");
      failures.push(`bright_pixel_ratio>${NOTES_DETAIL_FLASH_DARK_BRIGHT_PIXEL_RATIO_MAX}`);
    }
  } else {
    if (Number(metrics?.mean_luma || 0) < NOTES_DETAIL_FLASH_LIGHT_MEAN_LUMA_MIN) {
      categories.add("theme_cross_flash");
      failures.push(`mean_luma<${NOTES_DETAIL_FLASH_LIGHT_MEAN_LUMA_MIN}`);
    }
    if (Number(metrics?.dark_pixel_ratio || 0) > NOTES_DETAIL_FLASH_LIGHT_DARK_PIXEL_RATIO_MAX) {
      categories.add("theme_cross_flash");
      failures.push(`dark_pixel_ratio>${NOTES_DETAIL_FLASH_LIGHT_DARK_PIXEL_RATIO_MAX}`);
    }
  }
  if (categories.has("theme_cross_flash")) {
    categories.add(normalizedLane === "iframe_delay" ? "iframe_transition_flash" : "route_transition_flash");
  }
  return {
    ok: failures.length === 0,
    categories: Array.from(categories),
    failures,
  };
}

export function chooseWorstFrame(theme, scoredFrames = []) {
  const candidates = Array.isArray(scoredFrames) ? scoredFrames.filter(Boolean) : [];
  if (!candidates.length) {
    return null;
  }
  const normalizedTheme = String(theme || "").trim().toLowerCase() === "light" ? "light" : "dark";
  return candidates.reduce((worst, current) => {
    if (!worst) {
      return current;
    }
    const currentScore = Number(current?.score?.mean_luma ?? current?.mean_luma ?? 0);
    const worstScore = Number(worst?.score?.mean_luma ?? worst?.mean_luma ?? 0);
    if (normalizedTheme === "light") {
      return currentScore < worstScore ? current : worst;
    }
    return currentScore > worstScore ? current : worst;
  }, null);
}

export function orderedObservedPhases(trace = [], phases = NOTES_DETAIL_FLASH_REQUIRED_PHASES) {
  const allowed = new Set(phases);
  const seen = new Set();
  const ordered = [];
  for (const entry of Array.isArray(trace) ? trace : []) {
    const phase = String(entry?.phase || "").trim();
    if (!phase || seen.has(phase) || !allowed.has(phase)) {
      continue;
    }
    seen.add(phase);
    ordered.push(phase);
  }
  return ordered;
}
