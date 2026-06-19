(() => {
  const KIND_ORDER = [
    "meeting_note",
    "calendar_event",
    "task",
    "note",
    "project",
    "contact",
    "reminder",
    "feed_item",
  ];

  const KIND_META = {
    meeting_note: { label: "Meeting Notes", singular: "Meeting Note", collection: "meeting-notes" },
    calendar_event: { label: "Calendar Events", singular: "Calendar Event", collection: "calendar-events" },
    task: { label: "Tasks", singular: "Task", collection: "tasks" },
    note: { label: "Notes", singular: "Note", collection: "notes" },
    project: { label: "Projects", singular: "Project", collection: "projects" },
    contact: { label: "Contacts", singular: "Contact", collection: "contacts" },
    reminder: { label: "Reminders", singular: "Reminder", collection: "reminders" },
    feed_item: { label: "Feed Items", singular: "Feed Item", collection: "feed-items" },
  };

  const COLLECTION_TO_KIND = Object.fromEntries(
    Object.entries(KIND_META).map(([kind, meta]) => [meta.collection, kind]),
  );

  const LOGICAL_MODEL = {
    meeting_note: {
      summary: "Bridge record that turns a conversation or scheduled event into structured memory and follow-up.",
      fields: [
        { label: "Title", meta: "short meeting label" },
        { label: "Summary", meta: "what happened" },
        { label: "Date / Time", meta: "when it occurred" },
        { label: "Source Event", meta: "origin calendar event, if any" },
        { label: "Participants", meta: "people named in the room or transcript" },
        { label: "HTML / Transcript", meta: "full body detail" },
      ],
      contains: [
        { label: "Participant list", meta: "named people" },
        { label: "Extracted topics", meta: "themes and subjects" },
        { label: "Action items", meta: "raw follow-up before formal tasks" },
        { label: "Decisions", meta: "what got agreed" },
        { label: "Source pointers", meta: "back to the originating event" },
      ],
      connects: ["calendar_event", "contact", "project", "task", "note", "reminder"],
      produces: ["task", "note", "reminder"],
    },
    calendar_event: {
      summary: "Anchor record for something happening at a time, often the spine that meeting notes, reminders, contacts, and project context hang off.",
      fields: [
        { label: "Title", meta: "event label" },
        { label: "Summary", meta: "brief context" },
        { label: "Date", meta: "day anchor" },
        { label: "Start / End", meta: "time window" },
        { label: "Place", meta: "where it happens" },
        { label: "Attendees / Type", meta: "who and what kind of event" },
      ],
      contains: [
        { label: "Attendee list", meta: "who is expected" },
        { label: "Location context", meta: "place or channel" },
        { label: "Scheduling window", meta: "timing details" },
        { label: "Event type", meta: "meeting, personal, health, family, and so on" },
      ],
      connects: ["contact", "project", "task", "meeting_note", "note", "reminder"],
      produces: ["meeting_note", "task", "note", "reminder"],
    },
    task: {
      summary: "Action record that can stand alone or be born from a project, contact, meeting, note, or event.",
      fields: [
        { label: "Title", meta: "the action itself" },
        { label: "Summary", meta: "why it matters" },
        { label: "Status", meta: "todo, in progress, waiting, done" },
        { label: "Due Time", meta: "when it needs attention" },
        { label: "Owner", meta: "who should move it" },
        { label: "Checklist", meta: "smaller steps inside the task" },
      ],
      contains: [
        { label: "Checklist items", meta: "substeps" },
        { label: "Ownership", meta: "owner and creator" },
        { label: "Source pointer", meta: "where the task came from" },
        { label: "Project tag", meta: "which effort it belongs to" },
      ],
      connects: ["project", "note", "contact", "calendar_event", "meeting_note", "reminder"],
      produces: ["reminder", "feed_item", "note"],
    },
    note: {
      summary: "General-purpose memory record that can hold context, decisions, scraps, and supporting detail for almost anything else.",
      fields: [
        { label: "Title", meta: "note name" },
        { label: "Summary", meta: "one-line gist" },
        { label: "Pinned State", meta: "whether it should stay prominent" },
        { label: "Context Tag", meta: "where it belongs" },
        { label: "HTML / Asset", meta: "rich body or external document" },
      ],
      contains: [
        { label: "Freeform body", meta: "the actual note content" },
        { label: "Context labels", meta: "what area it belongs to" },
        { label: "Attachments or assets", meta: "linked document detail" },
      ],
      connects: ["task", "project", "contact", "calendar_event", "meeting_note", "reminder"],
      produces: ["task", "reminder"],
    },
    project: {
      summary: "Umbrella record that groups people, tasks, notes, meetings, and timeline context around one ongoing effort.",
      fields: [
        { label: "Title", meta: "project name" },
        { label: "Summary", meta: "what the effort is about" },
        { label: "Threads", meta: "conversation buckets" },
        { label: "Assets", meta: "linked materials" },
        { label: "Chips / Tags", meta: "lightweight status or people markers" },
      ],
      contains: [
        { label: "Thread names", meta: "conversation handles" },
        { label: "Assets list", meta: "docs and working material" },
        { label: "Stakeholder chips", meta: "people or state tags" },
      ],
      connects: ["task", "note", "contact", "calendar_event", "meeting_note", "reminder", "feed_item"],
      produces: ["task", "note", "meeting_note", "reminder", "feed_item"],
    },
    contact: {
      summary: "Person or org node that can own work, appear in meetings, sit on calendar events, and gather notes and project context around them.",
      fields: [
        { label: "Name", meta: "display identity" },
        { label: "Summary", meta: "role or relationship" },
        { label: "Email", meta: "primary email channel" },
        { label: "Phone", meta: "primary phone channel" },
        { label: "Endpoints", meta: "other contact handles" },
        { label: "Activity", meta: "recent touchpoints" },
      ],
      contains: [
        { label: "Endpoints list", meta: "Slack, email, phone, and more" },
        { label: "Activity history", meta: "recent interactions" },
        { label: "Avatar / photo", meta: "identity cues" },
      ],
      connects: ["task", "note", "project", "calendar_event", "meeting_note", "reminder", "feed_item"],
      produces: ["task", "note", "calendar_event", "meeting_note"],
    },
    reminder: {
      summary: "Delivery layer for nudges, usually attached to another object rather than living as the root source of truth.",
      fields: [
        { label: "Title", meta: "the nudge itself" },
        { label: "Summary", meta: "why this reminder exists" },
        { label: "Status", meta: "open or done" },
        { label: "Due Time", meta: "when to fire" },
        { label: "Recipients", meta: "who should get it" },
        { label: "Destinations", meta: "where it should go" },
      ],
      contains: [
        { label: "Recipient list", meta: "self or contacts" },
        { label: "Destination channels", meta: "notification targets" },
        { label: "Snooze state", meta: "delivery timing control" },
        { label: "Source pointer", meta: "the parent object it belongs to" },
      ],
      connects: ["task", "note", "calendar_event", "meeting_note", "contact", "project"],
      produces: ["feed_item"],
    },
    feed_item: {
      summary: "Readout record that reflects something that happened elsewhere, like a change, completion, or update.",
      fields: [
        { label: "Title", meta: "event label" },
        { label: "Summary", meta: "what changed" },
        { label: "Event Time", meta: "when the update happened" },
        { label: "Icon", meta: "display hint" },
        { label: "Type", meta: "kind of update" },
      ],
      contains: [
        { label: "Event metadata", meta: "small type or source hints" },
        { label: "Display HTML", meta: "renderable body detail" },
        { label: "Source reference", meta: "what object generated the update" },
      ],
      connects: ["project", "task", "note", "calendar_event", "contact", "reminder", "meeting_note"],
      produces: [],
    },
  };

  const state = {
    focusKind: initialFocusKind(),
    summary: null,
  };

  const dom = {
    refreshButton: document.getElementById("refreshGraph"),
    sourceLine: document.getElementById("sourceLine"),
    kindCards: document.getElementById("kindCards"),
  };

  ensurePuckyBridge();
  dom.refreshButton.addEventListener("click", () => {
    loadAndRender();
  });
  loadAndRender();

  function initialFocusKind() {
    const params = new URLSearchParams(window.location.search || "");
    return String(params.get("focus") || "").trim() || "meeting_note";
  }

  async function loadAndRender() {
    setSourceLine("Loading logical workspace shape...");
    try {
      const apiConfig = await resolveApiConfig();
      const counts = await fetchWorkspaceCounts(apiConfig);
      state.summary = summarizeModel(counts, apiConfig.apiToken);
      render();
      setSourceLine(
        `${state.summary.sourceLabel} • ${state.summary.totalKinds} kinds • ${state.summary.totalRecords} live records`,
      );
    } catch (error) {
      renderError(error);
      setSourceLine("Workspace shape could not load");
    }
  }

  function ensurePuckyBridge() {
    if (window.Pucky && typeof window.Pucky.request === "function" && typeof window.Pucky.__resolve === "function") {
      return;
    }
    const pending = new Map();
    let seq = 0;
    window.Pucky = {
      request(payload) {
        const command = payload && payload.command;
        const args = payload && payload.args ? payload.args : {};
        if (!(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function")) {
          return Promise.reject(new Error("Pucky native bridge unavailable"));
        }
        const id = String(++seq);
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          window.PuckyAndroid.postMessage(JSON.stringify({ id, command, args }));
          window.setTimeout(() => {
            if (!pending.has(id)) {
              return;
            }
            pending.delete(id);
            reject(new Error("Pucky native bridge timed out"));
          }, 15000);
        });
      },
      __resolve(id, payload) {
        const slot = pending.get(String(id));
        if (!slot) {
          return;
        }
        pending.delete(String(id));
        if (payload && payload.ok) {
          slot.resolve(payload.result || {});
          return;
        }
        slot.reject(new Error(String(payload && (payload.detail || payload.error) || "Native bridge failed")));
      },
    };
  }

  async function resolveApiConfig() {
    const params = new URLSearchParams(window.location.search || "");
    let apiBase = String(params.get("apiBase") || "").trim().replace(/\/$/, "");
    let apiToken = String(params.get("token") || "").trim();

    if (!apiBase && window.location && /^https?:$/i.test(window.location.protocol || "")) {
      apiBase = String(window.location.origin || "").replace(/\/$/, "");
    }

    if ((!apiBase || !apiToken) && window.Pucky && typeof window.Pucky.request === "function") {
      try {
        const config = await window.Pucky.request({ command: "pucky.config.get", args: {} });
        apiBase = apiBase || String(config && config.api_base_url || "").replace(/\/$/, "");
        apiToken = apiToken || String(config && config.api_token || "");
      } catch (_) {
        // Local public-read surfaces can still work.
      }
    }

    return {
      apiBase: apiBase || "https://pucky.fly.dev",
      apiToken,
    };
  }

  async function fetchWorkspaceCounts(apiConfig) {
    const catalog = await fetchJson(`${apiConfig.apiBase}/api/workspace/`, apiConfig.apiToken);
    const collections = Array.isArray(catalog && catalog.collections) ? catalog.collections : [];
    const wanted = collections.filter(collection => COLLECTION_TO_KIND[collection]);
    const payloads = await Promise.all(
      wanted.map(collection => fetchJson(`${apiConfig.apiBase}/api/workspace/${encodeURIComponent(collection)}?limit=200`, apiConfig.apiToken)),
    );
    const counts = {};
    payloads.forEach((payload, index) => {
      counts[wanted[index]] = Array.isArray(payload && payload.items) ? payload.items.length : 0;
    });
    return counts;
  }

  async function fetchJson(url, token) {
    const headers = { Accept: "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, { cache: "no-store", headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(String(payload && (payload.detail || payload.error) || `Request failed (${response.status})`));
    }
    return payload;
  }

  function summarizeModel(countsByCollection, hasToken) {
    const kinds = KIND_ORDER
      .filter(kind => LOGICAL_MODEL[kind] && KIND_META[kind])
      .map(kind => {
        const meta = KIND_META[kind];
        const model = LOGICAL_MODEL[kind];
        return {
          kind,
          label: meta.label,
          singular: meta.singular,
          count: Number(countsByCollection[meta.collection] || 0),
          summary: model.summary,
          fields: model.fields,
          contains: model.contains,
          connects: model.connects.map(targetKind => ({
            label: KIND_META[targetKind] ? KIND_META[targetKind].label : niceLabel(targetKind),
            meta: "logical relationship",
          })),
          produces: model.produces.map(targetKind => ({
            label: KIND_META[targetKind] ? KIND_META[targetKind].label : niceLabel(targetKind),
            meta: "possible byproduct",
          })),
        };
      })
      .sort((left, right) => {
        if (left.kind === state.focusKind) {
          return -1;
        }
        if (right.kind === state.focusKind) {
          return 1;
        }
        return kindSort(left.kind, right.kind);
      });

    return {
      sourceLabel: hasToken ? "Logical model with live counts" : "Logical model with public live counts",
      totalKinds: kinds.length,
      totalRecords: kinds.reduce((sum, kind) => sum + kind.count, 0),
      kinds,
    };
  }

  function render() {
    if (!state.summary || !state.summary.kinds.length) {
      dom.kindCards.innerHTML = `<div class="empty-state">No workspace kinds were found.</div>`;
      return;
    }

    dom.kindCards.innerHTML = state.summary.kinds.map(kind => `
      <article class="kind-card${kind.kind === state.focusKind ? " is-focused" : ""}" data-kind="${kind.kind}">
        <div class="kind-card-header">
          <div>
            <p class="kind-kicker">${escapeHtml(kind.singular)}</p>
            <h2 class="kind-title">${escapeHtml(kind.label)}</h2>
          </div>
          <div class="count-pill">${kind.count} live</div>
        </div>

        <p class="kind-summary">${escapeHtml(kind.summary)}</p>

        <section class="group">
          <p class="group-label">Main Fields</p>
          <div class="tile-row">
            ${renderTiles(kind.fields)}
          </div>
        </section>

        <section class="group">
          <p class="group-label">Can Contain</p>
          <div class="tile-row">
            ${renderTiles(kind.contains)}
          </div>
        </section>

        <section class="group">
          <p class="group-label">Can Connect To</p>
          <div class="tile-row">
            ${renderSimpleTiles(kind.connects, "No logical connections defined yet.")}
          </div>
        </section>

        <section class="group">
          <p class="group-label">Can Lead To</p>
          <div class="tile-row">
            ${renderSimpleTiles(kind.produces, "Usually not a record-generator on its own.")}
          </div>
        </section>
      </article>
    `).join("");

    Array.from(dom.kindCards.querySelectorAll("[data-kind]")).forEach(card => {
      card.addEventListener("click", () => {
        const kind = card.getAttribute("data-kind") || "";
        if (!kind || kind === state.focusKind) {
          return;
        }
        state.focusKind = kind;
        syncFocusParam(kind);
        render();
        scrollFocusedCard();
      });
    });
  }

  function renderTiles(items) {
    if (!items.length) {
      return `<div class="empty-state">Nothing listed here yet.</div>`;
    }
    return items.map(item => `
      <div class="tile">
        <span class="tile-title">${escapeHtml(item.label)}</span>
        <span class="tile-meta">${escapeHtml(item.meta)}</span>
      </div>
    `).join("");
  }

  function renderSimpleTiles(items, emptyText) {
    if (!items.length) {
      return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    }
    return items.map(item => `
      <div class="tile is-small">
        <span class="tile-title">${escapeHtml(item.label)}</span>
        <span class="tile-meta">${escapeHtml(item.meta)}</span>
      </div>
    `).join("");
  }

  function renderError(error) {
    dom.kindCards.innerHTML = `
      <div class="empty-state error-card">
        ${escapeHtml(String(error && error.message || error || "Unknown error"))}
      </div>
    `;
  }

  function kindSort(left, right) {
    const leftIndex = KIND_ORDER.indexOf(left);
    const rightIndex = KIND_ORDER.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) {
        return 1;
      }
      if (rightIndex === -1) {
        return -1;
      }
      return leftIndex - rightIndex;
    }
    return String(left || "").localeCompare(String(right || ""));
  }

  function niceLabel(value) {
    return String(value || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function syncFocusParam(kind) {
    const url = new URL(window.location.href);
    url.searchParams.set("focus", kind);
    window.history.replaceState({}, "", url.toString());
  }

  function scrollFocusedCard() {
    const card = dom.kindCards.querySelector(`[data-kind="${CSS.escape(state.focusKind)}"]`);
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function setSourceLine(text) {
    dom.sourceLine.textContent = text;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
