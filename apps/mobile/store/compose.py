"""Build the App Store icon and 6.9-inch screenshots from simulator captures.

Apple asks for 1320×2868 portraits for the 6.9-inch iPhone display.
Run from the repo root: python3 apps/mobile/store/compose.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT = ROOT / "screenshots"
ICON_SRC = ROOT.parent / "assets" / "images" / "icon.png"
ICON_OUT = ROOT / "icon" / "app-store-icon-1024.png"
APP_ICON = ICON_SRC

W, H = 1320, 2868
BG = (246, 241, 232)
INK = (37, 45, 53)
MUTED = (100, 115, 108)
ACCENT = (196, 122, 78)
CREAM = (254, 247, 239)
FONT = Path.home() / "Library" / "Fonts"
SOURCE_RADIUS = 165

FRAMES = [
    (
        "01-discover",
        "01-home.png",
        {
            "sv": ("Se vad som händer nära dig", "Musik, kultur, idrott och familj, samlat för din stad."),
            "en": ("See what's happening\nnear you", "Music, culture, sports, and family, gathered for your town."),
        },
    ),
    (
        "02-detail",
        "03-event.png",
        {
            "sv": ("Allt du behöver innan du går", "Tid, plats, biljetter och en påminnelse."),
            "en": ("Everything you need\nbefore you go", "Time, place, tickets, and a reminder."),
        },
    ),
    (
        "03-search",
        "09-search.png",
        {
            "sv": ("Sök på det du är sugen på", "Filtrera på kategori, dag och pris."),
            "en": ("Search for what\nyou feel like", "Filter by category, day, and price."),
        },
    ),
    (
        "04-map",
        "06-map.png",
        {
            "sv": ("Hitta dem på kartan", "En nål för varje evenemang runt dig."),
            "en": ("Find them on the map", "A pin for every event around you."),
        },
    ),
]


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT / name), size)


def wrap(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    lines: list[str] = []
    for paragraph in text.split("\n"):
        current = ""
        for word in paragraph.split():
            trial = word if not current else f"{current} {word}"
            if draw.textlength(trial, font=face) <= max_w:
                current = trial
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
    return lines


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def phone(path: Path, width: int) -> Image.Image:
    shot = Image.open(path).convert("RGBA")
    scale = width / shot.width
    height = round(shot.height * scale)
    shot = shot.resize((width, height), Image.Resampling.LANCZOS)
    radius = max(24, round(SOURCE_RADIUS * scale))
    shot.putalpha(rounded_mask(shot.size, radius))
    return shot


def frame(shot_path: Path, headline: str, subhead: str, dest: Path) -> None:
    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    headline_font = font("SF-Pro-Display-Bold.otf", 84)
    sub_font = font("SF-Pro-Display-Regular.otf", 40)
    kicker_font = font("SF-Pro-Display-Semibold.otf", 32)
    text_w = W - 144
    kicker = "Evently"
    kicker_w = draw.textlength(kicker, font=kicker_font)
    y = 168
    draw.text(((W - kicker_w) / 2, y), kicker, font=kicker_font, fill=ACCENT)
    y += 64
    head_lines = wrap(draw, headline, headline_font, text_w)
    for line in head_lines:
        line_w = draw.textlength(line, font=headline_font)
        draw.text(((W - line_w) / 2, y), line, font=headline_font, fill=INK)
        y += 96
    y += 8
    sub_lines = wrap(draw, subhead, sub_font, text_w)
    for line in sub_lines:
        line_w = draw.textlength(line, font=sub_font)
        draw.text(((W - line_w) / 2, y), line, font=sub_font, fill=MUTED)
        y += 54
    y += 56
    bottom = 64
    available = H - y - bottom
    # Full screen, including the tab bar, kept inside the canvas.
    target_w = min(1120, int(available * (1206 / 2622)))
    device = phone(shot_path, target_w)
    if device.height > available:
        crop = device.crop((0, 0, device.width, available))
        device = crop
    shadow = Image.new("RGBA", (device.width + 80, device.height + 80), (0, 0, 0, 0))
    shadow_mask = Image.new("L", shadow.size, 0)
    ImageDraw.Draw(shadow_mask).rounded_rectangle(
        (40, 36, 40 + device.width, 36 + device.height),
        radius=max(24, round(SOURCE_RADIUS * device.width / 1206)),
        fill=70,
    )
    shadow.putalpha(shadow_mask.filter(ImageFilter.GaussianBlur(28)))
    x = (W - device.width) // 2
    canvas.paste(shadow, (x - 40, y - 20), shadow)
    canvas.paste(device, (x, y), device)
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG", optimize=True)
    print(f"{dest.relative_to(ROOT)} {canvas.size}")


def app_store_icon() -> None:
    src = Image.open(ICON_SRC).convert("RGBA")
    plate = Image.new("RGBA", (1024, 1024), (*CREAM, 255))
    plate.alpha_composite(src, ((1024 - src.width) // 2, (1024 - src.height) // 2))
    rgb = plate.convert("RGB")
    ICON_OUT.parent.mkdir(parents=True, exist_ok=True)
    rgb.save(ICON_OUT, "PNG", optimize=True)
    rgb.save(APP_ICON, "PNG", optimize=True)
    print(f"icon {rgb.size} mode {rgb.mode}")


def main() -> None:
    app_store_icon()
    for name, raw_name, copy in FRAMES:
        for locale, (headline, subhead) in copy.items():
            raw = RAW / "en" / raw_name if locale == "en" else RAW / raw_name
            frame(raw, headline, subhead, OUT / locale / f"{name}.png")


if __name__ == "__main__":
    main()
