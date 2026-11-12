"""Writes the invented HEIC test images in this folder (issue #147).

Nothing here is a photo: every image is drawn from flat colours, rectangles and gradients. HEIC
needs an HEVC encoder, which the server does not have, so the files are made with pillow-heif
(libheif with x265) and committed. To make them again, from the repo root:

    uv run --with pillow-heif==1.8.1 python server/test/fixtures/heic/make.py

With `--large DIR` it writes into DIR, not into the repo, the 12-, 24- and 48-megapixel images
that server/scripts/heic-memory.ts measures.
"""

import struct
import sys
from pathlib import Path

import pillow_heif
from PIL import Image, ImageDraw

HERE = Path(__file__).parent
ORIENTATION = 0x0112


def exif_with(orientation):
    exif = Image.Exif()
    exif[ORIENTATION] = orientation
    return exif.tobytes()


def marked(size, background, marker):
    """A flat image with a marker in its top-left quarter, to see where the top-left ends up."""
    img = Image.new("RGB", size, background)
    w, h = size
    ImageDraw.Draw(img).rectangle([0, 0, w // 2 - 1, h // 2 - 1], fill=marker)
    return img


def scene(size):
    """A large invented picture: a page of ruled lines on a gradient."""
    w, h = size
    across = Image.linear_gradient("L").rotate(90).resize(size)
    down = Image.linear_gradient("L").resize(size)
    img = Image.merge("RGB", (down, across, Image.new("L", size, 120)))
    draw = ImageDraw.Draw(img)
    draw.rectangle([w // 8, h // 8, w * 7 // 8, h * 7 // 8], fill=(236, 228, 210))
    for row in range(12):
        top = h // 6 + row * h // 18
        draw.rectangle([w // 6, top, w * 5 // 6, top + h // 60], fill=(70, 60, 50))
    return img


def small():
    # How an iPhone keeps a portrait photo: stored landscape (96 x 64) with an irot box, and EXIF
    # orientation 6 (turn 90 degrees clockwise) as well. pillow-heif writes both from the tag.
    rotated = marked((96, 64), (200, 40, 40), (40, 40, 200))
    pillow_heif.from_pillow(rotated).save(HERE / "rotated.heic", quality=90, exif=exif_with(6))

    # Several images in one file: the second is the primary one, the one a viewer shows, and has
    # a thumbnail of its own.
    heif = pillow_heif.from_pillow(Image.new("RGB", (80, 60), (220, 30, 30)))
    primary = heif.add_from_pillow(Image.new("RGB", (120, 90), (30, 200, 60)))
    primary.info["thumbnails"] = [32]
    heif.save(HERE / "two-images.heic", quality=90, primary_index=1)

    # Ten bits per colour, as some cameras write: 16-bit samples, which pillow-heif saves as 10 bits.
    w, h = 64, 48
    pixel = struct.pack("<HHH", 90 * 257, 120 * 257, 200 * 257)
    pillow_heif.from_bytes("RGB;16", (w, h), pixel * (w * h)).save(HERE / "ten-bit.heic", quality=90)

    # An iPhone's usual photo: 12 megapixels in tiles of 512 pixels, held as a portrait with irot.
    page = scene((4032, 3024))
    pillow_heif.from_pillow(page).save(HERE / "portrait-12mp.heic", quality=30, tile_size=512, exif=exif_with(6))


def large(out):
    out.mkdir(parents=True, exist_ok=True)
    # Apple's sizes: 12 MP (4032 x 3024), 24 MP (5712 x 4284) and 48 MP (8064 x 6048), in
    # tiles of 512 pixels as an iPhone writes them, and held as a portrait with irot.
    for name, size in (("12mp", (4032, 3024)), ("24mp", (5712, 4284)), ("48mp", (8064, 6048))):
        path = out / f"{name}.heic"
        pillow_heif.from_pillow(scene(size)).save(path, quality=60, tile_size=512, exif=exif_with(6))
        print(path, path.stat().st_size)
    # The worst case for memory: 48 megapixels at 10 bits, whose samples libheif converts down to 8.
    eight = scene((8064, 6048)).tobytes()
    sixteen = bytearray(len(eight) * 2)
    sixteen[0::2] = eight
    sixteen[1::2] = eight
    path = out / "48mp-10bit.heic"
    pillow_heif.from_bytes("RGB;16", (8064, 6048), bytes(sixteen)).save(path, quality=60, tile_size=512)
    print(path, path.stat().st_size)


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--large":
        large(Path(sys.argv[2]))
    else:
        small()
