window.PUCKY_UI_BROWSER_STATE = (() => {
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
    resolveBrowserApiToken,
    resolveBrowserDeviceId,
    resolveInitialTheme,
    shouldResetNavState,
    syncThemeQueryParam,
  });
})();
