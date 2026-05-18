# Canonical APK Source

`C:\Users\jimmy\Desktop\Motorolla\pucky-apk` is the only supported Pucky APK
source tree.

The older tree at `C:\Users\jimmy\Desktop\Android\pucky-apk` is deprecated. It
must not be used for builds, installs, provisioning, or patches because it can
silently reinstall stale versions onto the Razr.

Current live canonical line:

- Worktree: `C:\Users\jimmy\Desktop\Motorolla`
- Branch: `codex/slim-webview-cover-ui`
- Package: `com.pucky.device.debug`
- Version: `versionCode=19`, `versionName=0.2.18-webview-shell-broker-recover-debug`

For an APK update:

1. Pull or edit the `Motorolla` GitHub repo on the canonical live branch.
2. Commit and push before installing to Pucky.
3. Build from `C:\Users\jimmy\Desktop\Motorolla\pucky-apk`.
4. Install to the plugged-in phone with `tools\deploy-canonical-apk.ps1`.
5. Verify the installed package version with `dumpsys package`.
6. Re-provision tunnel credentials if the app data was cleared or reinstall
   changed pairing state.

`tools\deploy-canonical-apk.ps1` refuses to deploy from the wrong worktree,
wrong branch, dirty tree, unpushed HEAD, or mismatched Gradle version unless an
explicit override switch is supplied.
