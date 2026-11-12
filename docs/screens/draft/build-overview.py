"""Assemble unchanged screen drafts into a review sheet and refresh metadata."""

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


root = Path(__file__).resolve().parent
manifest = json.loads((root / "manifest.json").read_text())
sheet = Image.new("RGB", (2048, 902), "#eaeaea")
draw = ImageDraw.Draw(sheet)
font_path = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
title_font = ImageFont.truetype(font_path, 21)
caption_font = ImageFont.truetype(font_path, 15)
draw.text((30, 18), "PR·SIM  /  SCREEN DRAFTS", fill="#222222", font=title_font)
draw.text(
    (30, 51),
    "Monochrome UI · Color portraits, camera & slides · 7 screens",
    fill="#666666",
    font=caption_font,
)

for index, entry in enumerate(manifest["screens"]):
    path = root / entry["file"]
    with Image.open(path) as screen:
        entry.update(width=screen.width, height=screen.height)
        # This only scales copies for the contact sheet; source PNGs are untouched.
        thumb = screen.convert("RGB")
        thumb.thumbnail((262, 648), Image.Resampling.LANCZOS)
        x = 30 + index * 288
        draw.text(
            (x, 91),
            f"{index + 1:02}  {entry['screen']}",
            fill="#222222",
            font=title_font,
        )
        sheet.paste(thumb, (x, 123))
    entry.update(bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())

sheet.save(root / "overview.png")
manifest.update(
    revision="monochrome-ui-color-content",
    previous_version="archive/pre-color-content/",
    color_policy="Monochrome brand/UI; full-color judge portraits, presenter camera and original PDF slides.",
)
(root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
print("Updated overview.png and manifest.json for all seven screens.")
