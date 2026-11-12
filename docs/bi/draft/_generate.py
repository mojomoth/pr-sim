import math, os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

INK = "#1F2233"
BLUE = "#1A1AFF"
MID = "#0A84FF"
CYAN = "#00D2FF"
FONT = "'Pretendard','Inter','SF Pro Display','Helvetica Neue',Arial,sans-serif"


def rpoly(pts, r):
    """Rounded polygon path. r may be scalar or per-vertex list."""
    n = len(pts)
    rs = r if isinstance(r, (list, tuple)) else [r] * n
    d = []
    for i in range(n):
        p0, p1, p2 = pts[i - 1], pts[i], pts[(i + 1) % n]
        def toward(a, b, dist):
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy)
            k = min(dist, L / 2) / L
            return (a[0] + dx * k, a[1] + dy * k)
        a = toward(p1, p0, rs[i])
        b = toward(p1, p2, rs[i])
        d.append(("M" if i == 0 else "L") + f"{a[0]:.1f},{a[1]:.1f}")
        d.append(f"Q{p1[0]:.1f},{p1[1]:.1f} {b[0]:.1f},{b[1]:.1f}")
    return " ".join(d) + "Z"


def panel(x, w, top_l, top_r, bot_r, bot_l):
    return [(x, top_l), (x + w, top_r), (x + w, bot_r), (x, bot_l)]


# reference-like perspective stack (canvas 400x400)
STACK = [
    panel(62, 150, 78, 92, 308, 322),
    panel(122, 170, 58, 84, 316, 342),
    panel(182, 170, 40, 78, 322, 360),
]


def triangle(cx, cy, s):
    h = s * math.sqrt(3) / 2
    return [(cx - h / 3, cy - s / 2), (cx + 2 * h / 3, cy), (cx - h / 3, cy + s / 2)]


# ---------------------------------------------------------------- symbols
def sym_stage():
    """01 STAGE — 3 panels, play cutout on the front slide."""
    p = [rpoly(STACK[0], 22), rpoly(STACK[1], 22)]
    front = rpoly(STACK[2], 24) + " " + rpoly(triangle(272, 200, 92), 12)
    return f"""
  <path d="{p[0]}" fill="{BLUE}"/>
  <path d="{p[1]}" fill="{MID}" fill-opacity=".9"/>
  <path d="{front}" fill="{CYAN}" fill-opacity=".88" fill-rule="evenodd"/>"""


def sym_talk():
    """02 TALK — front slide grows a speech tail."""
    x, w = 182, 170
    front = [(x, 40), (x + w, 78), (x + w, 300), (x + 78, 312), (x + 20, 372), (x + 30, 318), (x, 322)]
    rr = [24, 24, 24, 10, 6, 6, 24]
    return f"""
  <path d="{rpoly(STACK[0], 22)}" fill="{BLUE}"/>
  <path d="{rpoly(STACK[1], 22)}" fill="{MID}" fill-opacity=".9"/>
  <path d="{rpoly(front, rr)}" fill="{CYAN}" fill-opacity=".88"/>"""


def sym_echo():
    """03 ECHO — a solid slide that projects outlined panels like a voice."""
    s = [panel(70, 110, 120, 128, 272, 280)]
    o1 = panel(150, 130, 92, 108, 292, 308)
    o2 = panel(230, 120, 62, 86, 314, 338)
    return f"""
  <path d="{rpoly(s[0], 18)}" fill="{BLUE}"/>
  <path d="{rpoly(o1, 20)}" fill="none" stroke="{MID}" stroke-width="26" stroke-linejoin="round" stroke-opacity=".9"/>
  <path d="{rpoly(o2, 22)}" fill="none" stroke="{CYAN}" stroke-width="26" stroke-linejoin="round" stroke-opacity=".9"/>"""


def sym_monogram():
    """04 P-STACK — a P built from two overlapping slide panels."""
    stem = [(96, 48), (176, 60), (176, 344), (96, 356)]
    bowl = [(136, 54), (322, 84), (322, 236), (136, 262)]
    hole = [(196, 120), (262, 130), (262, 192), (196, 200)]
    return f"""
  <path d="{rpoly(stem, 26)}" fill="{BLUE}"/>
  <path d="{rpoly(bowl, [26, 70, 70, 26]) + ' ' + rpoly(hole, 14)}" fill="{CYAN}" fill-opacity=".86" fill-rule="evenodd"/>"""


def sym_live():
    """05 LIVE — the stack with an on-air dot (simulation running)."""
    return f"""
  <path d="{rpoly(STACK[0], 22)}" fill="{BLUE}"/>
  <path d="{rpoly(STACK[1], 22)}" fill="{MID}" fill-opacity=".9"/>
  <path d="{rpoly(STACK[2], 24)}" fill="{CYAN}" fill-opacity=".88"/>
  <circle cx="352" cy="74" r="30" fill="#FF4D5E" stroke="var(--bg,#fff)" stroke-width="10"/>"""


