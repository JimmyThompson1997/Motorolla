package com.pucky.device.media;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class MediaCacheControllerSourceTest {
    @Test
    public void cacheEnsureRequiresMediaIdAndUrl() throws Exception {
        String source = read("src/main/java/com/pucky/device/media/MediaCacheController.java");

        assertTrue(source.contains("public JSONObject ensure(JSONObject args)"));
        assertTrue(source.contains("media.cache.ensure requires url"));
        assertTrue(source.contains("media.cache command requires media_id"));
    }

    @Test
    public void hostedVmDownloadsAttachConfiguredPuckyApiToken() throws Exception {
        String source = read("src/main/java/com/pucky/device/media/MediaCacheController.java");

        assertTrue(source.contains("settings.getPuckyApiToken().trim()"));
        assertTrue(source.contains("shouldAttachAuthorization(url)"));
        assertTrue(source.contains("builder.header(\"Authorization\", \"Bearer \" + token)"));
        assertTrue(source.contains("URI.create"));
        assertTrue(source.contains("\"pucky.fly.dev\".equals(host)"));
        assertTrue(source.contains("\"10.0.2.2\".equals(host)"));
        assertTrue(source.contains("\"authorization_attached\""));
    }

    @Test
    public void repeatedEnsureUsesHashValidatedCacheHit() throws Exception {
        String source = read("src/main/java/com/pucky/device/media/MediaCacheController.java");

        assertTrue(source.contains("before.optBoolean(\"cache_hit\", false)"));
        assertTrue(source.contains("Json.put(before, \"source\", \"cache\")"));
        assertTrue(source.contains("Json.put(before, \"downloaded\", false)"));
        assertTrue(source.contains("exists && shaMatch"));
    }

    @Test
    public void corruptedCacheIsRejectedAndDownloadedAgain() throws Exception {
        String source = read("src/main/java/com/pucky/device/media/MediaCacheController.java");

        assertTrue(source.contains("expectedSha.equals(actualSha)"));
        assertTrue(source.contains("Media cache sha256 mismatch"));
        assertTrue(source.contains("target.exists() && !target.delete()"));
        assertTrue(source.contains("temp.renameTo(target)"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8).replace("\r\n", "\n");
    }
}
