"""Copy the approved BI lockup (assets/bi/lockup-black.png) into public/ui/brand/.

Trims only the transparent 24px export padding (geometry untouched, aspect ratio kept)
and writes a 3x-retina copy for the 32px-high header logo. Run from pocs/:
    python3 ui/scripts/prepare-brand.py
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
