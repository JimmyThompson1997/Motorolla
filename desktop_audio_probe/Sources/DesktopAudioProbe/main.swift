import AVFoundation
import CoreMedia
import CryptoKit
import Foundation
import ScreenCaptureKit

enum ProbeError: Error, CustomStringConvertible {
    case message(String)

    var description: String {
        switch self {
        case .message(let value):
            return value
        }
    }
}

struct Options {
    var mode = "fixture"
    var duration = 5.0
    var baseURL = ""
    var token = ""
    var bundleID = ""
    var deviceID = ProcessInfo.processInfo.hostName
    var outDir = ".tmp/desktop-audio-probe"
    var upload = true

    static func parse(_ args: [String]) throws -> Options {
        var options = Options()
        var index = 0
        while index < args.count {
            let arg = args[index]
            func value() throws -> String {
                guard index + 1 < args.count else {
                    throw ProbeError.message("missing_value_for_\(arg)")
                }
                index += 1
                return args[index]
            }
            switch arg {
            case "--mode":
                options.mode = try value()
            case "--duration":
                guard let parsed = Double(try value()), parsed > 0 else {
                    throw ProbeError.message("invalid_duration")
                }
                options.duration = parsed
            case "--base-url":
                options.baseURL = try value()
            case "--token":
                options.token = try value()
            case "--bundle-id":
                options.bundleID = try value()
            case "--device-id":
                options.deviceID = try value()
            case "--out-dir":
                options.outDir = try value()
            case "--no-upload":
                options.upload = false
            case "--help", "-h":
                throw ProbeError.message(Self.help)
            default:
                throw ProbeError.message("unknown_argument_\(arg)")
            }
            index += 1
        }
        if !["fixture", "mic", "system", "dual"].contains(options.mode) {
            throw ProbeError.message("mode_must_be_fixture_mic_system_or_dual")
        }
        if options.upload && (options.baseURL.isEmpty || options.token.isEmpty) {
            throw ProbeError.message("upload_requires_base_url_and_token")
        }
        if options.bundleID.isEmpty {
            let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "").replacingOccurrences(of: ".", with: "")
            options.bundleID = "desktop-audio-\(options.mode)-\(stamp)"
        }
        return options
    }

    static let help = """
    desktop-audio-probe --mode fixture|mic|system|dual --base-url URL --token TOKEN [--duration seconds]
      --no-upload records/writes local tracks without calling the server.
    """
}

struct TrackFile {
    let trackID: String
    let kind: String
    let mimeType: String
    let url: URL

    var bytes: Int {
        (try? Data(contentsOf: url).count) ?? 0
    }

    var sha256: String {
        let data = (try? Data(contentsOf: url)) ?? Data()
        return hexSHA256(data)
    }

    var manifest: [String: Any] {
        [
            "track_id": trackID,
            "kind": kind,
            "mime_type": mimeType,
            "bytes": bytes,
            "sha256": sha256,
        ]
    }
}

@main
struct DesktopAudioProbe {
    static func main() async {
        do {
            let options = try Options.parse(Array(CommandLine.arguments.dropFirst()))
            let summary = try await run(options)
            print(jsonString(summary))
        } catch {
            let payload: [String: Any] = [
                "schema": "pucky.desktop_audio_probe_error.v1",
                "ok": false,
                "error": String(describing: error),
            ]
            print(jsonString(payload))
            Foundation.exit(1)
        }
    }

    static func run(_ options: Options) async throws -> [String: Any] {
        let outDir = URL(fileURLWithPath: options.outDir, isDirectory: true)
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        let tracks = try await captureTracks(options: options, outDir: outDir)
        let uploadSummary = options.upload
            ? try await DesktopAudioClient(baseURL: options.baseURL, token: options.token)
                .upload(bundleID: options.bundleID, deviceID: options.deviceID, platform: "macos", tracks: tracks)
            : ["skipped": true]
        let summary: [String: Any] = [
            "schema": "pucky.desktop_audio_probe.v1",
            "ok": true,
            "mode": options.mode,
            "bundle_id": options.bundleID,
            "device_id": options.deviceID,
            "out_dir": outDir.path,
            "tracks": tracks.map { track in
                [
                    "track_id": track.trackID,
                    "kind": track.kind,
                    "mime_type": track.mimeType,
                    "path": track.url.path,
                    "bytes": track.bytes,
                    "sha256": track.sha256,
                ]
            },
            "upload": uploadSummary,
        ]
        let summaryURL = outDir.appendingPathComponent("\(options.bundleID)-summary.json")
        try jsonString(summary).write(to: summaryURL, atomically: true, encoding: .utf8)
        return summary
    }
}

