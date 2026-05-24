# VM-Owned Recipes

## Purpose

Volume-down keyword behavior now has a VM-owned recipe surface. The VM publishes the live recipe bundle, the APK caches it, and the APK exact-matches local Android STT transcripts against that cache.

This keeps hardware actions fast and offline-capable while letting coding agents update keyword behavior without rebuilding the APK.

## Split

The VM owns:

- the live recipe bundle
- recipe authoring instructions
- VM-side scripts, agents, and endpoint actions
- deciding whether a recipe is local-only, VM-only, or mixed

The APK owns:

- volume-down STT capture
- exact utterance matching
- local cached recipe execution
- safe Android device primitives
- Pucky Clipboard entries
- broker event delivery for VM relay steps

## Commands

- `pucky.recipes.sync`: replace the cached VM recipe bundle.
- `pucky.recipes.list`: inspect active recipes, fallback recipes, and stored bundle status.
- `pucky.recipes.test`: match text and optionally execute the matching recipe.
- `pucky.recipes.clear`: remove the cached VM bundle and fall back to APK seed recipes.
- `pucky.recipes.schema`: return the authoring contract.
- `device.primitives.list`: return APK-supported primitive commands.

The old lab keyword command family has been removed. Future agents should use `pucky.recipes.*` and `device.primitives.list`.

The canonical dev bundle lives at [volume_down_lab_dev_bundle.json](../../pucky_vm/recipes/volume_down_lab_dev_bundle.json). Sync it with:

```powershell
python tools/sync_pucky_recipe_bundle.py --broker http://127.0.0.1:8787 --token operator-dev-token --clear-first --smoke
```

## Recipe Shape

```json
{
  "schema": "pucky.recipe_bundle.v1",
  "bundle_id": "vm_live",
  "version": 1,
  "updated_at": "2026-05-23T00:00:00Z",
  "recipes": [
    {
      "id": "flashlight",
      "phrases": ["flashlight", "flash light"],
      "match": "exact_utterance",
      "steps": [
        {
          "type": "device",
          "command": "torch.set",
          "args": {
            "enabled": true,
            "auto_off_ms": 600
          }
        }
      ],
      "on_success": {"sound": "soft"},
      "on_failure": {"sound": "low_battery"}
    }
  ]
}
```

Matching is intentionally strict. `flashlight` can match; `turn flashlight on` and `flashlight please` do not.

## Step Types

`device` runs one APK allowlisted primitive:

- `torch.set`
- `photo.capture`
- `location.pin`
- `screenshot.capture`
- `video.capture.start`
- `video.capture.stop`

`location.pin` uses recent-or-pending semantics. A cached fused/network/sample under 30 seconds old is success. If no recent sample exists, the APK records `state=pending`, keeps acquiring for up to 60 seconds, and patches the matching Pucky Clipboard entry when it resolves or fails.

`vm_event` posts `pucky.keyword_triggered.v1` to `/v1/devices/{device_id}/events`. The VM then continues the relay race however it wants: endpoint call, script, agent session, email check, file update, or future workflow.

`chime` plays local feedback only. Supported sounds are `soft`, `low_battery`, and `none`.

The APK must not execute arbitrary VM-supplied commands such as `shell.exec`, LiveKit calls, network URLs, or unlisted native commands.

## Testing

Recommended smoke test flow:

1. `device.primitives.list`
2. `pucky.recipes.sync` with a flashlight recipe.
3. `pucky.recipes.test text=flashlight execute=true`
4. `pucky.recipes.sync` with a `vm_event` recipe such as `check email`.
5. `pucky.recipes.test text="check email" execute=true`
6. Confirm broker history contains `agent.recipe_triggered`.
7. Confirm Pucky Clipboard has the recipe id, transcript, step result, app identity, and any artifact references.

Deploy rule: start from clean current `master`, push first, then deploy only with `tools/deploy-canonical-apk.ps1`.
