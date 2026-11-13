import sys
from PIL import Image, ImageChops
pairs = [
 ("g3/p2/deployed/visual/out-390x844/01-landing.png", "g3/p2/tail/verify/visual/out390/01-landing-mobile.png", "01-landing-390"),
 ("g3/p2/deployed/visual/out-390x844/07-history.png", "g3/p2/tail/verify/visual/out390/07-history-mobile.png", "07-history-390"),
 ("g3/p2/deployed/visual/out-390x844/07-history-full.png", "g3/p2/tail/verify/visual/out390/07-history-mobile-full.png", "07-history-390-full"),
 ("g3/p2/deployed/visual/out-390x844/07-history-empty.png", "g2/SCREENS-A/07-history-empty.png", "07-history-empty-390-vsG2"),
 ("g3/p2/deployed/visual/out-1440x900/01-landing.png", "g2/SCREENS-A/01-landing-desktop-frame.png", "01-landing-1440-vsG2"),
]
out = "g3/p2/deployed/visual/diff"
import os; os.makedirs(out, exist_ok=True)
for a, b, name in pairs:
    A = Image.open(a).convert("RGB"); B = Image.open(b).convert("RGB")
    if A.size != B.size:
        print(name, "SIZE", A.size, B.size); 
        h = min(A.size[1], B.size[1]); w = min(A.size[0], B.size[0]); A = A.crop((0,0,w,h)); B = B.crop((0,0,w,h))
    d = ImageChops.difference(A, B).convert("L")
    px = sum(1 for v in d.getdata() if v > 24); tot = d.size[0]*d.size[1]
    bbox = d.point(lambda v: 255 if v > 24 else 0).getbbox()
    print(f"{name}: diff>24 {px}/{tot} = {100*px/tot:.3f}%  bbox={bbox}")
    d.point(lambda v: min(255, v*4)).save(f"{out}/{name}.png")
