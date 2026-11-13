import sys
from PIL import Image
V='/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/visual/'
C=V+'crops/'
D='/Users/jyl/work/study/pr-sim/docs/screens/draft/03-presentation.png'
mob=Image.open(V+'current/03-presentation-mobile.png').convert('RGB')
two=Image.open(V+'current/03-presentation-mobile-2line-scrolled-end.png').convert('RGB')
dsk=Image.open(V+'current/03-presentation-desktop.png').convert('RGB')
dr=Image.open(D).convert('RGB')
# side by side bottom halves
def sbs(a,b,box_a,box_b,name):
    A=a.crop(box_a);B=b.crop(box_b)
    h=max(A.height,B.height);im=Image.new('RGB',(A.width+B.width+10,h),'red');im.paste(A,(0,0));im.paste(B,(A.width+10,0));im.save(C+name)
sbs(dr,mob,(0,1200,798,1971),(0,1000,780,1688),'p-bottom-draft-vs-mobile.png')
sbs(dr,mob,(0,0,798,1200),(0,0,780,1010),'p-top-draft-vs-mobile.png')
dsk.crop((540,40,905,870)).resize((730,1660)).save(C+'p-desktop-screen-2x.png')
two.crop((0,1080,780,1440)).save(C+'p-2line-bubble-judges.png')
# row scans: find non-white rows along column profile for mobile, from y=1380 to 1470 (labels -> pills) to detect hairline
def rows(im,x0,x1,y0,y1):
    out=[]
    for y in range(y0,y1):
        px=[im.getpixel((x,y)) for x in range(x0,x1)]
        dark=sum(1 for p in px if sum(p)<720)
        out.append((y,dark))
    return out
print('mobile labels->pills rows (dark px count over x 20..760):')
print([r for r in rows(mob,20,760,1380,1470) if r[1]>0])
# judge photo bbox: column x=140 (first tile) find non-white vertical extent 1200-1400
def vext(im,x,y0,y1):
    ys=[y for y in range(y0,y1) if sum(im.getpixel((x,y)))<740]
    return (ys[0],ys[-1]) if ys else None
def hext(im,y,x0,x1):
    xs=[x for x in range(x0,x1) if sum(im.getpixel((x,y)))<740]
    return (xs[0],xs[-1]) if xs else None
print('mobile tile1 v',vext(mob,140,1215,1390),'h',hext(mob,1300,0,260))
print('draft tile1 v',vext(dr,140,1450,1700),'h',hext(dr,1600,0,270))
print('desktop tile1 v',vext(dsk,605,630,715),'h',hext(dsk,680,550,665))
print('desktop screen h',vext(dsk,560,20,890))