func captureTracks(options: Options, outDir: URL) async throws -> [TrackFile] {
    switch options.mode {
    case "fixture":
        return [try writeFixtureTrack(outDir: outDir, duration: options.duration)]
    case "mic":
        return [try await captureMicTrack(outDir: outDir, duration: options.duration)]
    case "system":
        return [try await captureSystemTrack(outDir: outDir, duration: options.duration)]
    case "dual":
        async let mic = captureMicTrack(outDir: outDir, duration: options.duration)
        async let system = captureSystemTrack(outDir: outDir, duration: options.duration)
        return try await [mic, system]
    default:
        throw ProbeError.message("unsupported_mode")
    }
}

func writeFixtureTrack(outDir: URL, duration: Double) throws -> TrackFile {
    let url = outDir.appendingPathComponent("fixture.wav")
    try makeSineWav(duration: duration).write(to: url, options: .atomic)
    return TrackFile(trackID: "fixture", kind: "fixture", mimeType: "audio/wav", url: url)
}

func captureMicTrack(outDir: URL, duration: Double) async throws -> TrackFile {
    let granted = await AVCaptureDevice.requestAccess(for: .audio)
    guard granted else {
        throw ProbeError.message("microphone_permission_denied")
    }
    let url = outDir.appendingPathComponent("mic.m4a")
    try? FileManager.default.removeItem(at: url)
    let recorder = try AVAudioRecorder(
        url: url,
        settings: [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
    )
    recorder.prepareToRecord()
    guard recorder.record(forDuration: duration) else {
        throw ProbeError.message("microphone_record_start_failed")
    }
    try await Task.sleep(nanoseconds: UInt64((duration + 0.5) * 1_000_000_000))
    recorder.stop()
    try requireNonEmptyFile(url, error: "microphone_capture_empty")
    return TrackFile(trackID: "mic", kind: "mic", mimeType: "audio/mp4", url: url)
}

func captureSystemTrack(outDir: URL, duration: Double) async throws -> TrackFile {
    guard #available(macOS 13.0, *) else {
        throw ProbeError.message("system_audio_requires_macos_13")
    }
    let url = outDir.appendingPathComponent("system.m4a")
    try? FileManager.default.removeItem(at: url)
    let recorder = try SystemAudioRecorder(outputURL: url)
    try await recorder.record(duration: duration)
    try requireNonEmptyFile(url, error: "system_audio_capture_empty")
    return TrackFile(trackID: "system", kind: "system", mimeType: "audio/mp4", url: url)
}

@available(macOS 13.0, *)
final class SystemAudioRecorder: NSObject, @unchecked Sendable, SCStreamOutput, SCStreamDelegate {
    private let outputURL: URL
    private let writer: AVAssetWriter
    private let queue = DispatchQueue(label: "pucky.desktop-audio.system")
    private var input: AVAssetWriterInput?
    private var started = false
    private var sampleCount = 0

    init(outputURL: URL) throws {
        self.outputURL = outputURL
        self.writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        super.init()
    }

    func record(duration: Double) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw ProbeError.message("system_audio_no_display_available")
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = false
        if #available(macOS 13.2, *) {
            configuration.sampleRate = 48_000
            configuration.channelCount = 2
        }
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await stream.startCapture()
        try await Task.sleep(nanoseconds: UInt64(max(0.1, duration) * 1_000_000_000))
        try await stream.stopCapture()
        try await finish()
        if sampleCount <= 0 {
            throw ProbeError.message("system_audio_no_samples")
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else {
            return
        }
        guard CMSampleBufferIsValid(sampleBuffer), CMSampleBufferDataIsReady(sampleBuffer) else {
            return
        }
        do {
            try append(sampleBuffer)
        } catch {
            // ScreenCaptureKit has no throwing callback surface. The proof catches this as no/empty output.
        }
    }

    private func append(_ sampleBuffer: CMSampleBuffer) throws {
        if input == nil {
            guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
                  let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
                throw ProbeError.message("system_audio_format_missing")
            }
            let audioDescription = streamDescription.pointee
            let channels = max(1, Int(audioDescription.mChannelsPerFrame))
            let sampleRate = max(8_000, Int(audioDescription.mSampleRate))
            let newInput = AVAssetWriterInput(
                mediaType: .audio,
                outputSettings: [
                    AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                    AVSampleRateKey: sampleRate,
                    AVNumberOfChannelsKey: channels,
                    AVEncoderBitRateKey: 128_000,
                ]
            )
            newInput.expectsMediaDataInRealTime = true
            guard writer.canAdd(newInput) else {
                throw ProbeError.message("system_audio_writer_input_rejected")
            }
            writer.add(newInput)
            guard writer.startWriting() else {
                throw ProbeError.message("system_audio_writer_start_failed")
            }
            writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
            input = newInput
            started = true
        }
        guard let input = input, input.isReadyForMoreMediaData else {
            return
        }
        if input.append(sampleBuffer) {
            sampleCount += 1
        }
    }

    private func finish() async throws {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                guard self.started else {
                    continuation.resume()
                    return
                }
                self.input?.markAsFinished()
                self.writer.finishWriting {
                    if let error = self.writer.error {
                        continuation.resume(throwing: error)
                    } else {
                        continuation.resume()
                    }
                }
            }
        }
    }
}

