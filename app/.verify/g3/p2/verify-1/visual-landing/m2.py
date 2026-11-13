from PIL import Image
D='/Users/jyl/work/study/pr-sim/docs/screens/draft/01-landing.png'
C='/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/visual/current/01-landing-mobile.png'
def dark(path, box, thr=90):
    im=Image.open(path).convert('L').crop(box)
    b=im.point(lambda v:255 if v<thr else 0).getbbox()
    return b and (b[0]+box[0],b[1]+box[1],b[2]+box[0],b[3]+box[1])
for n,box in {'cta-label':(60,1470,400,1555),'cta-arrow':(600,1460,720,1565),'pill-text':(530,55,720,115)}.items():
    print(n,'draft',dark(D,box),'cur',dark(C,box))
# hero image diff region
from PIL import ImageChops
a=Image.open(D).convert('L').crop((0,650,780,1440)); b=Image.open(C).convert('L').crop((0,650,780,1440))
h=ImageChops.difference(a,b).histogram(); print('hero mean diff', sum(i*c for i,c in enumerate(h))/sum(h))
# grayscale check of current
im=Image.open(C).convert('RGB'); import itertools
mx=0
for x in range(0,780,5):
  for y in range(0,1688,5):
    r,g,bb=im.getpixel((x,y)); mx=max(mx,max(r,g,bb)-min(r,g,bb))
print('max channel spread',mx)
for nm,p,box in [('draft-top',D,(0,0,780,680)),('cur-top',C,(0,0,780,680)),('draft-bot',D,(0,1380,780,1688)),('cur-bot',C,(0,1380,780,1688))]:
  Image.open(p).crop(box).save(f'/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/visual/crops/landing-{nm}.png')
