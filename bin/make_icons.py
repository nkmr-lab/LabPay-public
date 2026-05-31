#!/usr/bin/env python3
"""Generate LabPay PWA icons.
Outputs PNGs into ../public/icons/. Run from the project root or anywhere.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

THEME = "#4a106d"          # Meiji 紫紺 (shikon)
BG_TRANSPARENT = (0, 0, 0, 0)

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "img"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _try_font(size: int) -> ImageFont.FreeTypeFont:
    # Try a few likely-available system fonts; fall back to PIL default.
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf",   # Segoe UI Bold
        r"C:\Windows\Fonts\arialbd.ttf",    # Arial Bold
        r"C:\Windows\Fonts\arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    ]
    for p in candidates:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def make_icon(size: int, *, maskable: bool, out: Path) -> None:
    img = Image.new("RGBA", (size, size), BG_TRANSPARENT)
    draw = ImageDraw.Draw(img)
    if maskable:
        # Fill the full square so safe area is honored after the OS masks it
        draw.rectangle([0, 0, size, size], fill=THEME)
        radius = 0
        # Shrink the glyph so it stays inside the safe area (~80% in center)
        glyph_size = int(size * 0.55)
        cx = size // 2
        cy = int(size * 0.50)
    else:
        radius = size // 5
        draw.rounded_rectangle([0, 0, size, size], radius=radius, fill=THEME)
        glyph_size = int(size * 0.70)
        cx = size // 2
        cy = int(size * 0.52)

    font = _try_font(glyph_size)
    text = "P"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = cx - tw // 2 - bbox[0]
    y = cy - th // 2 - bbox[1]
    draw.text((x, y), text, fill="white", font=font)

    img.save(out, "PNG", optimize=True)


def main() -> None:
    targets = [
        # (filename, size, maskable)
        ("apple-touch-icon.png",   180, False),
        ("icon-192.png",           192, False),
        ("icon-512.png",           512, False),
        ("icon-512-maskable.png",  512, True),
        ("favicon-32.png",         32,  False),
    ]
    for name, size, maskable in targets:
        out = OUT_DIR / name
        make_icon(size, maskable=maskable, out=out)
        print(f"wrote {out} ({size}x{size}{' maskable' if maskable else ''})")


if __name__ == "__main__":
    main()
