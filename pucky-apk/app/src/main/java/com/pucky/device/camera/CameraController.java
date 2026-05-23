package com.pucky.device.camera;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.AudioManager;
import android.media.Image;
import android.media.ImageReader;
import android.media.MediaScannerConnection;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.provider.MediaStore;
import android.util.Size;
import android.view.Surface;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.Comparator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class CameraController {
    private static final String PUBLIC_PHOTO_RELATIVE_DIR = Environment.DIRECTORY_DCIM + "/Pucky";
    private static final int CAPTURE_CHIME_VOLUME = 85;
    private static final int CAPTURE_CHIME_DURATION_MS = 140;

    private final Context context;
    private final Handler mainHandler;

    public CameraController(Context context) {
        this.context = context.getApplicationContext();
        this.mainHandler = new Handler(this.context.getMainLooper());
    }

    public JSONObject info() throws CommandException {
        CameraManager manager = manager();
        JSONObject out = new JSONObject();
        JSONArray cameras = new JSONArray();
        try {
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics chars = manager.getCameraCharacteristics(id);
                JSONObject item = new JSONObject();
                Json.put(item, "camera_id", id);
                Json.put(item, "facing", facing(chars));
                boolean flashAvailable = Boolean.TRUE.equals(chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE));
                Json.put(item, "flash_available", flashAvailable);
                if (Build.VERSION.SDK_INT >= 33 && flashAvailable) {
                    Integer maxStrength = chars.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);
                    Integer defaultStrength = chars.get(CameraCharacteristics.FLASH_INFO_STRENGTH_DEFAULT_LEVEL);
                    Json.put(item, "torch_strength_maximum_level", maxStrength == null ? JSONObject.NULL : maxStrength);
                    Json.put(item, "torch_strength_default_level", defaultStrength == null ? JSONObject.NULL : defaultStrength);
                    Json.put(item, "torch_strength_control_available", maxStrength != null && maxStrength > 1);
                }
                Integer orientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION);
                Json.put(item, "sensor_orientation", orientation == null ? JSONObject.NULL : orientation);
                Size size = chooseJpegSize(chars, 1280);
                if (size != null) {
                    Json.put(item, "default_capture_width", size.getWidth());
                    Json.put(item, "default_capture_height", size.getHeight());
                }
                Json.add(cameras, item);
            }
        } catch (CameraAccessException e) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, e.getMessage());
        }
        Json.put(out, "available", true);
        Json.put(out, "count", cameras.length());
        Json.put(out, "cameras", cameras);
        Json.put(out, "camera_permission_granted", cameraPermissionGranted());
        return out;
    }

    public JSONObject setTorch(JSONObject args) throws CommandException {
        requireCameraPermission();
        CameraManager manager = manager();
        boolean enabled = args.optBoolean("enabled", args.optBoolean("on", true));
        long autoOffMs = Math.max(0, Math.min(60000, args.optLong("auto_off_ms", 5000)));
        String cameraId = args.optString("camera_id", "");
        try {
            if (cameraId.trim().isEmpty()) {
                cameraId = selectCameraId(manager, true);
            }
            if (cameraId == null) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No flash-capable camera found");
            }
            Integer strengthLevel = null;
            Integer maxStrength = null;
            if (enabled && args.has("strength_level") && Build.VERSION.SDK_INT >= 33) {
                CameraCharacteristics chars = manager.getCameraCharacteristics(cameraId);
                maxStrength = chars.get(CameraCharacteristics.FLASH_INFO_STRENGTH_MAXIMUM_LEVEL);
                Integer defaultStrength = chars.get(CameraCharacteristics.FLASH_INFO_STRENGTH_DEFAULT_LEVEL);
                int fallback = defaultStrength == null ? 1 : defaultStrength;
                int max = maxStrength == null || maxStrength < 1 ? fallback : maxStrength;
                strengthLevel = clamp(args.optInt("strength_level", fallback), 1, max);
                manager.turnOnTorchWithStrengthLevel(cameraId, strengthLevel);
            } else {
                manager.setTorchMode(cameraId, enabled);
            }
            if (enabled && autoOffMs > 0) {
                String autoOffCameraId = cameraId;
                mainHandler.postDelayed(() -> {
                    try {
                        manager.setTorchMode(autoOffCameraId, false);
                    } catch (Exception ignored) {
                    }
                }, autoOffMs);
            }
            JSONObject out = new JSONObject();
            Json.put(out, "enabled", enabled);
            Json.put(out, "camera_id", cameraId);
            Json.put(out, "auto_off_ms", enabled ? autoOffMs : 0);
            Json.put(out, "strength_level", strengthLevel == null ? JSONObject.NULL : strengthLevel);
            Json.put(out, "strength_maximum_level", maxStrength == null ? JSONObject.NULL : maxStrength);
            Json.put(out, "strength_control_used", strengthLevel != null);
            return out;
        } catch (CameraAccessException | SecurityException e) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, e.getMessage());
        }
    }

    public JSONObject capture(JSONObject args) throws CommandException {
        requireCameraPermission();
        CameraManager manager = manager();
        String cameraId = args.optString("camera_id", "");
        int maxWidth = Math.max(320, Math.min(4096, args.optInt("max_width", 1280)));
        long timeoutMs = Math.max(1000, Math.min(15000, args.optLong("timeout_ms", 8000)));
        boolean suppressChime = args.optBoolean("suppress_chime", false);
        try {
            if (cameraId.trim().isEmpty()) {
                cameraId = selectCameraId(manager, false);
            }
            if (cameraId == null) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No camera found");
            }
            CameraCharacteristics chars = manager.getCameraCharacteristics(cameraId);
            Size size = chooseJpegSize(chars, maxWidth);
            if (size == null) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No JPEG output size available");
            }
            return captureInternal(manager, cameraId, size, timeoutMs, suppressChime);
        } catch (CameraAccessException e) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, e.getMessage());
        }
    }

    private JSONObject captureInternal(CameraManager manager, String cameraId, Size size, long timeoutMs, boolean suppressChime)
            throws CommandException {
        HandlerThread thread = new HandlerThread("PuckyCameraCapture");
        thread.start();
        Handler handler = new Handler(thread.getLooper());
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<JSONObject> result = new AtomicReference<>();
        AtomicReference<Exception> error = new AtomicReference<>();
        AtomicReference<CameraDevice> deviceRef = new AtomicReference<>();
        AtomicReference<CameraCaptureSession> sessionRef = new AtomicReference<>();
        ImageReader reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.JPEG, 2);

        reader.setOnImageAvailableListener(imageReader -> {
            Image image = null;
            try {
                image = imageReader.acquireNextImage();
                ByteBuffer buffer = image.getPlanes()[0].getBuffer();
                byte[] bytes = new byte[buffer.remaining()];
                buffer.get(bytes);
                String displayName = "pucky-" + System.currentTimeMillis() + ".jpg";
                File file = writePrivatePhoto(bytes, displayName);
                JSONObject publicPhoto = publishPhoto(bytes, displayName);
                JSONObject captureChime = suppressChime ? skippedCaptureChime() : playCaptureChime();
                JSONObject out = new JSONObject();
                Json.put(out, "captured", true);
                Json.put(out, "camera_id", cameraId);
                Json.put(out, "path", file.getAbsolutePath());
                Json.put(out, "app_private_path", file.getAbsolutePath());
                Json.put(out, "public_saved", true);
                Json.put(out, "public_photo", publicPhoto);
                Json.put(out, "public_uri", publicPhoto.optString("uri", ""));
                Json.put(out, "public_relative_path", publicPhoto.optString("relative_path", ""));
                Json.put(out, "public_display_name", displayName);
                Json.put(out, "capture_chime", captureChime);
                Json.put(out, "bytes", bytes.length);
                Json.put(out, "mime_type", "image/jpeg");
                Json.put(out, "width", size.getWidth());
                Json.put(out, "height", size.getHeight());
                result.set(out);
            } catch (Exception e) {
                error.set(e);
            } finally {
                if (image != null) {
                    image.close();
                }
                done.countDown();
            }
        }, handler);

        try {
            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice camera) {
                    deviceRef.set(camera);
                    try {
                        Surface surface = reader.getSurface();
                        CaptureRequest.Builder builder = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
                        builder.addTarget(surface);
                        builder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
                        builder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
                        camera.createCaptureSession(Collections.singletonList(surface), new CameraCaptureSession.StateCallback() {
                            @Override
                            public void onConfigured(CameraCaptureSession session) {
                                sessionRef.set(session);
                                try {
                                    session.capture(builder.build(), null, handler);
                                } catch (CameraAccessException e) {
                                    error.set(e);
                                    done.countDown();
                                }
                            }

                            @Override
                            public void onConfigureFailed(CameraCaptureSession session) {
                                error.set(new IllegalStateException("Camera capture session configuration failed"));
                                done.countDown();
                            }
                        }, handler);
                    } catch (CameraAccessException e) {
                        error.set(e);
                        done.countDown();
                    }
                }

                @Override
                public void onDisconnected(CameraDevice camera) {
                    error.set(new IllegalStateException("Camera disconnected"));
                    done.countDown();
                }

                @Override
                public void onError(CameraDevice camera, int cameraError) {
                    error.set(new IllegalStateException("Camera error " + cameraError));
                    done.countDown();
                }
            }, handler);
            boolean completed = done.await(timeoutMs, TimeUnit.MILLISECONDS);
            if (!completed) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Camera capture timed out");
            }
            if (error.get() != null) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, error.get().getMessage());
            }
            if (result.get() == null) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Camera capture produced no image");
            }
            return result.get();
        } catch (SecurityException e) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Camera capture interrupted");
        } catch (CameraAccessException e) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, e.getMessage());
        } finally {
            CameraCaptureSession session = sessionRef.get();
            if (session != null) {
                session.close();
            }
            CameraDevice device = deviceRef.get();
            if (device != null) {
                device.close();
            }
            reader.close();
            thread.quitSafely();
        }
    }

    private File writePrivatePhoto(byte[] bytes, String displayName) throws Exception {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (dir == null) {
            dir = new File(context.getFilesDir(), "pictures");
        }
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Could not create photo directory: " + dir);
        }
        File file = new File(dir, displayName);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return file;
    }

    private JSONObject publishPhoto(byte[] bytes, String displayName) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return publishPhotoToMediaStore(bytes, displayName);
        }
        return publishPhotoLegacy(bytes, displayName);
    }

    private JSONObject publishPhotoToMediaStore(byte[] bytes, String displayName) throws Exception {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, displayName);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, PUBLIC_PHOTO_RELATIVE_DIR);
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
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
            ContentValues published = new ContentValues();
            published.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, published, null, null);
            completed = true;
            JSONObject result = publicPhotoResult(displayName, uri.toString(), PUBLIC_PHOTO_RELATIVE_DIR);
            Json.put(result, "collection", "MediaStore.Images");
            Json.put(result, "api", "mediastore");
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

    @SuppressWarnings("deprecation")
    private JSONObject publishPhotoLegacy(byte[] bytes, String displayName) throws Exception {
        File dcim = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM);
        File dir = new File(dcim, "Pucky");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Could not create public photo directory: " + dir);
        }
        File file = new File(dir, displayName);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        MediaScannerConnection.scanFile(context, new String[] {file.getAbsolutePath()},
                new String[] {"image/jpeg"}, null);
        JSONObject result = publicPhotoResult(displayName, Uri.fromFile(file).toString(), PUBLIC_PHOTO_RELATIVE_DIR);
        Json.put(result, "path", file.getAbsolutePath());
        Json.put(result, "api", "legacy_public_file");
        return result;
    }

    private JSONObject publicPhotoResult(String displayName, String uri, String relativePath) {
        JSONObject result = new JSONObject();
        Json.put(result, "schema", "pucky.public_photo.v1");
        Json.put(result, "display_name", displayName);
        Json.put(result, "mime_type", "image/jpeg");
        Json.put(result, "uri", uri);
        Json.put(result, "relative_path", relativePath);
        Json.put(result, "visible_in_gallery", true);
        return result;
    }

    private JSONObject playCaptureChime() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.photo_capture_chime.v1");
        Json.put(out, "stream", "music");
        Json.put(out, "volume", CAPTURE_CHIME_VOLUME);
        Json.put(out, "duration_ms", CAPTURE_CHIME_DURATION_MS);
        Json.put(out, "played", false);
        try {
            ToneGenerator generator = new ToneGenerator(AudioManager.STREAM_MUSIC, CAPTURE_CHIME_VOLUME);
            generator.startTone(ToneGenerator.TONE_PROP_ACK, CAPTURE_CHIME_DURATION_MS);
            new Thread(() -> {
                try {
                    Thread.sleep(CAPTURE_CHIME_DURATION_MS + 100L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                generator.release();
            }, "pucky-photo-capture-chime").start();
            Json.put(out, "played", true);
            Json.put(out, "tone", ToneGenerator.TONE_PROP_ACK);
        } catch (RuntimeException exc) {
            Json.put(out, "error", exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
        return out;
    }

    private JSONObject skippedCaptureChime() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.photo_capture_chime.v1");
        Json.put(out, "played", false);
        Json.put(out, "skipped", true);
        Json.put(out, "reason", "suppressed_by_keyword_lab");
        return out;
    }

    private CameraManager manager() throws CommandException {
        CameraManager manager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "CameraManager unavailable");
        }
        return manager;
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private void requireCameraPermission() throws CommandException {
        if (!cameraPermissionGranted()) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "CAMERA is not granted");
        }
    }

    private boolean cameraPermissionGranted() {
        return context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private String selectCameraId(CameraManager manager, boolean requireFlash) throws CameraAccessException {
        String fallback = null;
        for (String id : manager.getCameraIdList()) {
            CameraCharacteristics chars = manager.getCameraCharacteristics(id);
            boolean flash = Boolean.TRUE.equals(chars.get(CameraCharacteristics.FLASH_INFO_AVAILABLE));
            if (requireFlash && !flash) {
                continue;
            }
            if (fallback == null) {
                fallback = id;
            }
            Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                return id;
            }
        }
        return fallback;
    }

    private String facing(CameraCharacteristics chars) {
        Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
        if (facing == null) {
            return "unknown";
        }
        if (facing == CameraCharacteristics.LENS_FACING_BACK) {
            return "back";
        }
        if (facing == CameraCharacteristics.LENS_FACING_FRONT) {
            return "front";
        }
        if (facing == CameraCharacteristics.LENS_FACING_EXTERNAL) {
            return "external";
        }
        return "unknown";
    }

    private Size chooseJpegSize(CameraCharacteristics chars, int maxWidth) {
        StreamConfigurationMap map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        if (map == null) {
            return null;
        }
        Size[] sizes = map.getOutputSizes(ImageFormat.JPEG);
        if (sizes == null || sizes.length == 0) {
            return null;
        }
        Size best = null;
        for (Size size : sizes) {
            if (best == null) {
                best = size;
                continue;
            }
            boolean sizeFits = size.getWidth() <= maxWidth;
            boolean bestFits = best.getWidth() <= maxWidth;
            if (sizeFits && !bestFits) {
                best = size;
            } else if (sizeFits == bestFits) {
                int area = size.getWidth() * size.getHeight();
                int bestArea = best.getWidth() * best.getHeight();
                if (sizeFits ? area > bestArea : area < bestArea) {
                    best = size;
                }
            }
        }
        if (best == null) {
            best = Collections.min(java.util.Arrays.asList(sizes), Comparator.comparingInt(s -> s.getWidth() * s.getHeight()));
        }
        return best;
    }
}
