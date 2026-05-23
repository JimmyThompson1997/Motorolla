package com.pucky.device.screenshot;

import android.accessibilityservice.AccessibilityService;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.ImageFormat;
import android.hardware.HardwareBuffer;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.Display;

import com.pucky.device.accessibility.PuckyAccessibilityService;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public final class ScreenshotController {
    private static final String PUBLIC_SCREENSHOT_RELATIVE_DIR = Environment.DIRECTORY_DCIM + "/Pucky";
    private static final long DEFAULT_TIMEOUT_MS = 4000L;
    private static final long MIN_TIMEOUT_MS = 500L;
    private static final long MAX_TIMEOUT_MS = 10000L;

    private final Context context;

    public ScreenshotController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject capture(JSONObject args) throws CommandException {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE,
                    "Accessibility screenshots require Android 11/API 30+");
        }
        PuckyAccessibilityService service = PuckyAccessibilityService.activeService();
        if (service == null || !PuckyAccessibilityService.isEnabledInSettings(context)) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING,
                    "Pucky AccessibilityService must be enabled before screenshot.capture can run");
        }
        long timeoutMs = boundedLong(args == null ? DEFAULT_TIMEOUT_MS : args.optLong("timeout_ms", DEFAULT_TIMEOUT_MS),
                MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<AccessibilityService.ScreenshotResult> resultRef = new AtomicReference<>();
        AtomicInteger failureCode = new AtomicInteger(Integer.MIN_VALUE);
        service.takeScreenshot(Display.DEFAULT_DISPLAY, Runnable::run,
                new AccessibilityService.TakeScreenshotCallback() {
                    @Override
                    public void onSuccess(AccessibilityService.ScreenshotResult screenshot) {
                        resultRef.set(screenshot);
                        done.countDown();
                    }

                    @Override
                    public void onFailure(int errorCode) {
                        failureCode.set(errorCode);
                        done.countDown();
                    }
                });
        try {
            if (!done.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Screenshot capture timed out");
            }
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Screenshot capture interrupted");
        }
        if (failureCode.get() != Integer.MIN_VALUE) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Accessibility screenshot failed: " + failureName(failureCode.get()));
        }
        AccessibilityService.ScreenshotResult screenshot = resultRef.get();
        if (screenshot == null || screenshot.getHardwareBuffer() == null) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Accessibility screenshot returned no bitmap buffer");
        }
        return saveScreenshot(screenshot);
    }

    private JSONObject saveScreenshot(AccessibilityService.ScreenshotResult screenshot) throws CommandException {
        HardwareBuffer buffer = screenshot.getHardwareBuffer();
        Bitmap hardware = null;
        Bitmap bitmap = null;
        try {
            hardware = Bitmap.wrapHardwareBuffer(buffer, screenshot.getColorSpace());
            if (hardware == null) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to wrap screenshot buffer");
            }
            bitmap = hardware.copy(Bitmap.Config.ARGB_8888, false);
            String displayName = "pucky-screenshot-" + System.currentTimeMillis() + ".jpg";
            byte[] bytes = jpegBytes(bitmap);
            File file = writePrivateScreenshot(bytes, displayName);
            JSONObject publicImage = publishScreenshot(bytes, displayName);
            JSONObject out = new JSONObject();
            Json.put(out, "captured", true);
            Json.put(out, "kind", "screenshot");
            Json.put(out, "path", file.getAbsolutePath());
            Json.put(out, "app_private_path", file.getAbsolutePath());
            Json.put(out, "public_saved", true);
            Json.put(out, "public_image", publicImage);
            Json.put(out, "public_uri", publicImage.optString("uri", ""));
            Json.put(out, "public_relative_path", publicImage.optString("relative_path", ""));
            Json.put(out, "public_display_name", displayName);
            Json.put(out, "bytes", bytes.length);
            Json.put(out, "mime_type", "image/jpeg");
            Json.put(out, "width", bitmap.getWidth());
            Json.put(out, "height", bitmap.getHeight());
            return out;
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to save screenshot: " + exc.getClass().getSimpleName() + ": " + exc.getMessage());
        } finally {
            if (bitmap != null) {
                bitmap.recycle();
            }
            if (hardware != null) {
                hardware.recycle();
            }
            buffer.close();
        }
    }

    private byte[] jpegBytes(Bitmap bitmap) throws Exception {
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 92, bytes)) {
            throw new IllegalStateException("Bitmap.compress returned false");
        }
        return bytes.toByteArray();
    }

    private File writePrivateScreenshot(byte[] bytes, String displayName) throws Exception {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (dir == null) {
            dir = new File(context.getFilesDir(), "pictures");
        }
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Could not create screenshot directory: " + dir);
        }
        File file = new File(dir, displayName);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return file;
    }

    private JSONObject publishScreenshot(byte[] bytes, String displayName) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, displayName);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.Images.Media.RELATIVE_PATH, PUBLIC_SCREENSHOT_RELATIVE_DIR);
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
        }
        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            throw new IllegalStateException("MediaStore insert returned null");
        }
        boolean completed = false;
        try {
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) {
                    throw new IllegalStateException("MediaStore openOutputStream returned null");
                }
                out.write(bytes);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues published = new ContentValues();
                published.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, published, null, null);
            }
            completed = true;
            JSONObject result = new JSONObject();
            Json.put(result, "schema", "pucky.public_screenshot.v1");
            Json.put(result, "display_name", displayName);
            Json.put(result, "mime_type", "image/jpeg");
            Json.put(result, "uri", uri.toString());
            Json.put(result, "relative_path",
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? PUBLIC_SCREENSHOT_RELATIVE_DIR : JSONObject.NULL);
            Json.put(result, "collection", "MediaStore.Images");
            Json.put(result, "api", "mediastore");
            Json.put(result, "visible_in_gallery", true);
            return result;
        } finally {
            if (!completed) {
                try {
                    resolver.delete(uri, null, null);
                } catch (RuntimeException ignored) {
                }
            }
        }
    }

    private static long boundedLong(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }

    private static String failureName(int code) {
        switch (code) {
            case AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT:
                return "ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT";
            case AccessibilityService.ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY:
                return "ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY";
            case AccessibilityService.ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS:
                return "ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS";
            case AccessibilityService.ERROR_TAKE_SCREENSHOT_SECURE_WINDOW:
                return "ERROR_TAKE_SCREENSHOT_SECURE_WINDOW";
            default:
                return "ERROR_TAKE_SCREENSHOT_" + code;
        }
    }
}
