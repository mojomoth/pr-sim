"""Build custom DANSANG lettering from the D symbol's 144-unit geometry."""
from pathlib import Path
import xml.etree.ElementTree as ET

OUT = Path(__file__).resolve().parent
D = ET.parse(OUT / 'symbol-black.svg').getroot()[0].get('d')
# Shared broad strokes, rounded shoulders, and rising inner counters.
LETTERS = {
    'D': D,
    'A': 'M0 144V68C0 25 27 0 72 0S144 25 144 68V144H104V109H40V144Z M40 77H104V68C104 49 93 39 72 39S40 49 40 68Z',
    'N': 'M0 144V28Q0 0 28 0H39L104 77V0H144V116Q144 144 116 144H105L40 67V144Z',
    'S': 'M140 0V39H62Q40 39 40 48Q40 56 60 56H88C125 56 144 71 144 99C144 129 120 144 82 144H0V105H82Q104 105 104 96Q104 88 84 88H56C19 88 0 73 0 45C0 15 24 0 62 0Z',
    'G': 'M144 41H75C52 41 40 52 40 73V108C51 94 59 94 76 94H104V83H76V54H144V122Q144 144 122 144H70C25 144 0 116 0 72C0 28 27 0 72 0H144Z',
}
WIDTH = 1056

def svg(w, h, body, label='DANSANG'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{label}">{body}</svg>\n'

def wordmark(color):
    return ''.join(f'<path transform="translate({i * 152} 0)" fill="{color}" fill-rule="evenodd" d="{LETTERS[c]}"/>' for i, c in enumerate('DANSANG'))

for tone, color in [('black', '#111111'), ('white', '#ffffff')]:
    for name in ['wordmark', 'lockup']:
        (OUT / f'{name}-{tone}.svg').write_text(svg(WIDTH, 144, wordmark(color)))
for tone, bg, fg in [('light', '#ffffff', '#111111'), ('dark', '#111111', '#ffffff')]:
    (OUT / f'lockup-{tone}.svg').write_text(svg(WIDTH + 128, 272, f'<rect width="1184" height="272" fill="{bg}"/><g transform="translate(64 64)">{wordmark(fg)}</g>'))
board = '<rect width="1536" height="1024" fill="#fff"/>'
board += f'<g transform="translate(134 220) scale(1.2)">{wordmark("#111111")}</g>'
board += '<rect y="560" width="1536" height="464" fill="#111111"/>'
board += f'<g transform="translate(134 700) scale(1.2)">{wordmark("#ffffff")}</g>'
(OUT / 'identity-board.svg').write_text(svg(1536, 1024, board, 'DANSANG brand identity'))
