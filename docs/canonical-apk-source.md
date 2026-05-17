# Canonical APK Source

`C:\Users\jimmy\Desktop\Motorolla\pucky-apk` is the only supported Pucky APK
source tree.

The older tree at `C:\Users\jimmy\Desktop\Android\pucky-apk` is deprecated. It
must not be used for builds, installs, provisioning, or patches because it can
silently reinstall stale versions onto the Razr.

For an APK update:

1. Pull or edit the `Motorolla` GitHub repo.
2. Build from `C:\Users\jimmy\Desktop\Motorolla\pucky-apk`.
3. Install to the plugged-in phone with `tools\deploy-canonical-apk.ps1`.
4. Verify the installed package version with `dumpsys package`.
5. Re-provision tunnel credentials if the app data was cleared or reinstall
   changed pairing state.
