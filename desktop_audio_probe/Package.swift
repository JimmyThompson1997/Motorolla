// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DesktopAudioProbe",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "desktop-audio-probe", targets: ["DesktopAudioProbe"])
    ],
    targets: [
        .executableTarget(name: "DesktopAudioProbe")
    ],
    swiftLanguageVersions: [.v5]
)
