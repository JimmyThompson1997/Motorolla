package com.pucky.device.phone;

import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.telecom.TelecomManager;

public final class PhoneRoleSetupActivity extends Activity {
    private static final int REQUEST_ROLE = 9012;
    private boolean launched;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!launched) {
            launched = true;
            requestDialerRoleOrFallback();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_ROLE) {
            finish();
        }
    }

    private void requestDialerRoleOrFallback() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager manager = getSystemService(RoleManager.class);
            if (manager != null && manager.isRoleAvailable(RoleManager.ROLE_DIALER) && !manager.isRoleHeld(RoleManager.ROLE_DIALER)) {
                startActivityForResult(manager.createRequestRoleIntent(RoleManager.ROLE_DIALER), REQUEST_ROLE);
                return;
            }
        }
        Intent legacy = new Intent(TelecomManager.ACTION_CHANGE_DEFAULT_DIALER)
                .putExtra(TelecomManager.EXTRA_CHANGE_DEFAULT_DIALER_PACKAGE_NAME, getPackageName());
        if (legacy.resolveActivity(getPackageManager()) != null) {
            startActivity(legacy);
        } else {
            Intent settings = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
            if (settings.resolveActivity(getPackageManager()) != null) {
                startActivity(settings);
            }
        }
        finish();
    }
}
