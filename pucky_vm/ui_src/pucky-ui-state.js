window.PUCKY_UI_STATE = (() => {
  function normalizeTheme(value) {
    const theme = String(value || "").trim().toLowerCase();
    return theme === "light" || theme === "dark" ? theme : "";
  }

  function persistTheme(theme, options = {}) {
    const themeStateKey = String(options.themeStateKey || "pucky.cover.theme.v1");
    const normalize = typeof options.normalizeTheme === "function" ? options.normalizeTheme : normalizeTheme;
    try {
      localStorage.setItem(themeStateKey, normalize(theme) || "dark");
    } catch (_) {
      // Theme persistence is a visual preference and should never block boot.
    }
  }

  function resolveInitialTheme(options = {}) {
    const themeStateKey = String(options.themeStateKey || "pucky.cover.theme.v1");
    const normalize = typeof options.normalizeTheme === "function" ? options.normalizeTheme : normalizeTheme;
    const persist = typeof options.persistTheme === "function" ? options.persistTheme : persistTheme;
    const params = new URLSearchParams(window.location.search || "");
    const queryTheme = normalize(params.get("theme"));
    if (queryTheme) {
      persist(queryTheme, { themeStateKey, normalizeTheme: normalize });
      return queryTheme;
    }
    try {
      return normalize(localStorage.getItem(themeStateKey)) || "dark";
    } catch (_) {
      return "dark";
    }
  }

  function resolveBrowserApiToken(options = {}) {
    const tokenStateKey = String(options.tokenStateKey || "pucky.cover.browser_api_token.v1");
    try {
      const params = new URLSearchParams(window.location.search || "");
      const queryToken = String(params.get("api_token") || "").trim();
      if (queryToken) {
        localStorage.setItem(tokenStateKey, queryToken);
        return queryToken;
      }
      return String(localStorage.getItem(tokenStateKey) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function resolveBrowserDeviceId(options = {}) {
    const deviceStateKey = String(options.deviceStateKey || "pucky.cover.browser_device_id.v1");
    try {
      const params = new URLSearchParams(window.location.search || "");
      const queryDeviceId = String(params.get("device_id") || "").trim();
      if (queryDeviceId) {
        localStorage.setItem(deviceStateKey, queryDeviceId);
        return queryDeviceId;
      }
      return String(localStorage.getItem(deviceStateKey) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function resolveBrowserApiBaseUrl(options = {}) {
    const defaultApiBaseUrl = String(options.defaultApiBaseUrl || "").trim().replace(/\/$/, "");
    try {
      const params = new URLSearchParams(window.location.search || "");
      const queryApiBaseUrl = String(params.get("api_base_url") || params.get("apiBase") || "").trim().replace(/\/$/, "");
      if (queryApiBaseUrl) {
        return queryApiBaseUrl;
      }
    } catch (_) {
      return defaultApiBaseUrl;
    }
    const config = window.PUCKY_CONFIG && typeof window.PUCKY_CONFIG === "object"
      ? window.PUCKY_CONFIG
      : null;
    const configApiBaseUrl = String(config && config.api_base_url || "").trim().replace(/\/$/, "");
    if (configApiBaseUrl) {
      return configApiBaseUrl;
    }
    const bundleConfig = window.PUCKY_BUNDLE_CONFIG && typeof window.PUCKY_BUNDLE_CONFIG === "object"
      ? window.PUCKY_BUNDLE_CONFIG
      : null;
    const bundleApiBaseUrl = String(bundleConfig && bundleConfig.api_base_url || "").trim().replace(/\/$/, "");
    if (bundleApiBaseUrl) {
      return bundleApiBaseUrl;
    }
    return defaultApiBaseUrl;
  }

  function shouldResetNavState() {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return params.get("reset_nav") === "1";
    } catch (_) {
      return false;
    }
  }

  function loadNavState(options = {}) {
    const navStateKey = String(options.navStateKey || "pucky.cover.nav_state.v1");
    const shouldReset = typeof options.shouldResetNavState === "function" ? options.shouldResetNavState : shouldResetNavState;
    try {
      if (shouldReset()) {
        localStorage.removeItem(navStateKey);
        return {};
      }
      const parsed = JSON.parse(localStorage.getItem(navStateKey) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function syncThemeQueryParam(theme, options = {}) {
    const normalize = typeof options.normalizeTheme === "function" ? options.normalizeTheme : normalizeTheme;
    try {
      const url = new URL(window.location.href || "");
      url.searchParams.set("theme", normalize(theme) || "dark");
      window.history.replaceState(window.history.state || null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {
      // Query param sync should help reload parity without blocking the page.
    }
  }

  return Object.freeze({
    loadNavState,
    normalizeTheme,
    persistTheme,
    resolveBrowserApiBaseUrl,
    resolveBrowserApiToken,
    resolveBrowserDeviceId,
    resolveInitialTheme,
    shouldResetNavState,
    syncThemeQueryParam,
  });
})();
