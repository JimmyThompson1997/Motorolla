# Agent Runtime Plan

## Summary

This document captures the current plan for exposing the Codex app-server runtime
control plane to the internal agent without changing the user-facing Pucky control
plane.

The guiding idea is:

- keep the existing Pucky HTTP/UI plane user-focused
- expose a separate internal-only `agent.runtime.*` plane for self-referential agent work
- use the raw Codex app-server method names as the canonical runtime actions
- keep discovery and dispatch as simple as possible

The current preferred shape is:

- one discovery call: `agent.runtime.catalog`
- one generic dispatcher: `agent.runtime.call`
- one generated local catalog file as the source of truth

## Core Decisions

### 1. Separation of planes

Do not mix this into the user-facing Pucky control plane.

- Pucky plane: user/product actions
- agent runtime plane: internal thread/runtime/session control for the agent only

This keeps the user-facing API simple while still letting the agent inspect and
control Codex runtimes directly.

### 2. Canonical method naming

Use raw Codex app-server method names exactly as they already exist.

Do not add friendly aliases like `start_agent` or `rename_thread`.

Examples:

- `initialize`
- `thread/start`
- `thread/resume`
- `thread/fork`
- `thread/list`
- `thread/loaded/list`
- `thread/read`
- `thread/name/set`
- `thread/archive`
- `thread/unarchive`
- `thread/compact/start`
- `thread/rollback`
- `thread/metadata/update`
- `thread/unsubscribe`
- `turn/start`
- `turn/steer`
- `turn/interrupt`
- `review/start`

### 3. Discovery model

The simplest durable setup is a hybrid:

- source of truth: one generated local catalog file
- agent-facing discovery: `agent.runtime.catalog`
- execution: `agent.runtime.call`

This avoids:

- a giant prompt inventory
- a large custom HTTP wrapper surface
- manual duplication of the Codex runtime method list

### 4. Transport model

Do not create a second per-method REST API if it can be avoided.

Instead:

- `agent.runtime.catalog` returns the generated method inventory
- `agent.runtime.call` forwards raw method name + params onto the existing Codex app-server transport

`initialize` should remain part of the catalog and the callable surface, but the
bridge may still auto-run it when needed for a fresh connection.

## Runtime Catalog Contents

Each catalog entry should include only the minimum useful shape:

- raw method name
- short purpose
- param summary
- required vs optional fields
- one minimal example
- whether it is a lifecycle, read, mutation, or streaming-style action

The catalog should be generated from the actual app-server schema/types so it
stays aligned with the real runtime instead of becoming hand-maintained docs.

## What Codex Already Passes Today

There are two layers of automatic runtime context today:

### Codex-side automatic context

Codex itself already brings:

- built-in base instructions
- AGENTS.md instructions from the cwd/root chain
- hook output, if hooks are configured

### Pucky wrapper additions

On `thread/start`, the current wrapper sends:

- `approvalPolicy`
- `sandbox`
- `model` if configured
- `cwd` if configured
- `developerInstructions` if configured

On `turn/start`, the current wrapper sends:

- `threadId`
- text `input`
- `effort` if configured
- `outputSchema`

This means the underlying Codex runtime plane is already richer than what the
Pucky wrapper currently exposes.

## Important Notes From Investigation

### Thread focus model

The user's mental model was basically correct:

- `thread/resume` is the move that brings an existing thread/runtime back into focus
- `turn/start` is the move that sends the next message into that focused runtime

### The failed `Hi` append

The earlier attempt to send `Hi` into `Hanging yelllowdot` partially proved the
protocol but did not persist.

What happened:

- the thread was found and resumed
- `turn/start` returned a real turn id
- the turn reached `inProgress`
- it never persisted into saved thread history

Most likely cause:

- the probe used the local Node-installed `codex app-server` runtime
- the desktop app was using a different packaged Codex runtime
- the sidecar probe showed state-db mismatch warnings and a fatal MCP transport error

Conclusion:

- the control plane is real
- but cross-thread mutation should be driven through the same runtime/control plane the real app is using
- a sidecar app-server probe is not strong enough to count as production-clean proof

## Testing Plan

### Source/contract tests

Add tests proving:

- `agent.runtime.catalog` exists
- `agent.runtime.call` exists
- raw Codex method names are preserved
- `initialize` is included in the catalog
- the prompt references the catalog fetch path instead of inlining the whole method list

### Runtime tests

Use the existing fake/scripted Codex app-server testing pattern to cover:

- `initialize`
- `thread/start`
- `thread/resume`
- `thread/list`
- `thread/read`
- `thread/name/set`
- `thread/archive`
- `thread/unarchive`
- `thread/compact/start`
- `thread/rollback`
- `thread/fork`
- `turn/start`
- `turn/steer`
- `turn/interrupt`

Also verify:

- bad method names fail clearly
- bad params fail clearly
- a fresh bridge can auto-initialize if needed
- explicit `initialize` still works

### Headless Playwright proof

Primary proof target:

- VM HTTP + served UI

Not primary proof target:

- packaged Codex desktop app automation

The intended proof flow is:

1. send an inbound prompt through the existing VM turn surface
2. have the internal agent fetch `agent.runtime.catalog`
3. have the agent use `agent.runtime.call`
4. verify the result through runtime/API readback
5. verify visible state through headless browser inspection

Good scenarios:

- list threads
- read one thread
- rename a thread
- append a message to an existing thread
- fork a thread
- archive and unarchive a thread
- steer or interrupt a running turn

Each proof should require at least two signals:

- direct runtime/API readback
- headless browser confirmation from the served UI

## Defaults To Keep

- internal-only plane
- raw Codex method names
- one generated catalog file
- one catalog fetch call
- one generic runtime call
- no per-method alias surface
- no duplication into the user-facing Pucky API

## Current Status

This is a planning note only.

Nothing in this file implies implementation has happened yet.
