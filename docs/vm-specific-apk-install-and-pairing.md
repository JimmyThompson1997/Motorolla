# VM-Specific APK Install and Pairing

This is the important install idea: the VM should be able to generate an APK/session package that already knows which VM instance it belongs to.

## Why This Matters

A generic APK has to ask the user where to connect. A VM-specific install can skip that confusion:

```text
user opens VM page
  -> VM generates a short-lived one-time pairing token
  -> user downloads the APK/session from that VM page
  -> APK opens and consumes the token
  -> device is paired to that VM
```

This does not require a public account system. The VM can be the authority for the session.

## Token Shape

The token should be:

- short lived, ideally minutes
- one time use
- scoped to exactly one VM/device pairing request
- useless after the APK exchanges it for a real device credential
- never a personal SSH key
- never a long-lived ADB credential

The token is an invitation, not the tunnel secret itself.

## The Raw APK Catch

If the user downloads `pucky.apk?pair=<token>` from a browser, Android installs the APK bytes. The query string does not automatically get delivered to the newly installed app.

So the nontechnical flow needs one of these:

- After install, the same VM page shows an `Open Pucky and Pair` button using an app link such as `pucky://pair?token=<token>`.
- The APK is built/generated with a bundled provisioning asset for that exact VM session.
- The USB bootstrap script injects the token with `adb shell am start ...` after installing the APK.

For development, USB bootstrap is the cleanest and most deterministic. For nontechnical install later, the VM page should guide the user through download, install approval, then one tap to open and pair.

## Relationship To ADB

App-level pairing can start the app service and an app-owned tunnel. Full ADB still needs a trusted Android debugging step on stock Android:

- USB ADB once, preferred for development.
- Manual Wireless Debugging pairing.

Once the VM has ADB, it can install/update the APK, inject provisioning, start services, and connect to any tunnel endpoints the APK exposes.

## Current Direction

The immediate implementation path is:

1. Keep the `Motorolla` repo as the canonical workspace for this device effort.
2. Use USB once to bootstrap full ADB and/or inject pairing.
3. Add an APK-managed tunnel controller that opens reverse SSH from inside the app.
4. Later, make the VM produce a VM-specific install page with a one-time token and a post-install pair link.
