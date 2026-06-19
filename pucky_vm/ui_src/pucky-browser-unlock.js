window.PUCKY_UI_BROWSER_UNLOCK = (() => {
  function isBrowserPreviewSurface() {
    return !Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");
  }

  function workspacePreviewLockDetail(collection, options = {}) {
    const labelForCollection = typeof options.collectionLabel === "function"
      ? options.collectionLabel
      : (value => String(value || "workspace records"));
    return `Web preview is locked. Use Unlock web preview to load live ${labelForCollection(collection)} from the VM in this browser.`;
  }

  function storeBrowserApiToken(token, options = {}) {
    const tokenStateKey = String(options.tokenStateKey || "pucky.cover.browser_api_token.v1");
    const clean = String(token || "").trim();
    try {
      localStorage.setItem(tokenStateKey, clean);
    } catch (_) {
      // Browser preview auth is best-effort persistence only.
    }
  }

  function clearStoredBrowserApiToken(options = {}) {
    const tokenStateKey = String(options.tokenStateKey || "pucky.cover.browser_api_token.v1");
    try {
      localStorage.removeItem(tokenStateKey);
    } catch (_) {
      // Browser preview auth is best-effort persistence only.
    }
  }

  function openBrowserUnlockSheet(options = {}) {
    const state = options.state && typeof options.state === "object" ? options.state : { links: { apiToken: "" } };
    const doc = options.document || document;
    const el = typeof options.el === "function"
      ? options.el
      : (tag, className = "", text = "") => {
        const node = doc.createElement(tag);
        if (className) {
          node.className = className;
        }
        if (text !== "") {
          node.textContent = text;
        }
        return node;
      };
    const closeSettingsSelector = typeof options.closeSettingsSelector === "function" ? options.closeSettingsSelector : (() => {});
    const dismissAdvancedSettingsSheet = typeof options.dismissAdvancedSettingsSheet === "function"
      ? options.dismissAdvancedSettingsSheet
      : (() => {});
    const openOverlay = typeof options.openOverlay === "function" ? options.openOverlay : (() => null);
    const saveBrowserPreviewToken = typeof options.saveBrowserPreviewToken === "function"
      ? options.saveBrowserPreviewToken
      : (async () => {});
    const clearBrowserPreviewToken = typeof options.clearBrowserPreviewToken === "function"
      ? options.clearBrowserPreviewToken
      : (async () => {});

    closeSettingsSelector();
    dismissAdvancedSettingsSheet();
    const sheet = el("div", "settings-selector-sheet browser-unlock-sheet");
    sheet.addEventListener("click", event => event.stopPropagation());
    sheet.append(el("h1", "settings-selector-title", "Unlock web preview"));
    sheet.append(el("p", "browser-unlock-copy", "Save a browser token in this browser so the VM-served dashboard can load your live data."));
    const status = el(
      "p",
      "browser-unlock-status",
      state.links.apiToken ? "Saved token active in this browser." : "No saved browser token yet."
    );
    const input = doc.createElement("input");
    input.type = "password";
    input.className = "browser-unlock-input";
    input.placeholder = "Paste PUCKY_WEB_UI_TOKEN";
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    const error = el("p", "browser-unlock-error", "");
    const note = el("p", "browser-unlock-note", "Pucky stores this token only in this browser's local storage.");
    const actions = el("div", "browser-unlock-actions");
    const saveButton = el(
      "button",
      "settings-action-button browser-unlock-button-primary",
      state.links.apiToken ? "Update token" : "Save token"
    );
    const clearButton = el("button", "settings-action-button", "Clear saved token");
    const cancelButton = el("button", "settings-action-button", "Cancel");
    saveButton.type = "button";
    clearButton.type = "button";
    cancelButton.type = "button";
    clearButton.hidden = !state.links.apiToken;

    const setBusy = (busy, message = "") => {
      saveButton.disabled = busy;
      clearButton.disabled = busy;
      cancelButton.disabled = busy;
      input.disabled = busy;
      if (message) {
        status.textContent = message;
      } else {
        status.textContent = state.links.apiToken ? "Saved token active in this browser." : "No saved browser token yet.";
      }
    };

    const save = async () => {
      const candidate = String(input.value || "").trim();
      if (!candidate) {
        error.textContent = "Paste PUCKY_WEB_UI_TOKEN.";
        input.focus();
        return;
      }
      error.textContent = "";
      setBusy(true, "Checking browser token...");
      try {
        await saveBrowserPreviewToken(candidate);
        closeSettingsSelector();
      } catch (saveError) {
        error.textContent = String(saveError && saveError.message || saveError || "Could not save the browser token.");
      } finally {
        setBusy(false);
      }
    };

    const clear = async () => {
      error.textContent = "";
      setBusy(true, "Clearing saved browser token...");
      try {
        await clearBrowserPreviewToken();
        closeSettingsSelector();
      } catch (clearError) {
        error.textContent = String(clearError && clearError.message || clearError || "Could not clear the browser token.");
      } finally {
        setBusy(false);
      }
    };

    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        void save();
      }
    });
    saveButton.addEventListener("click", () => {
      void save();
    });
    clearButton.addEventListener("click", () => {
      void clear();
    });
    cancelButton.addEventListener("click", event => {
      event.preventDefault();
      closeSettingsSelector();
    });

    actions.append(saveButton, clearButton, cancelButton);
    sheet.append(status, input, error, note, actions);
    openOverlay("settingsSelectorOverlay", sheet, closeSettingsSelector);
    window.setTimeout(() => input.focus(), 0);
  }

  return Object.freeze({
    clearStoredBrowserApiToken,
    isBrowserPreviewSurface,
    openBrowserUnlockSheet,
    storeBrowserApiToken,
    workspacePreviewLockDetail,
  });
})();
