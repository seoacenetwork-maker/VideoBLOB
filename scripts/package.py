"""Create a Chrome Web Store ZIP with the manifest at the archive root."""

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()

    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
    if manifest["manifest_version"] != 3:
        raise ValueError("Expected a Manifest V3 extension")
    entrypoints = [
        "manifest.json",
        manifest["background"]["service_worker"],
        manifest["action"]["default_popup"],
        *manifest["icons"].values(),
    ]
    for entrypoint in entrypoints:
        path = EXTENSION / entrypoint
        if not path.is_file() or not path.resolve().is_relative_to(EXTENSION):
            raise ValueError(f"Missing or invalid extension file: {entrypoint}")

    files = sorted(
        path for path in EXTENSION.rglob("*")
        if path.is_file() and not any(part.startswith(".") for part in path.relative_to(EXTENSION).parts)
    )
    args.output.mkdir(parents=True, exist_ok=True)
    destination = args.output / f"VideoBLOB-by-d3vski-{manifest['version']}.zip"
    with ZipFile(destination, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            if not path.resolve().is_relative_to(EXTENSION):
                raise ValueError(f"Invalid extension file: {path}")
            archive.write(path, path.relative_to(EXTENSION).as_posix())
    with ZipFile(destination) as archive:
        if archive.testzip() is not None or not set(entrypoints).issubset(archive.namelist()):
            raise ValueError("ZIP verification failed")
    print(destination.resolve())


if __name__ == "__main__":
    main()
