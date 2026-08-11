"""Regenerate static/ShangjiaTool.ico with a transparent background.

The previous .ico embedded a solid white layer (a "white box") around the dark
brand mark. This script flips near-white pixels to transparent while keeping the
dark pencil mark intact, then saves a standard multi-size ICO file.

Usage:
    venv\\Scripts\\python.exe scripts\\generate_icon.py
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "static" / "ShangjiaTool.ico"
TARGET = SOURCE

# Pixels are treated as background when every RGB channel is this bright.
WHITE_THRESHOLD = 232
# Remnant alpha preserved at threshold (keeps a soft anti-aliased edge).
SOFTEN_FALLOFF = 24.0


def remove_white_background(pixel):
    """Return an RGBA pixel tuple with white areas made transparent."""
    r, g, b, a = pixel
    if a == 0:
        return pixel
    whiteness = min(r, g, b)
    if whiteness >= WHITE_THRESHOLD:
        # Fully white background → fully transparent.
        return (r, g, b, 0)
    if whiteness >= WHITE_THRESHOLD - SOFTEN_FALLOFF:
        # Edge halo: ramp alpha down to avoid harsh 1px white outlines.
        factor = 1.0 - (whiteness - (WHITE_THRESHOLD - SOFTEN_FALLOFF)) / SOFTEN_FALLOFF
        return (r, g, b, max(0, int(a * factor)))
    return pixel


def main():
    if not SOURCE.exists():
        print(f"source icon missing: {SOURCE}")
        return 1

    with Image.open(SOURCE) as source:
        rgba = source.convert("RGBA")
        width, height = rgba.size

    pixels = [remove_white_background(pixel) for pixel in rgba.getdata()]
    transparent = Image.new("RGBA", (width, height))
    transparent.putdata(pixels)

    # A little Gaussian blur on the alpha channel removes jagged 1px edges.
    alpha = transparent.getchannel("A").filter(ImageFilter.GaussianBlur(0.8))
    transparent.putalpha(alpha)
    transparent = transparent.convert("RGB", palette=Image.ADAPTIVE, colors=256)
    transparent = transparent.convert("RGBA")
    transparent.putalpha(alpha)

    sizes = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]
    transparent.save(TARGET, format="ICO", sizes=sizes)

    with Image.open(TARGET) as check:
        frames = getattr(check, "n_frames", 1)
    print(f"regenerated {TARGET} with {frames} frame(s)")
    print("sizes:", " ".join(f"{w}x{h}" for w, h in sizes))
    return 0


if __name__ == "__main__":
    sys.exit(main())