package com.pucky.device.calls;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.telecom.TelecomManager;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

public final class PuckyDialerActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            renderState();
            handler.postDelayed(this, 1000L);
        }
    };

    private EditText numberInput;
    private TextView stateView;
    private TextView noteView;
    private Button answerButton;
    private Button hangupButton;
    private Button callButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prepareWindow();
        setTitle("Pucky Dialer");
        setContentView(buildContent());
        applyIntentNumber(getIntent());
        renderState();
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyIntentNumber(intent);
        renderState();
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.removeCallbacks(ticker);
        handler.post(ticker);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(ticker);
    }

    private void prepareWindow() {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private View buildContent() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("Pucky Dialer");
        title.setTextSize(24f);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title, params());

        noteView = new TextView(this);
        noteView.setText("Direct call control plus live incoming-call status.");
        root.addView(noteView, paramsWithTop(8));

        numberInput = new EditText(this);
        numberInput.setHint("Enter a phone number");
        numberInput.setInputType(InputType.TYPE_CLASS_PHONE);
        root.addView(numberInput, paramsWithTop(16));

        LinearLayout row = buttonRow();
        callButton = button("Call", v -> placeCallFromInput());
        answerButton = button("Answer", v -> answerCurrentCall());
        hangupButton = button("Hang Up", v -> hangupCurrentCall());
        Button refreshButton = button("Refresh", v -> renderState());
        row.addView(callButton, weightParams());
        row.addView(answerButton, weightParams());
        row.addView(hangupButton, weightParams());
        row.addView(refreshButton, weightParams());
        root.addView(row, paramsWithTop(16));

        stateView = new TextView(this);
        stateView.setTypeface(Typeface.MONOSPACE);
        stateView.setTextIsSelectable(true);
        root.addView(stateView, paramsWithTop(16));
        return scroll;
    }

    private void applyIntentNumber(android.content.Intent intent) {
        if (intent == null) {
            return;
        }
        Uri data = intent.getData();
        if (data != null && "tel".equalsIgnoreCase(data.getScheme())) {
            String number = data.getSchemeSpecificPart();
            if (number != null && !number.trim().isEmpty()) {
                numberInput.setText(number);
                numberInput.setSelection(number.length());
            }
        }
    }

    private void renderState() {
        JSONObject state = PuckyCallStateStore.snapshot(this);
        JSONArray calls = state.optJSONArray("calls");
        boolean hasRinging = state.optBoolean("has_ringing_call", false);
        boolean hasOngoing = state.optBoolean("has_ongoing_call", false);
        answerButton.setEnabled(hasRinging);
        hangupButton.setEnabled(hasOngoing || hasRinging);
        StringBuilder text = new StringBuilder();
        text.append("overall_state=").append(state.optString("overall_state", "unknown")).append('\n');
        text.append("default_dialer=").append(state.optString("default_dialer_package", "")).append('\n');
        text.append("default_dialer_held=").append(state.optBoolean("default_dialer_held", false)).append('\n');
        text.append("system_in_call=").append(state.optBoolean("system_in_call", false)).append('\n');
        text.append("system_in_managed_call=").append(state.optBoolean("system_in_managed_call", false)).append('\n');
        text.append("tracked_call_count=").append(state.optInt("tracked_call_count", 0)).append('\n');
        if (calls != null) {
            for (int i = 0; i < calls.length(); i++) {
                JSONObject call = calls.optJSONObject(i);
                if (call == null) {
                    continue;
                }
                text.append('\n')
                        .append("call[").append(i).append("] ")
                        .append(call.optString("state", "unknown"))
                        .append(" ")
                        .append(call.optString("number", ""))
                        .append(" ")
                        .append(call.optString("display_name", ""));
            }
        }
        stateView.setText(text.toString());
    }

    private void placeCallFromInput() {
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            noteView.setText("CALL_PHONE permission is missing.");
            return;
        }
        String number = cleanNumber(numberInput.getText().toString());
        if (number.isEmpty()) {
            noteView.setText("Enter a valid number.");
            return;
        }
        if (isEmergencyNumber(number)) {
            noteView.setText("Emergency-like numbers are blocked.");
            return;
        }
        TelecomManager telecom = (TelecomManager) getSystemService(Context.TELECOM_SERVICE);
        if (telecom == null) {
            noteView.setText("TelecomManager unavailable.");
            return;
        }
        telecom.placeCall(Uri.fromParts("tel", number, null), new Bundle());
        noteView.setText("Call requested for " + maskNumber(number));
    }

    private void answerCurrentCall() {
        JSONObject result = PuckyCallStateStore.answerRinging(this);
        noteView.setText(result.optBoolean("answered", false)
                ? "Answered ringing call."
                : "No ringing call was available to answer.");
        renderState();
    }

    @SuppressWarnings("deprecation")
    private void hangupCurrentCall() {
        if (checkSelfPermission(Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) {
            noteView.setText("ANSWER_PHONE_CALLS permission is missing.");
            return;
        }
        TelecomManager telecom = (TelecomManager) getSystemService(Context.TELECOM_SERVICE);
        if (telecom == null) {
            noteView.setText("TelecomManager unavailable.");
            return;
        }
        boolean ended = telecom.endCall();
        noteView.setText(ended ? "Call ended." : "No active call to end.");
        renderState();
    }

    private LinearLayout buttonRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_HORIZONTAL);
        return row;
    }

    private Button button(String label, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setOnClickListener(listener);
        return button;
    }

    private LinearLayout.LayoutParams params() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams paramsWithTop(int topDp) {
        LinearLayout.LayoutParams params = params();
        params.topMargin = dp(topDp);
        return params;
    }

    private LinearLayout.LayoutParams weightParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f);
        params.leftMargin = dp(4);
        params.rightMargin = dp(4);
        return params;
    }

    private int dp(int value) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    private static String cleanNumber(String value) {
        String trimmed = value == null ? "" : value.trim();
        StringBuilder out = new StringBuilder(trimmed.length());
        for (int i = 0; i < trimmed.length(); i++) {
            char ch = trimmed.charAt(i);
            if ((ch >= '0' && ch <= '9') || (ch == '+' && out.length() == 0)) {
                out.append(ch);
            } else if (ch == ' ' || ch == '-' || ch == '(' || ch == ')') {
                continue;
            }
        }
        return out.toString();
    }

    private static boolean isEmergencyNumber(String value) {
        String digits = value == null ? "" : value.replace("+", "");
        return "911".equals(digits) || "112".equals(digits);
    }

    private static String maskNumber(String value) {
        if (value == null || value.length() <= 4) {
            return "****";
        }
        return "***" + value.substring(value.length() - 4);
    }
}
