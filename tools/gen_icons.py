"""Generate matching project icons (HS, SN, Br) at 16/32/48/128.
Style based on user's Canva reference: cream bg, paper-boat mark at top,
big serif letters centered, gold underline.
"""
from PIL import Image, ImageDraw, ImageFont
import os

BG = (237, 232, 221, 255)        # warm cream/grey #EDE8DD
INK = (31, 15, 44, 255)          # deep aubergine/navy #1F0F2C
GOLD = (201, 144, 70, 255)       # #C99046

FONT_PATH = "/System/Library/Fonts/Supplemental/Didot.ttc"  # Didone serif

def render(letters, size):
    # Render at 4x then downsample for crispness
    scale = 8 if size <= 32 else 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded square background
    radius = int(s * 0.11)
    draw.rounded_rectangle([(0, 0), (s - 1, s - 1)], radius=radius, fill=BG)

    line_w = max(int(s * 0.010), 1)

    # Paper boat removed — letters take the full center for legibility.
    show_boat = False
    if show_boat:
        # Ortus Club paper-boat logo, scaled to fit at the top of the icon.
        # Reference geometry: hull-top width = 68 units in a 128 viewBox.
        cx = s / 2
        cy = s * 0.22
        k = (s * 0.36) / 68  # boat hull-top width = 36% of icon width

        sail_apex   = (cx,            cy - 26 * k)
        sail_base_l = (cx - 18 * k,   cy +  8 * k)
        sail_base_r = (cx + 18 * k,   cy +  8 * k)
        hull_tl     = (cx - 34 * k,   cy +  8 * k)
        hull_tr     = (cx + 34 * k,   cy +  8 * k)
        hull_bl     = (cx - 20 * k,   cy + 26 * k)
        hull_br     = (cx + 20 * k,   cy + 26 * k)

        # Sail edges
        draw.line([sail_apex, sail_base_l], fill=INK, width=line_w)
        draw.line([sail_apex, sail_base_r], fill=INK, width=line_w)
        # Sail interior: vertical centerline (apex to base midpoint)
        draw.line([sail_apex, (cx, cy + 8 * k)], fill=INK, width=line_w)
        # Sail interior: horizontal midline, clipped to sail edges
        midline_y = (sail_apex[1] + sail_base_l[1]) / 2
        t = (midline_y - sail_apex[1]) / (sail_base_l[1] - sail_apex[1])
        ml_x = sail_apex[0] + t * (sail_base_l[0] - sail_apex[0])
        mr_x = sail_apex[0] + t * (sail_base_r[0] - sail_apex[0])
        draw.line([(ml_x, midline_y), (mr_x, midline_y)], fill=INK, width=line_w)
        # Hull top (deck) — full width
        draw.line([hull_tl, hull_tr], fill=INK, width=line_w)
        # Hull sides
        draw.line([hull_tl, hull_bl], fill=INK, width=line_w)
        draw.line([hull_tr, hull_br], fill=INK, width=line_w)
        # Hull bottom
        draw.line([hull_bl, hull_br], fill=INK, width=line_w)

    # Letters: pick font size based on count and whether boat is shown
    n = len(letters)
    if show_boat:
        if n == 1:    fs = int(s * 0.52)
        elif n == 2:  fs = int(s * 0.48)
        else:         fs = int(s * 0.40)
    else:
        # No boat — letters can be bigger and centered
        if n == 1:    fs = int(s * 0.70)
        elif n == 2:  fs = int(s * 0.62)
        else:         fs = int(s * 0.50)

    font = ImageFont.truetype(FONT_PATH, fs, index=2)  # Didot Bold
    bbox = draw.textbbox((0, 0), letters, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (s - tw) / 2 - bbox[0]
    if show_boat:
        ty = s * 0.55 - th / 2 - bbox[1]
    else:
        ty = (s - th) / 2 - bbox[1]
    draw.text((tx, ty), letters, fill=INK, font=font)

    # Gold underline
    line_y = int(s * 0.80) if show_boat else int(s * 0.86)
    pad_x = int(s * 0.18)
    line_h = max(int(s * 0.025), 2)
    draw.rectangle([(pad_x, line_y), (s - pad_x, line_y + line_h)], fill=GOLD)

    return img.resize((size, size), Image.LANCZOS)


PROJECTS = [
    {
        "letters": "HS",
        "dir": "/Users/antoniovarlese/Desktop/HS-Extension-worktree/Projects/HS Extension/icons",
        "prefix": "hs",
    },
    {
        "letters": "SN",
        "dir": "/Users/antoniovarlese/Desktop/Projects/Sales Nav Scraper/icons",
        "prefix": "icon",
    },
    {
        "letters": "Br",
        "dir": "/Users/antoniovarlese/Desktop/Projects/Client-AM-reminder/icons",
        "prefix": "brief-reminders",
    },
]

SIZES = [16, 32, 48, 128]

# For Sales Nav Scraper, existing names are icon16/icon32/icon48/icon128 (no dash)
def filename(prefix, size):
    if prefix == "icon":
        return f"{prefix}{size}.png"
    return f"{prefix}-{size}.png"

for p in PROJECTS:
    os.makedirs(p["dir"], exist_ok=True)
    for sz in SIZES:
        img = render(p["letters"], sz)
        out = os.path.join(p["dir"], filename(p["prefix"], sz))
        img.save(out)
        print(f"wrote {out}")
