"""Split the approved identity board without regenerating its geometry."""
from pathlib import Path
import json
import shutil
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/bi'
SOURCE = ROOT / 'docs/bi/monochrome/identity-board.png'
board = Image.open(SOURCE).convert('RGB')
assert board.size == (1536, 1024), 'Crop coordinates require the approved board.'
shutil.copyfile(SOURCE, OUT / 'identity-board.png')
records = []

def save(name, image, box=None, treatment='original crop'):
    image.save(OUT / name)
    records.append({'file': name, 'width': image.width, 'height': image.height,
                    'mode': image.mode, 'source_box': box, 'treatment': treatment})

# These regions isolate the actual approved board, not the separately generated symbol.
save('lockup-light.png', board.crop((170, 125, 1395, 550)), [170, 125, 1395, 550])
save('lockup-dark.png', board.crop((70, 720, 710, 975)), [70, 720, 710, 975])

def transparent_pair(stem, box):
    crop = board.crop(box)
    # Neutralize the generated paper/ink texture while retaining antialiased contours.
    gray = ImageOps.grayscale(crop)
    alpha = gray.point(lambda v: 0 if v >= 235 else min(255, round((235-v)*255/218)))
    bounds = alpha.getbbox()
    alpha = alpha.crop(bounds)
    for suffix, color in [('black', '#111111'), ('white', '#FFFFFF')]:
        image = Image.new('RGBA', alpha.size, color)
        image.putalpha(alpha)
        # Equal padding, separate from the recommended layout clear space.
        padded = Image.new('RGBA', (image.width+48, image.height+48))
        padded.paste(image, (24, 24))
        save(f'{stem}-{suffix}.png', padded, list(box),
             'background removed; uniform ink/white; same source geometry; 24px padding')

transparent_pair('lockup', (185, 140, 1380, 530))
transparent_pair('symbol', (185, 140, 570, 530))
transparent_pair('wordmark', (590, 225, 1380, 425))

# Remove only the light surface connected to the outside of the rounded app tile.
box = (900, 735, 1138, 974)
tile = board.crop(box).convert('RGBA')
mask = ImageOps.grayscale(tile).point(lambda v: 255 if v > 180 else 0)
for corner in [(0, 0), (mask.width-1, 0), (0, mask.height-1),
               (mask.width-1, mask.height-1)]:
    if mask.getpixel(corner) == 255:
        ImageDraw.floodfill(mask, corner, 128)
alpha = mask.point(lambda v: 0 if v == 128 else 255)
tile.putalpha(alpha)
tile = tile.crop(alpha.getbbox())
save('app-icon.png', tile, list(box), 'outside surface removed; interior pixels preserved')
(OUT / 'manifest.json').write_text(json.dumps({
    'status': 'approved', 'source': str(SOURCE.relative_to(ROOT)),
    'source_size': list(board.size), 'coordinate_system': 'Pillow left, top, right, bottom; right/bottom exclusive',
    'assets': records,
}, ensure_ascii=False, indent=2) + '\n')

