# Debug APK is the supported v1 bridgehead, but keep ONNX Runtime intact if a release build is produced.
-keep class ai.onnxruntime.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}
