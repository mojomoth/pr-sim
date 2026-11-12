"""Copy approved BI (assets/bi) into app/public. Trims only the transparent 24px export padding
(aspect ratio kept) and downsizes to a retina-safe height. Icons come from app-icon.png.
Run from repo root: python3 app/.verify/g2/SHELL/prepare-brand.py"""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[4]
src, pub = root / "assets" / "bi", root / "app" / "public"
(pub / "brand").mkdir(parents=True, exist_ok=True)
for name, h in [("lockup-black", 160), ("lockup-white", 160), ("symbol-black", 160), ("symbol-white", 160), ("wordmark-black", 120), ("wordmark-white", 120)]:
    im = Image.open(src / f"{name}.png").convert("RGBA")
    im = im.crop(im.getchannel("A").getbbox())
    w = round(im.width * h / im.height)
    im.resize((w, h), Image.LANCZOS).save(pub / "brand" / f"{name}.png", optimize=True)
    print(name, (w, h), "ratio", round(w / h, 4))
icon = Image.open(src / "app-icon.png").convert("RGBA")
s = max(icon.size)
sq = Image.new("RGBA", (s, s), (0, 0, 0, 0)); sq.paste(icon, ((s - icon.width) // 2, (s - icon.height) // 2))
sq.resize((192, 192), Image.LANCZOS).save(pub / "icon.png", optimize=True)
sq.save(pub / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
# iOS masks the icon itself: fill the transparent rounded corners with the tile color (full-bleed square).
tile = icon.getpixel((icon.width // 2, 5))[:3]
apple = Image.new("RGBA", (s, s), tile + (255,)); apple.alpha_composite(sq)
apple.convert("RGB").resize((180, 180), Image.LANCZOS).save(pub / "apple-touch-icon.png", optimize=True)
print("icons: icon.png 192, favicon.ico 16/32/48, apple-touch-icon.png 180 tile", tile)
