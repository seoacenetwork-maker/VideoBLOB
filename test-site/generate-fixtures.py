"""Generate the local clips using FFmpeg 7.1 with libx264, libvpx and libopus."""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "dist" / "media"
FFMPEG = sys.argv[1] if len(sys.argv) > 1 else shutil.which("ffmpeg")
if not FFMPEG:
    raise SystemExit("Pass the path to ffmpeg as the first argument.")


def ffmpeg(*arguments):
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *arguments],
        cwd=ROOT,
        check=True,
    )


for folder in ("hls/large", "hls/small", "hls/ts", "dash/av", "dash/video"):
    (ROOT / folder).mkdir(parents=True, exist_ok=True)

ffmpeg(
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=8",
    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=8",
    "-af", "volume=0.12", "-c:v", "libx264", "-profile:v", "baseline", "-level", "3.0",
    "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "23", "-g", "48",
    "-sc_threshold", "0", "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart",
    "-map_metadata", "-1", "sample.mp4",
)
ffmpeg(
    "-i", "sample.mp4", "-vf", "scale=426:240", "-c:v", "libvpx-vp9", "-b:v", "0",
    "-crf", "34", "-c:a", "libopus", "-b:a", "32k", "sample.webm",
)
ffmpeg("-ss", "2", "-i", "sample.mp4", "-frames:v", "1", "-q:v", "4", "poster.jpg")

for name, size in (("large", "640:360"), ("small", "320:180")):
    ffmpeg(
        "-i", "sample.mp4", "-vf", f"scale={size}", "-c:v", "libx264", "-profile:v",
        "baseline", "-level", "3.0", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf",
        "24", "-g", "48", "-sc_threshold", "0", "-c:a", "copy", "-f", "hls", "-hls_time",
        "2", "-hls_playlist_type", "vod", "-hls_segment_type", "fmp4",
        "-hls_fmp4_init_filename", "init.mp4", "-hls_segment_filename",
        f"hls/{name}/part%02d.m4s", f"hls/{name}/index.m3u8",
    )

ffmpeg(
    "-i", "sample.mp4", "-c", "copy", "-f", "hls", "-hls_time", "2",
    "-hls_playlist_type", "vod", "-hls_segment_filename", "hls/ts/part%02d.ts",
    "hls/ts/index.m3u8",
)
dash_options = (
    "-c", "copy", "-f", "dash", "-seg_duration", "2", "-use_template", "1", "-use_timeline",
    "1", "-init_seg_name", "init-$RepresentationID$.mp4", "-media_seg_name",
    "part-$RepresentationID$-$Number%03d$.m4s",
)
ffmpeg(
    "-i", "sample.mp4", "-map", "0:v", "-map", "0:a", *dash_options,
    "-adaptation_sets", "id=0,streams=v id=1,streams=a", "dash/av/manifest.mpd",
)
ffmpeg(
    "-i", "sample.mp4", "-map", "0:v", *dash_options,
    "-adaptation_sets", "id=0,streams=v", "dash/video/manifest.mpd",
)
