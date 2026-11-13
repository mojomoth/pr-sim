"""Copy DANSANG BI into public/ui/brand, preserving the vector master ratio.

Run from pocs/: python3 ui/scripts/prepare-brand.py
For a full SVG export and icon sync: python3 ../assets/bi/extract.py
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]  # pocs/
src_dir = root.parent / "assets" / "bi"
out_dir = root / "public" / "ui" / "brand"
out_dir.mkdir(parents=True, exist_ok=True)

for name in ["lockup-black", "symbol-black"]:
    im = Image.open(src_dir / f"{name}.png").convert("RGBA")
    im = im.crop(im.getchannel("A").getbbox())
    h = 96  # 3x of 32px display height
    w = round(im.width * h / im.height)
    im.resize((w, h), Image.LANCZOS).save(out_dir / f"{name}.png", optimize=True)
    print(name, (w, h), "ratio", round(w / h, 4))
