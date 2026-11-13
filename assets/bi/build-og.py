"""Build the 1200x630 link-preview image (Open Graph / Twitter card).

Run: python3 assets/bi/build-og.py
Composes the landing stage photo, the white lockup and the tagline into
app/src/app/opengraph-image.png and twitter-image.png (Next.js file conventions).
The tagline font is Apple SD Gothic Neo, so run it on macOS.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
W, H = 1200, 630
PAD = 80
TAGLINE = 'AI 심사위원 앞에서 실전처럼 연습하는 발표 리허설'
FONT = '/System/Library/Fonts/AppleSDGothicNeo.ttc'

# Stage photo, scaled to the card width and cropped vertically (keeps the podium and spotlights).
stage = Image.open(ROOT / 'assets/landing/hero-stage-desktop-v2.png').convert('RGB')
stage = stage.resize((W, round(stage.height * W / stage.width)), Image.Resampling.LANCZOS)
top = (stage.height - H) // 2
card = stage.crop((0, top, W, top + H)).convert('RGBA')

# Darken the left side so the logo and tagline read clearly over the curtain.
shade = Image.new('L', (W, 1))
for x in range(W):
    t = min(1, x / (W * 0.62))
    shade.putpixel((x, 0), round(200 * (1 - t) ** 1.4))
overlay = Image.new('RGBA', (W, H), (8, 8, 8, 0))
overlay.putalpha(shade.resize((W, H)))
card = Image.alpha_composite(card, overlay)

lockup = Image.open(ROOT / 'assets/bi/lockup-white.png').convert('RGBA')
lw = 600
lockup = lockup.resize((lw, round(lockup.height * lw / lockup.width)), Image.Resampling.LANCZOS)
ly = 228
card.alpha_composite(lockup, (PAD, ly))

draw = ImageDraw.Draw(card)
tagline = ImageFont.truetype(FONT, 34, index=2)  # Medium
draw.text((PAD, ly + lockup.height + 40), TAGLINE, font=tagline, fill=(236, 236, 236, 255))
url = ImageFont.truetype(FONT, 24, index=4)  # SemiBold
draw.text((PAD, H - PAD - 24), 'dansang.io', font=url, fill=(160, 160, 160, 255))

out = card.convert('RGB')
for name in ('opengraph-image.png', 'twitter-image.png'):
    out.save(ROOT / 'app/src/app' / name, optimize=True)
print('wrote', W, 'x', H)
