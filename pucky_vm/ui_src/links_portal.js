(function () {
  const config = window.PuckyLinksConfig || {};
  const state = {
    apps: [],
    statuses: {},
    filter: "all",
    search: "",
    connecting: ""
  };

  const listEl = document.getElementById("portalList");
  const emptyEl = document.getElementById("portalEmpty");
  const noticeEl = document.getElementById("portalNotice");
  const searchEl = document.getElementById("searchInput");

  document.querySelectorAll(".links-filter").forEach(button => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter || "all";
      document.querySelectorAll(".links-filter").forEach(item => item.classList.toggle("is-active", item === button));
      render();
    });
  });

  searchEl?.addEventListener("input", () => {
    state.search = String(searchEl.value || "").trim().toLowerCase();
    render();
  });

  boot();

  async function boot() {
    try {
      const [apps, status] = await Promise.all([
        getJson("/api/links/apps"),
        getJson("/api/links/status")
      ]);
      state.apps = Array.isArray(apps.apps) ? apps.apps : [];
      state.statuses = status.statuses && typeof status.statuses === "object" ? status.statuses : {};
      render();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Unable to load links right now.");
    }
  }

  function render() {
    const visible = state.apps.filter(app => matchesFilter(app) && matchesSearch(app));
    emptyEl.hidden = visible.length > 0;
    listEl.replaceChildren(...visible.map(cardView));
  }

  function matchesFilter(app) {
    const connected = Boolean(state.statuses[app.name]);
    if (state.filter === "connected") return connected;
    if (state.filter === "needs_setup") return !connected;
    return true;
  }

  function matchesSearch(app) {
    if (!state.search) return true;
    const haystack = `${app.name} ${app.description || ""}`.toLowerCase();
    return haystack.includes(state.search);
  }

  function cardView(app) {
    const connected = Boolean(state.statuses[app.name]);
    const action = document.createElement("button");
    action.className = `links-card-action${connected ? " is-secondary" : ""}`;
    action.type = "button";
    action.textContent = state.connecting === app.name ? "Opening..." : connected ? "Connected" : "Connect";
    action.disabled = state.connecting === app.name;
    action.addEventListener("click", () => connectApp(app.name));

    const card = div("links-card");
    const copy = div("links-card-copy");
    const meta = div("links-card-meta");
    meta.append(
      chip(connected ? "Connected" : "Needs setup", connected ? "is-connected" : "is-needs-setup"),
      chip(app.auth_needed ? "OAuth" : "No auth")
    );
    copy.append(
      textEl("h2", "links-card-title", app.name),
      textEl("p", "links-card-summary", app.description || "Klavis managed app connection."),
      meta
    );
    card.append(copy, action);
    return card;
  }

  async function connectApp(serverName) {
    try {
      state.connecting = serverName;
      render();
      const payload = await postJson("/api/links/connect", {
        server_name: serverName,
        return_to: config.returnTo || ""
      });
      if (payload.oauth_url) {
        window.top.location.href = payload.oauth_url;
        return;
      }
      throw new Error("Klavis did not return an auth URL.");
    } catch (error) {
      state.connecting = "";
      render();
      showNotice(error instanceof Error ? error.message : "Unable to start the connection flow.");
    }
  }

  function showNotice(message) {
    noticeEl.hidden = false;
    noticeEl.textContent = message;
  }

  function requestHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (config.token) {
      headers["X-Pucky-Links-Token"] = config.token;
    }
    return headers;
  }

  async function getJson(path) {
    const response = await fetch(path, {
      cache: "no-store",
      headers: requestHeaders()
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  }

  async function postJson(path, body) {
    const response = await fetch(path, {
      method: "POST",
      cache: "no-store",
      headers: requestHeaders(),
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  }

  function div(className) {
    const node = document.createElement("div");
    node.className = className;
    return node;
  }

  function textEl(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function chip(label, extraClass) {
    const node = document.createElement("span");
    node.className = `links-chip${extraClass ? ` ${extraClass}` : ""}`;
    node.textContent = label;
    return node;
  }
})();
