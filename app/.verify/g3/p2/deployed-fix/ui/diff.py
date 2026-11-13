# python3 diff.py — local 390 captures vs deployed baseline (out-390x844); per-band diff to localize changes.
from PIL import Image, ImageChops
B = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/deployed/visual/out-390x844/"
L = "/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/deployed-fix/ui/"
pairs = [("01-landing.png", "390-hard.png", "landing"), ("01-landing.png", "390-nav_setup_root_backbutton.png", "landing-back"),
         ("02-setup-fresh.png", "390-nav_root_setup_tap.png", "setup"), ("07-history-empty.png", "390-hard_history.png", "history-empty")]
for b, l, n in pairs:
    A = Image.open(B + b).convert("RGB"); C = Image.open(L + l).convert("RGB")
    assert A.size == C.size, (A.size, C.size)
    d = ImageChops.difference(A, C).convert("L"); m = d.point(lambda v: 255 if v > 24 else 0)
    tot = m.size[0] * m.size[1]; px = sum(1 for v in m.getdata() if v)
    print(f"{n}: {px}/{tot} = {100*px/tot:.3f}% bbox={m.getbbox()}")
    W, H = m.size; band = 100  # 50 CSS px bands
    rows = []
    for y in range(0, H, band):
        c = sum(1 for v in m.crop((0, y, W, min(H, y + band))).getdata() if v)
        if c: rows.append(f"y{y//2}-{min(H,y+band)//2}:{c}")
    print("   bands(css px):", " ".join(rows) or "none")
    d.point(lambda v: min(255, v * 4)).save(f"{L}diff/{n}.png")
    w = A.size[0]; sbs = Image.new("RGB", (w * 3, A.size[1]), "white"); sbs.paste(A, (0, 0)); sbs.paste(C, (w, 0)); sbs.paste(d.point(lambda v: min(255, v * 4)).convert("RGB"), (w * 2, 0)); sbs.resize((w * 3 // 2, A.size[1] // 2)).save(f"{L}diff/{n}-sbs.png")
