# ADB Cover Display Input

When driving the Motorola Razr cover display over ADB, target display `1`
explicitly. Plain `adb shell input tap ...` can hit the wrong display and make
the test look broken even when the cover UI is fine.

Use:

```powershell
adb -s ZY22JZ26LK shell input -d 1 tap <x> <y>
adb -s ZY22JZ26LK shell input -d 1 keyevent KEYCODE_APP_SWITCH
```

This is especially important when testing the cover overview button, back/home
navigation, and Pucky HTML buttons.

## Restoring The Local Cover UI Dev Loop

If the cover shows `Pucky UI failed to load` with
`net::ERR_CONNECTION_REFUSED`, check `adb reverse --list`. ADB reverse mappings
can disappear after USB reconnects, ADB server restarts, phone transport changes,
or laptop sleep.

Use the helper:

```powershell
.\tools\restore-pucky-cover-dev-loop.ps1
```

That script verifies local Project Vox is serving `/pucky-home`, restores
`tcp:8788 -> tcp:8788`, relaunches Pucky on cover display `1`, and can capture a
proof screenshot with `-EvidenceDir <path>`.
