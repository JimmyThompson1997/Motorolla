package com.pucky.device.phone;

import android.app.Activity;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.pucky.device.command.PhoneDataController;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.substrate.AndroidSubstrateController;

import org.json.JSONObject;

public final class PhoneHubActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private PhoneDataController phoneDataController;
    private EditText numberInput;
    private TextView roleSummaryView;
    private TextView roleWarningView;
    private TextView statusView;
    private TextView historyView;
    private TextView contactsView;
    private Button enableRoleButton;
    private Button restoreRoleButton;

    private final Runnable refreshRunnable = new Runnable() {
        @Override
        public void run() {
            render();
            handler.postDelayed(this, 1500L);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SettingsStore settings = new SettingsStore(this);
        phoneDataController = new PhoneDataController(this, settings, new AndroidSubstrateController(this));
        setContentView(buildView());
        render();
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
        handler.postDelayed(refreshRunnable, 1200L);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(refreshRunnable);
        super.onPause();
    }

    private View buildView() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("Pucky Phone");
        title.setTextSize(24f);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Role management, call surface, call history, and contacts preview");
        subtitle.setTextSize(14f);
        root.addView(subtitle);

        roleSummaryView = monospaceText();
        roleWarningView = new TextView(this);
        roleWarningView.setTextSize(13f);
        root.addView(section("Phone app role", roleSummaryView));
        root.addView(roleWarningView);

        numberInput = new EditText(this);
        numberInput.setHint("Enter a phone number");
        numberInput.setInputType(InputType.TYPE_CLASS_PHONE);
        root.addView(numberInput, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.VERTICAL);
        buttons.addView(button("Place call", v -> placeCall()));
        enableRoleButton = button("Enable Pucky dialer mode", v -> requestDialerRole());
        restoreRoleButton = button("Restore stock phone app", v -> openDefaultAppsSettings());
        buttons.addView(enableRoleButton);
        buttons.addView(restoreRoleButton);
        buttons.addView(button("Refresh", v -> render()));
        root.addView(buttons);

        statusView = monospaceText();
        historyView = monospaceText();
        contactsView = monospaceText();

        root.addView(section("Role and live call state", statusView));
        root.addView(section("Recent call history", historyView));
        root.addView(section("Contact preview", contactsView));

        scroll.addView(root);
        return scroll;
    }

    private View section(String title, TextView content) {
        LinearLayout block = new LinearLayout(this);
        block.setOrientation(LinearLayout.VERTICAL);
        block.setPadding(0, dp(16), 0, 0);
        TextView header = new TextView(this);
        header.setTypeface(Typeface.DEFAULT_BOLD);
        header.setText(title);
        block.addView(header);
        block.addView(content);
        return block;
    }

    private TextView monospaceText() {
        TextView text = new TextView(this);
        text.setTypeface(Typeface.MONOSPACE);
        text.setTextSize(12f);
        text.setTextIsSelectable(true);
        return text;
    }

    private Button button(String label, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setOnClickListener(listener);
        return button;
    }

    private void placeCall() {
        try {
            JSONObject args = new JSONObject();
            args.put("number", numberInput.getText().toString());
            phoneDataController.callsPlace(args);
            render();
        } catch (Exception exc) {
            statusView.setText("Place call failed:\n" + exc.getMessage());
        }
    }

    private void requestDialerRole() {
        try {
            PhoneRoleController.requestSetup(this, true, true);
            render();
        } catch (Exception exc) {
            statusView.setText("Dialer role request failed:\n" + exc.getMessage());
        }
    }

    private void openDefaultAppsSettings() {
        try {
            PhoneRoleController.openDefaultAppsSettings(this);
            render();
        } catch (Exception exc) {
            statusView.setText("Open default-app settings failed:\n" + exc.getMessage());
        }
    }

    private void render() {
        try {
            JSONObject roleStatus = PhoneRoleController.status(this);
            boolean roleHeld = roleStatus.optBoolean("role_held", false);
            String defaultDialerLabel = roleStatus.optString("default_dialer_label",
                    roleStatus.optString("default_dialer_package", "Unavailable"));
            String defaultDialerPackage = roleStatus.optString("default_dialer_package", "");
            String holderLine = defaultDialerPackage.isEmpty()
                    ? defaultDialerLabel
                    : defaultDialerLabel + " (" + defaultDialerPackage + ")";
            roleSummaryView.setText(
                    "Current default phone app: " + holderLine + "\n"
                            + "Dialer role state: " + roleStatus.optString("state", "unknown") + "\n"
                            + "Pucky dialer mode: " + (roleHeld ? "On" : "Off"));
            roleWarningView.setText(
                    "When Pucky holds the role, it becomes the in-call UI owner and the stock incoming-call UX may be replaced. "
                            + "Contacts, history, and calendar still stay in the shared Android providers.");
            enableRoleButton.setEnabled(!roleHeld);
            restoreRoleButton.setEnabled(roleHeld);
            statusView.setText(roleStatus.toString(2)
                    + "\n\n"
                    + phoneDataController.callsState(new JSONObject()).toString(2));
            JSONObject historyArgs = new JSONObject();
            historyArgs.put("limit", 5);
            historyView.setText(phoneDataController.historyList(historyArgs).toString(2));
            JSONObject contactArgs = new JSONObject();
            contactArgs.put("limit", 5);
            contactsView.setText(phoneDataController.contactsSearch(contactArgs).toString(2));
        } catch (Exception exc) {
            statusView.setText("Render failed:\n" + exc.getMessage());
        }
    }

    private int dp(int value) {
        float density = getResources().getDisplayMetrics().density;
        return Math.max(1, Math.round(value * density));
    }
}
