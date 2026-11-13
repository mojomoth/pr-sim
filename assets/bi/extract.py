"""Export DANSANG SVG masters and sync runtime assets.

Run: python3 assets/bi/extract.py
Requires Pillow and the existing pocs sharp dependency (pnpm -C pocs install).
SVG paths are the source of truth; no installed font is needed for export.
"""
from pathlib import Path
import json
import shutil
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/bi'
subprocess.run(['node', '-e', """
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[1];
const sharp = createRequire(path.join(root, 'pocs/package.json'))('sharp');
const dir = path.join(root, 'assets/bi');
(async () => {
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.svg'))) {
    const board = name === 'identity-board.svg';
    await sharp(path.join(dir, name), { density: board ? 72 : 216 })
      .png().toFile(path.join(dir, name.replace('.svg', '.png')));
  }
})().catch(e => { console.error(e); process.exit(1); });
""", str(ROOT)], check=True)


def copy(source, destination):
    target = ROOT / destination
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(OUT / source, target)


for tone in ('black', 'white'):
    for ext in ('svg', 'png'):
        copy(f'lockup-{tone}.{ext}', f'app/public/brand/lockup-{tone}.{ext}')
for name in ('symbol-black', 'lockup-black'):
    copy(f'{name}.png', f'pocs/public/ui/brand/{name}.png')
copy('symbol-black.svg', 'pocs/public/brand/symbol.svg')
copy('lockup-black.svg', 'pocs/public/brand/lockup.svg')
copy('app-icon.png', 'pocs/public/brand/app-icon.png')
for tone, filename in (('black', 'brand-lockup.webp'), ('white', 'brand-lockup-white.webp')):
    Image.open(OUT / f'lockup-{tone}.png').save(ROOT / 'pocs/public/landing' / filename, lossless=True)
icon = Image.open(OUT / 'app-icon.png').convert('RGBA')
for size, name in ((192, 'icon.png'), (180, 'apple-touch-icon.png')):
    icon.resize((size, size), Image.Resampling.LANCZOS).save(ROOT / 'app/public' / name)
for target in ('app/public/favicon.ico', 'pocs/app/favicon.ico'):
    icon.save(ROOT / target, sizes=[(16, 16), (32, 32), (48, 48)])
assets = []
for source in sorted(OUT.glob('*.svg')):
    png = source.with_suffix('.png')
    with Image.open(png) as image:
        assets.append({'source': source.name, 'file': png.name,
                       'width': image.width, 'height': image.height, 'mode': image.mode})
(OUT / 'manifest.json').write_text(json.dumps({
    'brand': 'DANSANG', 'symbol': 'D', 'source_format': 'SVG paths',
    'lockup_viewbox': [1056, 144], 'export': 'python3 assets/bi/extract.py',
    'assets': assets,
}, ensure_ascii=False, indent=2) + '\n')
