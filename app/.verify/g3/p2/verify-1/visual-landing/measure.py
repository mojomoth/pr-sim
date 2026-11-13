import sys
from PIL import Image, ImageChops
D='/Users/jyl/work/study/pr-sim/docs/screens/draft/01-landing.png'
C='/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/visual/current/01-landing-mobile.png'
P='/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/visual/current/01-landing-mobile.png'
def bbox(path, box, thr=200):
    im=Image.open(path).convert('L').crop(box)
    m=im.point(lambda v:255 if v>=thr else 0)
    b=m.getbbox()
    if not b: return None
    return (b[0]+box[0],b[1]+box[1],b[2]+box[0],b[3]+box[1])
regions={'logo':(0,20,330,140),'pill':(480,20,780,150),'eyebrow':(250,200,530,260),'headline':(100,270,700,530),'subtitle':(150,550,640,650),'cta':(20,1430,760,1600),'caption':(150,1600,650,1650)}
for name,box in regions.items():
    print(name,'draft',bbox(D,box),'cur',bbox(C,box),'prev',bbox(P,box) if __import__('os').path.exists(P) else '-')
# global diff
a=Image.open(D).convert('L'); b=Image.open(C).convert('L')
d=ImageChops.difference(a,b)
import statistics
h=d.histogram(); tot=sum(h); print('mean diff', sum(i*c for i,c in enumerate(h))/tot)
if __import__('os').path.exists(P):
  pc=Image.open(P).convert('L'); dd=ImageChops.difference(pc,b); print('prev vs cur bbox of diff>30', dd.point(lambda v:255 if v>30 else 0).getbbox())