struct DesktopAudioClient {
    let baseURL: String
    let token: String

    func upload(bundleID: String, deviceID: String, platform: String, tracks: [TrackFile]) async throws -> [String: Any] {
        let initPayload: [String: Any] = [
            "bundle_id": bundleID,
            "device_id": deviceID,
            "platform": platform,
            "started_at": isoNow(),
            "ended_at": isoNow(),
            "tracks": tracks.map { $0.manifest },
        ]
        let initResponse = try await postJSON("/api/desktop-audio/v1/bundles/init", initPayload)
        guard let uploads = initResponse["uploads"] as? [[String: Any]] else {
            throw ProbeError.message("init_response_missing_uploads")
        }
        var uploadResponses: [[String: Any]] = []
        for track in tracks {
            guard let upload = uploads.first(where: { String(describing: $0["track_id"] ?? "") == track.trackID }),
                  let path = upload["upload_url"] as? String else {
                throw ProbeError.message("missing_upload_url_for_\(track.trackID)")
            }
            let data = try Data(contentsOf: track.url)
            uploadResponses.append(try await putData(path, data, mimeType: track.mimeType, sha256: track.sha256))
        }
        guard let completePath = initResponse["complete_url"] as? String else {
            throw ProbeError.message("init_response_missing_complete_url")
        }
        let complete = try await postJSON(completePath, [:])
        let detail = try await getJSON("/api/desktop-audio/v1/bundles/\(bundleID)")
        return [
            "init": initResponse,
            "uploads": uploadResponses,
            "complete": complete,
            "detail": detail,
        ]
    }

    private func getJSON(_ path: String) async throws -> [String: Any] {
        var request = URLRequest(url: try absoluteURL(path))
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return try await sendJSON(request)
    }

    private func postJSON(_ path: String, _ payload: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: try absoluteURL(path))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        return try await sendJSON(request)
    }

    private func putData(_ path: String, _ data: Data, mimeType: String, sha256: String) async throws -> [String: Any] {
        var request = URLRequest(url: try absoluteURL(path))
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue(sha256, forHTTPHeaderField: "X-Pucky-Content-Sha256")
        request.httpBody = data
        return try await sendJSON(request)
    }

    private func sendJSON(_ request: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw ProbeError.message("http_\(status)_\(body)")
        }
        let parsed = try JSONSerialization.jsonObject(with: data)
        guard let object = parsed as? [String: Any] else {
            throw ProbeError.message("json_response_not_object")
        }
        return object
    }

    private func absoluteURL(_ path: String) throws -> URL {
        if let url = URL(string: path), url.scheme != nil {
            return url
        }
        guard let base = URL(string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) else {
            throw ProbeError.message("invalid_base_url")
        }
        guard let url = URL(string: path, relativeTo: base)?.absoluteURL else {
            throw ProbeError.message("invalid_url_\(path)")
        }
        return url
    }
}

func makeSineWav(duration: Double, frequency: Double = 440.0, sampleRate: Int = 44_100) -> Data {
    let channels = 1
    let bitsPerSample = 16
    let frameCount = max(1, Int(duration * Double(sampleRate)))
    let byteRate = sampleRate * channels * bitsPerSample / 8
    let blockAlign = channels * bitsPerSample / 8
    let dataSize = frameCount * blockAlign
    var data = Data()
    data.appendString("RIFF")
    data.appendLE(UInt32(36 + dataSize))
    data.appendString("WAVE")
    data.appendString("fmt ")
    data.appendLE(UInt32(16))
    data.appendLE(UInt16(1))
    data.appendLE(UInt16(channels))
    data.appendLE(UInt32(sampleRate))
    data.appendLE(UInt32(byteRate))
    data.appendLE(UInt16(blockAlign))
    data.appendLE(UInt16(bitsPerSample))
    data.appendString("data")
    data.appendLE(UInt32(dataSize))
    for frame in 0..<frameCount {
        let sample = sin(2.0 * Double.pi * frequency * Double(frame) / Double(sampleRate))
        data.appendLE(Int16(sample * 16_000.0))
    }
    return data
}

func requireNonEmptyFile(_ url: URL, error: String) throws {
    let values = try url.resourceValues(forKeys: [.fileSizeKey])
    guard (values.fileSize ?? 0) > 0 else {
        throw ProbeError.message(error)
    }
}

func hexSHA256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func isoNow() -> String {
    ISO8601DateFormatter().string(from: Date())
}

func jsonString(_ payload: [String: Any]) -> String {
    let data = try! JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
    return String(data: data, encoding: .utf8)!
}

extension Data {
    mutating func appendString(_ value: String) {
        append(value.data(using: .ascii)!)
    }

    mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
        var little = value.littleEndian
        Swift.withUnsafeBytes(of: &little) { buffer in
            append(contentsOf: buffer)
        }
    }
}
