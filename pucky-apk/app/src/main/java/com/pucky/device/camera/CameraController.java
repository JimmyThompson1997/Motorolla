package com.pucky.device.camera;

import android.Manifest;
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
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Size;
import android.view.Surface;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.util.Collections;
import java.util.Comparator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class CameraController {
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
            return captureInternal(manager, cameraId, size, timeoutMs);
        } catch (CameraAccessException e) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, e.getMessage());
        }
    }

    private JSONObject captureInternal(CameraManager manager, String cameraId, Size size, long timeoutMs)
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
                File file = writePhoto(bytes);
                JSONObject out = new JSONObject();
                Json.put(out, "captured", true);
                Json.put(out, "camera_id", cameraId);
                Json.put(out, "path", file.getAbsolutePath());
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

    private File writePhoto(byte[] bytes) throws Exception {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (dir == null) {
            dir = new File(context.getFilesDir(), "pictures");
        }
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Could not create photo directory: " + dir);
        }
        File file = new File(dir, "pucky-" + System.currentTimeMillis() + ".jpg");
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return file;
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
