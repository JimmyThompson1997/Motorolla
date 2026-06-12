package com.pucky.device.accessibility;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class PuckyAccessibilityService extends AccessibilityService {
    private static final String TAG = "PuckyAccessibility";
    private static final int MAX_SNAPSHOT_NODES = 250;
    private static final long DEFAULT_WAIT_TIMEOUT_MS = 5000L;
    private static volatile PuckyAccessibilityService activeService;
    private static volatile long lastEventUptimeMs;
    private static volatile String lastPackageName;
    private static volatile String lastClassName;

    public static boolean canLockScreen(Context context) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && activeService != null;
    }

    public static PuckyAccessibilityService activeService() {
        return activeService;
    }

    public static boolean lockScreen() {
        PuckyAccessibilityService service = activeService;
        if (service == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return false;
        }
        return service.performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
    }

    public static boolean isEnabledInSettings(Context context) {
        try {
            String enabledServices = Settings.Secure.getString(
                    context.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (TextUtils.isEmpty(enabledServices)) {
                return false;
            }
            String expected = new ComponentName(context, PuckyAccessibilityService.class)
                    .flattenToString();
            TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
            splitter.setString(enabledServices);
            while (splitter.hasNext()) {
                if (expected.equalsIgnoreCase(splitter.next())) {
                    return true;
                }
            }
        } catch (RuntimeException exc) {
            Log.w(TAG, "Unable to read accessibility setting", exc);
        }
        return false;
    }

    public static boolean canInspectUi(Context context) {
        return isEnabledInSettings(context) && activeService != null;
    }

    public static JSONObject status(Context context, boolean labEnabled) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.ui_a11y_status.v1");
        Json.put(out, "generated_at", Instant.now().toString());
        Json.put(out, "enabled_in_settings", isEnabledInSettings(context));
        Json.put(out, "service_connected", activeService != null);
        Json.put(out, "stable_available", canInspectUi(context));
        Json.put(out, "lab_enabled", labEnabled);
        Json.put(out, "lab_available", canInspectUi(context) && labEnabled);
        Json.put(out, "can_lock_screen", canLockScreen(context));
        Json.put(out, "can_retrieve_window_content", activeService != null);
        Json.put(out, "can_perform_gestures", Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activeService != null);
        Json.put(out, "last_event_uptime_ms", lastEventUptimeMs);
        Json.put(out, "last_package_name", lastPackageName == null ? JSONObject.NULL : lastPackageName);
        Json.put(out, "last_class_name", lastClassName == null ? JSONObject.NULL : lastClassName);
        Json.put(out, "settings_action", Settings.ACTION_ACCESSIBILITY_SETTINGS);
        return out;
    }

    public static JSONArray curatedSurfaces() {
        JSONArray out = new JSONArray();
        Json.add(out, "phone");
        Json.add(out, "settings");
        Json.add(out, "browser");
        Json.add(out, "calendar");
        Json.add(out, "notifications");
        return out;
    }

    public static JSONObject snapshot(Context context, JSONObject args, boolean lab, boolean labEnabled) throws CommandException {
        PuckyAccessibilityService service = requireService(context);
        if (lab) {
            AccessibilitySurfacePolicy.requireLabEnabled(labEnabled);
        }
        boolean allWindows = lab && args.optBoolean("all_windows", false);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", lab ? "pucky.ui_a11y_lab_snapshot.v1" : "pucky.ui_a11y_snapshot.v1");
        Json.put(out, "generated_at", Instant.now().toString());
        JSONArray windows = new JSONArray();
        String activePackage = null;
        if (allWindows && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            List<AccessibilityWindowInfo> infos = service.getWindows();
            for (int i = 0; infos != null && i < infos.size(); i++) {
                AccessibilityWindowInfo info = infos.get(i);
                AccessibilityNodeInfo root = info == null ? null : info.getRoot();
                if (root == null) {
                    continue;
                }
                try {
                    String packageName = nodePackage(root);
                    if (!lab && !AccessibilitySurfacePolicy.isCuratedPackageAllowed(packageName, context.getPackageName())) {
                        continue;
                    }
                    activePackage = activePackage == null ? packageName : activePackage;
                    Json.add(windows, service.snapshotWindow(root, i, packageName));
                } finally {
                    root.recycle();
                }
            }
        } else {
            AccessibilityNodeInfo root = service.getRootInActiveWindow();
            if (root == null) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Accessibility root window is unavailable");
            }
            try {
                String packageName = nodePackage(root);
                if (!lab && !AccessibilitySurfacePolicy.isCuratedPackageAllowed(packageName, context.getPackageName())) {
                    throw new CommandException(
                            CommandErrorCodes.COMMAND_NOT_ALLOWED,
                            "Stable accessibility surface is limited to curated apps; foreground package=" + packageName);
                }
                activePackage = packageName;
                Json.add(windows, service.snapshotWindow(root, 0, packageName));
            } finally {
                root.recycle();
            }
        }
        Json.put(out, "active_package_name", activePackage == null ? JSONObject.NULL : activePackage);
        Json.put(out, "windows", windows);
        Json.put(out, "window_count", windows.length());
        return out;
    }

    public static JSONObject waitFor(Context context, JSONObject args, boolean lab, boolean labEnabled) throws CommandException {
        if (lab) {
            AccessibilitySurfacePolicy.requireLabEnabled(labEnabled);
        }
        long timeoutMs = Math.max(250L, Math.min(15000L, args.optLong("timeout_ms", DEFAULT_WAIT_TIMEOUT_MS)));
        long pollMs = Math.max(100L, Math.min(1000L, args.optLong("poll_ms", 250L)));
        long deadline = SystemClock.uptimeMillis() + timeoutMs;
        while (SystemClock.uptimeMillis() < deadline) {
            JSONObject snapshot = snapshot(context, args, lab, labEnabled);
            JSONObject match = findMatch(snapshot, args);
            if (match != null) {
                JSONObject out = new JSONObject();
                Json.put(out, "schema", lab ? "pucky.ui_a11y_lab_wait_for.v1" : "pucky.ui_a11y_wait_for.v1");
                Json.put(out, "matched", true);
                Json.put(out, "match", match);
                Json.put(out, "snapshot", snapshot);
                return out;
            }
            SystemClock.sleep(pollMs);
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", lab ? "pucky.ui_a11y_lab_wait_for.v1" : "pucky.ui_a11y_wait_for.v1");
        Json.put(out, "matched", false);
        Json.put(out, "timeout_ms", timeoutMs);
        return out;
    }

    public static JSONObject performNodeAction(Context context, JSONObject args, boolean lab, boolean labEnabled) throws CommandException {
        PuckyAccessibilityService service = requireService(context);
        if (lab) {
            AccessibilitySurfacePolicy.requireLabEnabled(labEnabled);
        }
        AccessibilityNodeInfo node = service.resolveNode(context, args, lab);
        if (node == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No accessibility node matched the request");
        }
        try {
            String action = args.optString("action", "click").trim().toLowerCase(Locale.US);
            boolean success = node.performAction(actionCode(action));
            JSONObject out = new JSONObject();
            Json.put(out, "schema", lab ? "pucky.ui_a11y_lab_action.v1" : "pucky.ui_a11y_action.v1");
            Json.put(out, "action", action);
            Json.put(out, "success", success);
            Json.put(out, "target", nodeJson(node, args.optString("node_id", "resolved")));
            return out;
        } finally {
            node.recycle();
        }
    }

    public static JSONObject typeIntoNode(Context context, JSONObject args, boolean lab, boolean labEnabled) throws CommandException {
        PuckyAccessibilityService service = requireService(context);
        if (lab) {
            AccessibilitySurfacePolicy.requireLabEnabled(labEnabled);
        }
        String text = args.optString("text", "").trim();
        if (text.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "ui.a11y.type requires text");
        }
        AccessibilityNodeInfo node = service.resolveNode(context, args, lab);
        if (node == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No accessibility node matched the request");
        }
        try {
            Bundle bundle = new Bundle();
            bundle.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            boolean success = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, bundle);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", lab ? "pucky.ui_a11y_lab_type.v1" : "pucky.ui_a11y_type.v1");
            Json.put(out, "success", success);
            Json.put(out, "chars", text.length());
            Json.put(out, "target", nodeJson(node, args.optString("node_id", "resolved")));
            return out;
        } finally {
            node.recycle();
        }
    }

    public static JSONObject performGlobalActionCommand(Context context, JSONObject args) throws CommandException {
        PuckyAccessibilityService service = requireService(context);
        String actionName = args.optString("action", args.optString("name", "")).trim().toLowerCase(Locale.US);
        if (actionName.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "ui.a11y.global_action requires action");
        }
        boolean success = service.performGlobalAction(globalActionCode(actionName));
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.ui_a11y_global_action.v1");
        Json.put(out, "action", actionName);
        Json.put(out, "success", success);
        return out;
    }

    public static JSONObject performGestureCommand(Context context, JSONObject args, boolean labEnabled) throws CommandException {
        AccessibilitySurfacePolicy.requireLabEnabled(labEnabled);
        PuckyAccessibilityService service = requireService(context);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Gesture dispatch requires Android N or newer");
        }
        String kind = args.optString("kind", "tap").trim().toLowerCase(Locale.US);
        long durationMs = Math.max(40L, Math.min(5000L, args.optLong("duration_ms", "swipe".equals(kind) ? 250L : 60L)));
        Path path = new Path();
        if ("swipe".equals(kind)) {
            float startX = (float) args.optDouble("start_x", args.optDouble("x", 0));
            float startY = (float) args.optDouble("start_y", args.optDouble("y", 0));
            float endX = (float) args.optDouble("end_x", startX);
            float endY = (float) args.optDouble("end_y", startY);
            path.moveTo(startX, startY);
            path.lineTo(endX, endY);
        } else {
            float x = (float) args.optDouble("x", -1);
            float y = (float) args.optDouble("y", -1);
            if (x < 0 || y < 0) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Tap gesture requires x and y");
            }
            path.moveTo(x, y);
            path.lineTo(x + 1f, y + 1f);
        }
        GestureDescription description = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0L, durationMs))
                .build();
        CountDownLatch latch = new CountDownLatch(1);
        JSONObject result = new JSONObject();
        Json.put(result, "schema", "pucky.ui_a11y_lab_gesture.v1");
        Json.put(result, "kind", kind);
        Json.put(result, "duration_ms", durationMs);
        boolean dispatched = service.dispatchGesture(description, new GestureResultCallback() {
            @Override
            public void onCompleted(GestureDescription gestureDescription) {
                Json.put(result, "completed", true);
                latch.countDown();
            }

            @Override
            public void onCancelled(GestureDescription gestureDescription) {
                Json.put(result, "completed", false);
                Json.put(result, "cancelled", true);
                latch.countDown();
            }
        }, null);
        Json.put(result, "dispatched", dispatched);
        if (dispatched) {
            try {
                latch.await(Math.max(1000L, durationMs + 1000L), TimeUnit.MILLISECONDS);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
            }
        }
        return result;
    }

    @Override
    protected void onServiceConnected() {
        activeService = this;
        Log.i(TAG, "Pucky accessibility service connected");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        lastEventUptimeMs = SystemClock.uptimeMillis();
        lastPackageName = event.getPackageName() == null ? null : String.valueOf(event.getPackageName());
        lastClassName = event.getClassName() == null ? null : String.valueOf(event.getClassName());
    }

    @Override
    public void onInterrupt() {
        // No ongoing accessibility work to interrupt.
    }

    @Override
    public void onDestroy() {
        if (activeService == this) {
            activeService = null;
        }
        super.onDestroy();
    }

    private static PuckyAccessibilityService requireService(Context context) throws CommandException {
        if (!isEnabledInSettings(context)) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "Pucky accessibility service is not enabled");
        }
        PuckyAccessibilityService service = activeService;
        if (service == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Pucky accessibility service is not connected");
        }
        return service;
    }

    private AccessibilityNodeInfo resolveNode(Context context, JSONObject args, boolean lab) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return null;
        }
        try {
            String packageName = nodePackage(root);
            if (!lab && !AccessibilitySurfacePolicy.isCuratedPackageAllowed(packageName, context.getPackageName())) {
                return null;
            }
            String nodeId = args.optString("node_id", "").trim();
            if (!nodeId.isEmpty()) {
                return resolveByPath(root, trimWindowPrefix(nodeId));
            }
            return findFirstMatch(root, args, "0");
        } finally {
            root.recycle();
        }
    }

    private JSONObject snapshotWindow(AccessibilityNodeInfo root, int windowIndex, String packageName) {
        JSONObject out = new JSONObject();
        JSONArray nodes = new JSONArray();
        collectNodes(root, "0", nodes, 0);
        Json.put(out, "window_id", "w" + windowIndex);
        Json.put(out, "package_name", packageName == null ? JSONObject.NULL : packageName);
        Json.put(out, "node_count", nodes.length());
        Json.put(out, "nodes", nodes);
        return out;
    }

    private void collectNodes(AccessibilityNodeInfo node, String path, JSONArray nodes, int depth) {
        if (node == null || nodes.length() >= MAX_SNAPSHOT_NODES) {
            return;
        }
        Json.add(nodes, nodeJson(node, "w0:" + path));
        for (int i = 0; i < node.getChildCount() && nodes.length() < MAX_SNAPSHOT_NODES; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) {
                continue;
            }
            try {
                collectNodes(child, path + "/" + i, nodes, depth + 1);
            } finally {
                child.recycle();
            }
        }
    }

    private static JSONObject nodeJson(AccessibilityNodeInfo node, String nodeId) {
        JSONObject out = new JSONObject();
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        Json.put(out, "node_id", nodeId);
        Json.put(out, "text", node.getText() == null ? JSONObject.NULL : String.valueOf(node.getText()));
        Json.put(out, "content_description", node.getContentDescription() == null ? JSONObject.NULL : String.valueOf(node.getContentDescription()));
        Json.put(out, "view_id", node.getViewIdResourceName() == null ? JSONObject.NULL : node.getViewIdResourceName());
        Json.put(out, "class_name", node.getClassName() == null ? JSONObject.NULL : String.valueOf(node.getClassName()));
        Json.put(out, "package_name", node.getPackageName() == null ? JSONObject.NULL : String.valueOf(node.getPackageName()));
        Json.put(out, "clickable", node.isClickable());
        Json.put(out, "enabled", node.isEnabled());
        Json.put(out, "focusable", node.isFocusable());
        Json.put(out, "focused", node.isFocused());
        Json.put(out, "editable", node.isEditable());
        Json.put(out, "scrollable", node.isScrollable());
        Json.put(out, "visible_to_user", node.isVisibleToUser());
        Json.put(out, "bounds", bounds.toShortString());
        Json.put(out, "child_count", node.getChildCount());
        return out;
    }

    private static JSONObject findMatch(JSONObject snapshot, JSONObject args) {
        JSONArray windows = snapshot.optJSONArray("windows");
        if (windows == null) {
            return null;
        }
        for (int i = 0; i < windows.length(); i++) {
            JSONArray nodes = windows.optJSONObject(i).optJSONArray("nodes");
            if (nodes == null) {
                continue;
            }
            for (int j = 0; j < nodes.length(); j++) {
                JSONObject node = nodes.optJSONObject(j);
                if (matchesNode(node, args)) {
                    return node;
                }
            }
        }
        return null;
    }

    private AccessibilityNodeInfo findFirstMatch(AccessibilityNodeInfo node, JSONObject args, String path) {
        if (node == null) {
            return null;
        }
        JSONObject descriptor = nodeJson(node, "w0:" + path);
        if (matchesNode(descriptor, args)) {
            return AccessibilityNodeInfo.obtain(node);
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) {
                continue;
            }
            try {
                AccessibilityNodeInfo found = findFirstMatch(child, args, path + "/" + i);
                if (found != null) {
                    return found;
                }
            } finally {
                child.recycle();
            }
        }
        return null;
    }

    private AccessibilityNodeInfo resolveByPath(AccessibilityNodeInfo root, String path) {
        if (path == null || path.trim().isEmpty() || "0".equals(path.trim())) {
            return AccessibilityNodeInfo.obtain(root);
        }
        String[] parts = path.split("/");
        AccessibilityNodeInfo current = AccessibilityNodeInfo.obtain(root);
        for (int i = 1; i < parts.length; i++) {
            int childIndex;
            try {
                childIndex = Integer.parseInt(parts[i]);
            } catch (NumberFormatException exc) {
                current.recycle();
                return null;
            }
            AccessibilityNodeInfo next = current.getChild(childIndex);
            current.recycle();
            current = next;
            if (current == null) {
                return null;
            }
        }
        return current;
    }

    private static boolean matchesNode(JSONObject node, JSONObject args) {
        String text = stringValue(node, "text");
        String description = stringValue(node, "content_description");
        String viewId = stringValue(node, "view_id");
        String textExact = args.optString("text", "").trim();
        String textContains = args.optString("text_contains", "").trim();
        String desiredViewId = args.optString("view_id", "").trim();
        String desiredDescription = args.optString("content_description", "").trim();
        if (!textExact.isEmpty() && !textExact.equals(text)) {
            return false;
        }
        if (!textContains.isEmpty() && (text == null || !text.toLowerCase(Locale.US).contains(textContains.toLowerCase(Locale.US)))) {
            return false;
        }
        if (!desiredViewId.isEmpty() && !desiredViewId.equals(viewId)) {
            return false;
        }
        if (!desiredDescription.isEmpty() && !desiredDescription.equals(description)) {
            return false;
        }
        return !textExact.isEmpty() || !textContains.isEmpty() || !desiredViewId.isEmpty() || !desiredDescription.isEmpty();
    }

    private static String stringValue(JSONObject node, String key) {
        Object value = node.opt(key);
        return value == null || value == JSONObject.NULL ? null : String.valueOf(value);
    }

    private static String nodePackage(AccessibilityNodeInfo node) {
        return node.getPackageName() == null ? "" : String.valueOf(node.getPackageName());
    }

    private static String trimWindowPrefix(String nodeId) {
        int colon = nodeId.indexOf(':');
        return colon >= 0 ? nodeId.substring(colon + 1) : nodeId;
    }

    private static int actionCode(String action) throws CommandException {
        switch (action) {
            case "click":
                return AccessibilityNodeInfo.ACTION_CLICK;
            case "long_click":
                return AccessibilityNodeInfo.ACTION_LONG_CLICK;
            case "focus":
                return AccessibilityNodeInfo.ACTION_FOCUS;
            case "clear_focus":
                return AccessibilityNodeInfo.ACTION_CLEAR_FOCUS;
            case "select":
                return AccessibilityNodeInfo.ACTION_SELECT;
            case "clear_selection":
                return AccessibilityNodeInfo.ACTION_CLEAR_SELECTION;
            case "scroll_forward":
                return AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
            case "scroll_backward":
                return AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
            case "expand":
                return AccessibilityNodeInfo.ACTION_EXPAND;
            case "collapse":
                return AccessibilityNodeInfo.ACTION_COLLAPSE;
            default:
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unsupported accessibility action: " + action);
        }
    }

    private static int globalActionCode(String action) throws CommandException {
        switch (action) {
            case "back":
                return GLOBAL_ACTION_BACK;
            case "home":
                return GLOBAL_ACTION_HOME;
            case "recents":
                return GLOBAL_ACTION_RECENTS;
            case "notifications":
                return GLOBAL_ACTION_NOTIFICATIONS;
            case "quick_settings":
                return GLOBAL_ACTION_QUICK_SETTINGS;
            case "power_dialog":
                return GLOBAL_ACTION_POWER_DIALOG;
            case "lock_screen":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return GLOBAL_ACTION_LOCK_SCREEN;
                }
                break;
        }
        throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unsupported global accessibility action: " + action);
    }
}
