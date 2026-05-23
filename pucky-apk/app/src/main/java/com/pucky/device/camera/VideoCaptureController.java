package com.pucky.device.camera;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.AudioManager;
import android.media.MediaRecorder;
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

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class VideoCaptureController {
    private static final String PUBLIC_VIDEO_RELATIVE_DIR = Environment.DIRECTORY_MOVIES + "/Pucky";
    private static final int DEFAULT_MAX_WIDTH = 1280;
    private static final long DEFAULT_TIMEOUT_MS = 8000L;
    private static final long DEFAULT_MAX_DURATION_MS = 60000L;
    private static final int CAPTURE_CHIME_VOLUME = 85;
    private static final int CAPTURE_CHIME_DURATION_MS = 140;

    private static volatile VideoCaptureController shared;

    private final Context context;
    private final Handler mainHandler;
    private ActiveVideo active;

    public static VideoCaptureController shared(Context context) {
        VideoCaptureController existing = shared;
        if (existing != null) {
            return existing;
        }
        synchronized (VideoCaptureController.class) {
            if (shared == null) {
                shared = new VideoCaptureController(context.getApplicationContext());
            }
            return shared;
        }
    }

    public VideoCaptureController(Context context) {
        this.context = context.getApplicationContext();
        this.mainHandler = new Handler(this.context.getMainLooper());
    }

    public synchronized JSONObject start(JSONObject args) throws CommandException {
        if (active != null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.video_capture_start.v1");
            Json.put(out, "started", false);
            Json.put(out, "already_active", true);
            Json.put(out, "video_session_id", active.sessionId);
            Json.put(out, "path", active.file.getAbsolutePath());
            Json.put(out, "app_private_path", active.file.getAbsolutePath());
            Json.put(out, "reply_text_override", "Video is already on.");
            return out;
        }
        requireCameraPermission();
        CameraManager manager = manager();
        int maxWidth = Math.max(320, Math.min(1920, args == null ? DEFAULT_MAX_WIDTH : args.optInt("max_width", DEFAULT_MAX_WIDTH)));
        long timeoutMs = boundedLong(args == null ? DEFAULT_TIMEOUT_MS : args.optLong("timeout_ms", DEFAULT_TIMEOUT_MS),
                1000L, 15000L);
        long maxDurationMs = boundedLong(args == null ? DEFAULT_MAX_DURATION_MS : args.optLong("max_duration_ms", DEFAULT_MAX_DURATION_MS),
                5000L, 300000L);
        String cameraId = args == null ? "" : args.optString("camera_id", "");
        boolean suppressChime = args != null && args.optBoolean("suppress_chime", false);
        try {
            if (cameraId.trim().isEmpty()) {
                cameraId = selectCameraId(manager);
            }
            if (cameraId == null) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No camera found");
            }
            CameraCharacteristics chars = manager.getCameraCharacteristics(cameraId);
            Size size = chooseVideoSize(chars, maxWidth);
            if (size == null) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No video output size available");
            }
            return startInternal(manager, cameraId, size, timeoutMs, maxDurationMs, suppressChime);
        } catch (CameraAccessException exc) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, exc.getMessage());
        }
    }

    public synchronized JSONObject stop(JSONObject args) throws CommandException {
        if (active == null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.video_capture_stop.v1");
            Json.put(out, "stopped", false);
            Json.put(out, "was_active", false);
            Json.put(out, "reply_text_override", "Video was off.");
            return out;
        }
        return stopActive("keyword_stop");
    }

    public synchronized JSONObject status() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.video_capture_status.v1");
        Json.put(out, "active", active != null);
        if (active != null) {
            Json.put(out, "video_session_id", active.sessionId);
            Json.put(out, "path", active.file.getAbsolutePath());
            Json.put(out, "started_elapsed_ms", System.currentTimeMillis() - active.startedAtMs);
        }
        return out;
    }

    private JSONObject startInternal(
            CameraManager manager, String cameraId, Size size, long timeoutMs, long maxDurationMs, boolean suppressChime)
            throws CommandException {
        String sessionId = "video_" + System.currentTimeMillis();
        String displayName = "pucky-video-" + System.currentTimeMillis() + ".mp4";
        File file = privateVideoFile(displayName);
        HandlerThread thread = new HandlerThread("PuckyVideoCapture");
        thread.start();
        Handler handler = new Handler(thread.getLooper());
        MediaRecorder recorder = new MediaRecorder();
        CameraRefs refs = new CameraRefs();
        CountDownLatch ready = new CountDownLatch(1);
        AtomicReference<Exception> error = new AtomicReference<>();
        try {
            configureRecorder(recorder, file, size);
            Surface recorderSurface = recorder.getSurface();
            manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice camera) {
                    refs.device = camera;
                    try {
                        CaptureRequest.Builder builder = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD);
                        builder.addTarget(recorderSurface);
                        builder.set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO);
                        camera.createCaptureSession(Collections.singletonList(recorderSurface),
                                new CameraCaptureSession.StateCallback() {
                                    @Override
                                    public void onConfigured(CameraCaptureSession session) {
                                        refs.session = session;
                                        try {
                                            session.setRepeatingRequest(builder.build(), null, handler);
                                            recorder.start();
                                            ready.countDown();
                                        } catch (Exception exc) {
                                            error.set(exc);
                                            ready.countDown();
                                        }
                                    }

                                    @Override
                                    public void onConfigureFailed(CameraCaptureSession session) {
                                        error.set(new IllegalStateException("Video capture session configuration failed"));
                                        ready.countDown();
                                    }
                                }, handler);
                    } catch (CameraAccessException exc) {
                        error.set(exc);
                        ready.countDown();
                    }
                }

                @Override
                public void onDisconnected(CameraDevice camera) {
                    error.set(new IllegalStateException("Camera disconnected"));
                    ready.countDown();
                }

                @Override
                public void onError(CameraDevice camera, int cameraError) {
                    error.set(new IllegalStateException("Camera error " + cameraError));
                    ready.countDown();
                }
            }, handler);
            if (!ready.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Video capture start timed out");
            }
            if (error.get() != null) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, error.get().getMessage());
            }
            ActiveVideo current = new ActiveVideo(sessionId, displayName, file, recorder, refs, thread, size, cameraId);
            active = current;
            mainHandler.postDelayed(() -> stopTimedOut(sessionId), maxDurationMs);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.video_capture_start.v1");
            Json.put(out, "started", true);
            Json.put(out, "already_active", false);
            Json.put(out, "silent_video", true);
            Json.put(out, "video_session_id", sessionId);
            Json.put(out, "camera_id", cameraId);
            Json.put(out, "path", file.getAbsolutePath());
            Json.put(out, "app_private_path", file.getAbsolutePath());
            Json.put(out, "public_saved", false);
            Json.put(out, "display_name", displayName);
            Json.put(out, "mime_type", "video/mp4");
            Json.put(out, "width", size.getWidth());
            Json.put(out, "height", size.getHeight());
            Json.put(out, "max_duration_ms", maxDurationMs);
            Json.put(out, "capture_chime", suppressChime
                    ? skippedCaptureChime("pucky.video_capture_start_chime.v1")
                    : playCaptureChime("pucky.video_capture_start_chime.v1"));
            return out;
        } catch (CommandException exc) {
            safeRelease(recorder);
            closeRefs(refs);
            thread.quitSafely();
            if (file.exists()) {
                file.delete();
            }
            throw exc;
        } catch (CameraAccessException exc) {
            safeRelease(recorder);
            closeRefs(refs);
            thread.quitSafely();
            if (file.exists()) {
                file.delete();
            }
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, exc.getMessage());
        } catch (SecurityException exc) {
            safeRelease(recorder);
            closeRefs(refs);
            thread.quitSafely();
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, exc.getMessage());
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            safeRelease(recorder);
            closeRefs(refs);
            thread.quitSafely();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Video capture start interrupted");
        }
    }

    private synchronized void stopTimedOut(String sessionId) {
        if (active == null || !sessionId.equals(active.sessionId)) {
            return;
        }
        try {
            stopActive("max_duration");
        } catch (CommandException ignored) {
        }
    }

    private JSONObject stopActive(String reason) throws CommandException {
        ActiveVideo current = active;
        active = null;
        try {
            if (current.refs.session != null) {
                current.refs.session.stopRepeating();
                current.refs.session.abortCaptures();
            }
        } catch (Exception ignored) {
        }
        try {
            current.recorder.stop();
        } catch (RuntimeException exc) {
            current.file.delete();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Video capture stop failed: " + exc.getMessage());
        } finally {
            safeRelease(current.recorder);
            closeRefs(current.refs);
            current.thread.quitSafely();
        }
        JSONObject publicVideo = publishVideo(current.file, current.displayName);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.video_capture_stop.v1");
        Json.put(out, "stopped", true);
        Json.put(out, "was_active", true);
        Json.put(out, "reason", reason);
        Json.put(out, "silent_video", true);
        Json.put(out, "video_session_id", current.sessionId);
        Json.put(out, "camera_id", current.cameraId);
        Json.put(out, "path", current.file.getAbsolutePath());
        Json.put(out, "app_private_path", current.file.getAbsolutePath());
        Json.put(out, "public_saved", true);
        Json.put(out, "public_video", publicVideo);
        Json.put(out, "public_uri", publicVideo.optString("uri", ""));
        Json.put(out, "public_relative_path", publicVideo.optString("relative_path", ""));
        Json.put(out, "public_display_name", current.displayName);
        Json.put(out, "bytes", current.file.length());
        Json.put(out, "mime_type", "video/mp4");
        Json.put(out, "width", current.size.getWidth());
        Json.put(out, "height", current.size.getHeight());
        Json.put(out, "duration_ms", Math.max(0L, System.currentTimeMillis() - current.startedAtMs));
        Json.put(out, "reply_text_override", "Video turned off.");
        return out;
    }

    private void configureRecorder(MediaRecorder recorder, File file, Size size) throws CommandException {
        try {
            recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setOutputFile(file.getAbsolutePath());
            recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
            recorder.setVideoEncodingBitRate(Math.max(1_500_000, size.getWidth() * size.getHeight() * 4));
            recorder.setVideoFrameRate(30);
            recorder.setVideoSize(size.getWidth(), size.getHeight());
            recorder.prepare();
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to prepare video recorder: " + exc.getMessage());
        }
    }

    private File privateVideoFile(String displayName) throws CommandException {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (dir == null) {
            dir = new File(context.getFilesDir(), "videos");
        }
        if (!dir.exists() && !dir.mkdirs()) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Could not create video directory: " + dir);
        }
        return new File(dir, displayName);
    }

    private JSONObject publishVideo(File source, String displayName) throws CommandException {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Video.Media.DISPLAY_NAME, displayName);
        values.put(MediaStore.Video.Media.TITLE, displayName);
        values.put(MediaStore.Video.Media.MIME_TYPE, "video/mp4");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.Video.Media.RELATIVE_PATH, PUBLIC_VIDEO_RELATIVE_DIR);
            values.put(MediaStore.Video.Media.IS_PENDING, 1);
        }
        Uri uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "MediaStore insert returned null");
        }
        boolean completed = false;
        try {
            try (FileInputStream input = new FileInputStream(source);
                 OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) {
                    throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "MediaStore output stream unavailable");
                }
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues publish = new ContentValues();
                publish.put(MediaStore.Video.Media.IS_PENDING, 0);
                resolver.update(uri, publish, null, null);
            }
            completed = true;
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.public_video.v1");
            Json.put(out, "display_name", displayName);
            Json.put(out, "title", displayName);
            Json.put(out, "mime_type", "video/mp4");
            Json.put(out, "uri", uri.toString());
            Json.put(out, "relative_path",
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? PUBLIC_VIDEO_RELATIVE_DIR : JSONObject.NULL);
            Json.put(out, "collection", "MediaStore.Video");
            Json.put(out, "api", "mediastore");
            Json.put(out, "visible_in_gallery", true);
            return out;
        } catch (CommandException exc) {
            resolver.delete(uri, null, null);
            throw exc;
        } catch (Exception exc) {
            resolver.delete(uri, null, null);
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to publish video: " + exc.getClass().getSimpleName() + ": " + exc.getMessage());
        } finally {
            if (!completed) {
                try {
                    resolver.delete(uri, null, null);
                } catch (RuntimeException ignored) {
                }
            }
        }
    }

    private JSONObject playCaptureChime(String schema) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", schema);
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
            }, "pucky-video-capture-chime").start();
            Json.put(out, "played", true);
            Json.put(out, "tone", ToneGenerator.TONE_PROP_ACK);
        } catch (RuntimeException exc) {
            Json.put(out, "error", exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
        return out;
    }

    private JSONObject skippedCaptureChime(String schema) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", schema);
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

    private void requireCameraPermission() throws CommandException {
        if (context.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "CAMERA is not granted");
        }
    }

    private String selectCameraId(CameraManager manager) throws CameraAccessException {
        String fallback = null;
        for (String id : manager.getCameraIdList()) {
            if (fallback == null) {
                fallback = id;
            }
            CameraCharacteristics chars = manager.getCameraCharacteristics(id);
            Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                return id;
            }
        }
        return fallback;
    }

    private Size chooseVideoSize(CameraCharacteristics chars, int maxWidth) {
        StreamConfigurationMap map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
        if (map == null) {
            return null;
        }
        Size[] sizes = map.getOutputSizes(MediaRecorder.class);
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
            int area = size.getWidth() * size.getHeight();
            int bestArea = best.getWidth() * best.getHeight();
            if (sizeFits && !bestFits) {
                best = size;
            } else if (sizeFits == bestFits && (sizeFits ? area > bestArea : area < bestArea)) {
                best = size;
            }
        }
        if (best == null) {
            best = Collections.min(Arrays.asList(sizes), Comparator.comparingInt(s -> s.getWidth() * s.getHeight()));
        }
        return best;
    }

    private static long boundedLong(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }

    private static void safeRelease(MediaRecorder recorder) {
        try {
            recorder.reset();
        } catch (RuntimeException ignored) {
        }
        try {
            recorder.release();
        } catch (RuntimeException ignored) {
        }
    }

    private static void closeRefs(CameraRefs refs) {
        if (refs.session != null) {
            try {
                refs.session.close();
            } catch (RuntimeException ignored) {
            }
        }
        if (refs.device != null) {
            try {
                refs.device.close();
            } catch (RuntimeException ignored) {
            }
        }
    }

    private static final class CameraRefs {
        CameraDevice device;
        CameraCaptureSession session;
    }

    private static final class ActiveVideo {
        final String sessionId;
        final String displayName;
        final File file;
        final MediaRecorder recorder;
        final CameraRefs refs;
        final HandlerThread thread;
        final Size size;
        final String cameraId;
        final long startedAtMs;

        ActiveVideo(String sessionId, String displayName, File file, MediaRecorder recorder,
                CameraRefs refs, HandlerThread thread, Size size, String cameraId) {
            this.sessionId = sessionId;
            this.displayName = displayName;
            this.file = file;
            this.recorder = recorder;
            this.refs = refs;
            this.thread = thread;
            this.size = size;
            this.cameraId = cameraId;
            this.startedAtMs = System.currentTimeMillis();
        }
    }
}