DRAFTS = [
    ("01-stage", "STAGE", sym_stage, CYAN, "패널 3장 + 재생 컷아웃. 레퍼런스의 원근 스택을 그대로 계승하고, 맨 앞 슬라이드에 재생 삼각형을 뚫어 '발표를 실행해 보는' 시뮬레이터임을 표현."),
    ("02-talk", "TALK", sym_talk, MID, "맨 앞 슬라이드 하단이 말풍선 꼬리로 연장. 슬라이드(자료)와 발화(말하기)가 한 형태로 결합 — 발표 연습 서비스의 핵심."),
    ("03-echo", "ECHO", sym_echo, MID, "작은 솔리드 슬라이드에서 윤곽선 패널이 커지며 퍼짐. 목소리가 청중에게 전달되는 음파이자, 슬라이드가 넘어가는 진행감."),
    ("04-p-stack", "P-STACK", sym_monogram, BLUE, "겹친 패널 두 장으로 만든 'P' 모노그램. 앱 아이콘·파비콘 등 작은 크기에서 가장 식별력이 높은 안."),
    ("05-live", "LIVE", sym_live, "#FF4D5E", "레퍼런스 스택 + 코랄 'ON AIR' 점. 실전처럼 녹화·심사가 진행 중이라는 긴장감. 워드마크 가운뎃점과 같은 색으로 연결."),
]


def symbol_svg(fn, bg=None):
    rect = f'<rect width="400" height="400" rx="88" fill="{bg}"/>' if bg else ""
    style = f' style="--bg:{bg}"' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400"{style}>{rect}{fn()}\n</svg>\n'


def lockup_svg(fn, dot, ink=INK, bg=None):
    rect = f'<rect width="1000" height="400" fill="{bg}"/>' if bg else ""
    style = f' style="--bg:{bg}"' if bg else ""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 400" width="1000" height="400"{style}>{rect}
 <g transform="translate(40,40) scale(.8)">{fn()}
 </g>
 <text x="400" y="252" font-family="{FONT}" font-weight="800" font-size="150" letter-spacing="-5" fill="{ink}">PR<tspan fill="{dot}" dx="2">·</tspan><tspan dx="2">SIM</tspan></text>
</svg>
'''


for slug, name, fn, dot, _ in DRAFTS:
    d = os.path.join(OUT, slug)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "symbol.svg"), "w").write(symbol_svg(fn))
    open(os.path.join(d, "app-icon.svg"), "w").write(symbol_svg(fn, bg="#0E1020"))
    open(os.path.join(d, "lockup.svg"), "w").write(lockup_svg(fn, dot))
    open(os.path.join(d, "lockup-dark.svg"), "w").write(lockup_svg(fn, dot, ink="#FFFFFF", bg="#0E1020"))

# ---------------------------------------------------------------- overview board
cards = []
for slug, name, fn, dot, desc in DRAFTS:
    num = slug[:2]
    cards.append(f'''<section>
 <header><span>{num}</span><h2>{name}</h2></header>
 <div class="row"><div class="light"><img src="{slug}/lockup.svg"></div></div>
 <div class="row two">
  <div class="dark"><img src="{slug}/lockup-dark.svg"></div>
  <div class="icons"><img src="{slug}/app-icon.svg" style="width:96px"><img src="{slug}/app-icon.svg" style="width:48px"><img src="{slug}/symbol.svg" style="width:24px"></div>
 </div>
 <p>{desc}</p>
</section>''')

html = f'''<!doctype html><html lang="ko"><meta charset="utf-8"><title>PR·SIM BI Drafts</title>
<style>
body{{margin:0;background:#EEF0F5;font-family:{FONT};color:{INK};padding:48px}}
h1{{font-size:40px;letter-spacing:-1px;margin:0 0 4px}} .sub{{color:#5A6075;margin:0 0 32px}}
main{{display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:24px}}
section{{background:#fff;border-radius:20px;padding:24px}}
header{{display:flex;gap:12px;align-items:baseline}} header span{{color:{MID};font-weight:800}} h2{{margin:0 0 12px;font-size:22px}}
.row{{margin-bottom:12px}} .two{{display:grid;grid-template-columns:2fr 1fr;gap:12px}}
.light,.dark,.icons{{border-radius:14px;display:flex;align-items:center;justify-content:center}}
.light{{background:#F7F8FB}} .dark{{background:#0E1020}} .icons{{background:#F7F8FB;gap:14px}}
.light img{{width:80%}} .dark img{{width:100%}}
p{{line-height:1.6;color:#3C4257;margin:4px 0 0}}
</style>
<h1>PR·SIM — BI Drafts</h1><p class="sub">Reference: ref-sel/bi.png (layered perspective panels · blue→cyan · heavy dark wordmark)</p>
<main>{"".join(cards)}</main></html>'''
open(os.path.join(OUT, "index.html"), "w").write(html)
print("ok")
