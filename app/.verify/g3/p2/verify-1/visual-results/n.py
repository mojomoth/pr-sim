from PIL import Image
C='/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/visual/current/'
D='/Users/jyl/work/study/pr-sim/docs/screens/draft/05-results.png'
f=Image.open(C+'05-results-mobile-full.png').convert('RGB')
d=Image.open(D).convert('RGB')
def darkest(im,box):
    c=im.crop(box); px=list(c.getdata()); return min(px,key=sum)
# full coords: scale 432->780 = 1.806
s=780/432
def b(x0,y0,x1,y1): return tuple(int(v*s) for v in (x0,y0,x1,y1))
print('subtitle cur', darkest(f,b(60,260,380,305)), 'draft', darkest(d,(200,455,600,500)))
print('총평 body', darkest(f,b(55,785,370,945)))
print('잘한점 body', darkest(f,b(85,1060,370,1230)))
print('next body', darkest(f,b(85,1380,370,1420)), 'next head', darkest(f,b(85,1352,330,1372)))
print('draft next body', darkest(d,(60,1550,600,1600)), 'draft strength body', darkest(d,(120,1340,680,1385)))
print('subscore label cur', darkest(f,b(40,610,110,630)), 'draft', darkest(d,(100,1035,200,1075)))
print('pill text cur', darkest(f,b(80,1760,140,1782)), 'draft', darkest(d,(180,1680,290,1715)))
print('model line', darkest(f,b(80,1810,370,1830)))
# CTA radius: find left edge per row in full image near CTA
y0=None
for y in range(3300,3500):
    if sum(f.getpixel((390,y)))<100: y0=y;break
y1=max(y for y in range(3300,3520) if sum(f.getpixel((390,y)))<100)
print('cta rows',y0,y1,'h',y1-y0)
for dy in [0,2,5,10,20,30,(y1-y0)//2]:
    y=y0+dy; xs=[x for x in range(0,390) if sum(f.getpixel((x,y)))<200]; print(' dy',dy,'left',xs[0] if xs else None)
# draft CTA
y0=min(y for y in range(1750,1900) if sum(d.getpixel((400,y)))<100); y1=max(y for y in range(1750,1900) if sum(d.getpixel((400,y)))<100)
print('draft cta',y0,y1,'h',y1-y0)
for dy in [0,2,5,10,20,30,(y1-y0)//2]:
    y=y0+dy; xs=[x for x in range(0,400) if sum(d.getpixel((x,y)))<200]; print(' dy',dy,'left',xs[0] if xs else None)
