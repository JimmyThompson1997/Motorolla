from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from time import monotonic

from livekit import rtc
from livekit.agents.utils.audio import audio_frames_from_file


async def _publish_wav(args: argparse.Namespace) -> dict[str, object]:
    room = rtc.Room()
    started = monotonic()
    frames = 0
    samples = 0
    try:
        await room.connect(args.url, args.token)
        if args.pre_roll_seconds > 0:
            await asyncio.sleep(args.pre_roll_seconds)
        source = rtc.AudioSource(args.sample_rate, args.channels)
        track = rtc.LocalAudioTrack.create_audio_track(args.track_name, source)
        options = rtc.TrackPublishOptions()
        options.source = rtc.TrackSource.SOURCE_MICROPHONE
        publication = await room.local_participant.publish_track(track, options)

        async for frame in audio_frames_from_file(
            args.wav,
            sample_rate=args.sample_rate,
            num_channels=args.channels,
        ):
            frames += 1
            samples += frame.samples_per_channel
            await source.capture_frame(frame)

        await source.wait_for_playout()
        await asyncio.sleep(args.post_roll_seconds)
        return {
            "ok": True,
            "room": args.room,
            "identity": args.identity,
            "track_sid": getattr(publication, "sid", None),
            "frames": frames,
            "samples": samples,
            "sample_rate": args.sample_rate,
            "channels": args.channels,
            "duration_seconds": round(samples / args.sample_rate, 3)
            if args.sample_rate
            else None,
            "elapsed_seconds": round(monotonic() - started, 3),
            "pre_roll_seconds": args.pre_roll_seconds,
            "post_roll_seconds": args.post_roll_seconds,
        }
    finally:
        await room.disconnect()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Publish a WAV file as a LiveKit microphone participant."
    )
    parser.add_argument("--url", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--room", required=True)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--wav", required=True)
    parser.add_argument("--track-name", default="synthetic_mic")
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--channels", type=int, default=1)
    parser.add_argument("--pre-roll-seconds", type=float, default=0.0)
    parser.add_argument("--post-roll-seconds", type=float, default=1.0)
    return parser


def main() -> None:
    args = _parser().parse_args()
    wav = Path(args.wav)
    if not wav.is_file():
        raise SystemExit(f"WAV file not found: {wav}")
    result = asyncio.run(_publish_wav(args))
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
