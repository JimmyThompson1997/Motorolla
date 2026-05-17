# Pucky Cover Debug Notes

## ADB Input On The Cover Display

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
