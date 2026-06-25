window.PUCKY_UI_ROUTES = {
  LIGHT_APPS: [
    { route: "inbox", label: "Inbox", semantic: "inbox", kind: "real" },
    { route: "meetings", label: "Meetings", semantic: "meetings", kind: "real" },
    { route: "meeting-notes", label: "Meeting Notes", semantic: "meeting_notes", kind: "real" },
    { route: "reminders", label: "Reminders", semantic: "reminders", kind: "real" },
    { route: "notes", label: "Notes", semantic: "notes", kind: "real" },
    { route: "tasks", label: "Tasks", semantic: "tasks", kind: "real" },
    { route: "calendar", label: "Calendar", semantic: "calendar", kind: "real" },
    { route: "projects", label: "Projects", semantic: "projects", kind: "real" },
    { route: "contacts", label: "Contacts", semantic: "contacts", kind: "real" },
    { route: "connect", label: "Connect", semantic: "connect", kind: "real" },
    { route: "settings", label: "Settings", semantic: "settings", kind: "real" }
  ],
  LIGHT_ROUTES: [
    "home",
    "inbox-detail",
    "notes",
    "note-detail",
    "tasks",
    "task-detail",
    "calendar",
    "meeting-detail",
    "meeting-notes",
    "meeting-note-detail",
    "reminders",
    "reminder-detail",
    "projects",
    "project-detail",
    "contacts",
    "contact-detail"
  ],
  HOME_SHELL_CANONICAL_ROUTES: ["inbox", "connect", "meetings", "settings"],
  LIGHT_ROUTE_PARENTS: {
    "inbox-detail": "inbox",
    "note-detail": "notes",
    "task-detail": "tasks",
    "meeting-detail": "calendar",
    "meeting-note-detail": "meeting-notes",
    "reminder-detail": "reminders",
    "project-detail": "projects",
    "contact-detail": "contacts"
  },
  ROUTE_ALIASES: {},
  WORKSPACE_ROUTE_COLLECTIONS: {
    "inbox-detail": "feed-items",
    notes: "notes",
    "note-detail": "notes",
    tasks: "tasks",
    "task-detail": "tasks",
    calendar: "calendar-events",
    "meeting-detail": "calendar-events",
    "meeting-notes": "meeting-notes",
    "meeting-note-detail": "meeting-notes",
    reminders: "reminders",
    "reminder-detail": "reminders",
    projects: "projects",
    "project-detail": "projects",
    contacts: "contacts",
    "contact-detail": "contacts"
  },
  WORKSPACE_COLLECTION_LABELS: {
    notes: "Notes",
    tasks: "Tasks",
    "calendar-events": "Calendar",
    "feed-items": "Feed",
    projects: "Projects",
    contacts: "Contacts",
    "meeting-notes": "Meeting Notes",
    reminders: "Reminders"
  },
  WORKSPACE_KIND_COLLECTIONS: {
    note: "notes",
    task: "tasks",
    calendar_event: "calendar-events",
    feed_item: "feed-items",
    project: "projects",
    contact: "contacts",
    meeting_note: "meeting-notes",
    reminder: "reminders"
  },
  DEFAULT_HOME_MENU_ICONS: [
    { key: "book", icon: "book", label: "Audiobooks", accent: "#72c2ff" }
  ]
};
