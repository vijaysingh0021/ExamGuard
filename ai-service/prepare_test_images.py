"""Prepare authorized local samples as validated JPEG test assets."""

import argparse
from pathlib import Path
import sys

import cv2
import numpy as np


MAX_SOURCE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
HERE = Path(__file__).resolve().parent


def decode_image(path: Path):
    if not path.is_file():
        raise ValueError(f"Image file does not exist: {path}")
    size = path.stat().st_size
    if size == 0 or size > MAX_SOURCE_BYTES:
        raise ValueError(f"Image must be non-empty and no larger than {MAX_SOURCE_BYTES // (1024 * 1024)} MB: {path}")

    content = path.read_bytes()
    is_jpeg = content.startswith(b"\xff\xd8\xff")
    is_png = content.startswith(b"\x89PNG\r\n\x1a\n")
    is_webp = len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP"
    if not (is_jpeg or is_png or is_webp):
        raise ValueError(f"Image must be JPEG, PNG, or WebP: {path}")

    encoded = np.frombuffer(content, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError(f"Could not decode a color image: {path}")

    height, width = image.shape[:2]
    if width < 32 or height < 32 or width * height > MAX_IMAGE_PIXELS:
        raise ValueError(f"Image dimensions must be at least 32x32 and no larger than 40 megapixels: {path}")
    return image


def write_jpeg(image, destination: Path, replace_empty_placeholder: bool):
    if destination.exists():
        if not replace_empty_placeholder or not destination.is_file() or destination.stat().st_size != 0:
            raise FileExistsError(
                f"Refusing to overwrite existing test asset: {destination}. "
                "Move it yourself, or use --replace-empty-placeholder only for a zero-byte placeholder."
            )

    success, output = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not success:
        raise ValueError(f"Could not encode the validated image as JPEG: {destination.name}")

    mode = "wb" if destination.exists() else "xb"
    with destination.open(mode) as target:
        target.write(output.tobytes())

    check = cv2.imread(str(destination), cv2.IMREAD_COLOR)
    if check is None or check.shape[:2] != image.shape[:2]:
        raise ValueError(f"Prepared JPEG did not pass read-back validation: {destination.name}")
    return check.shape[1], check.shape[0]


def prepare(phone_image: Path, faces_image: Path, replace_empty_placeholder: bool = False):
    targets = (HERE / "test-phone.jpg", HERE / "test-faces.jpg")
    target_paths = {target.resolve() for target in targets}
    if phone_image.resolve() in target_paths or faces_image.resolve() in target_paths:
        raise ValueError("A source image cannot also be a test output.")

    phone = decode_image(phone_image)
    faces = decode_image(faces_image)

    for target in targets:
        if target.exists() and (
            not replace_empty_placeholder
            or not target.is_file()
            or target.stat().st_size != 0
        ):
            raise FileExistsError(
                f"Refusing to overwrite existing test asset: {target}. "
                "Move it yourself, or use --replace-empty-placeholder only for a zero-byte placeholder."
            )

    results = []
    for image, target in zip((phone, faces), targets):
        width, height = write_jpeg(image, target, replace_empty_placeholder)
        results.append((target.name, width, height))
    return results


def main():
    parser = argparse.ArgumentParser(
        description="Convert two authorized local samples to test-phone.jpg and test-faces.jpg. "
        "No images are downloaded or generated."
    )
    parser.add_argument("--phone-image", required=True, type=Path, help="Local authorized image with a visible phone")
    parser.add_argument("--faces-image", required=True, type=Path, help="Local authorized image with at least two visible faces")
    parser.add_argument(
        "--replace-empty-placeholder",
        action="store_true",
        help="Replace an existing zero-byte placeholder only; non-empty files are never overwritten.",
    )
    arguments = parser.parse_args()

    try:
        for name, width, height in prepare(
            arguments.phone_image,
            arguments.faces_image,
            arguments.replace_empty_placeholder,
        ):
            print(f"Prepared {name}: valid JPEG, {width}x{height}")
    except (OSError, ValueError) as error:
        print(f"Image preparation failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
