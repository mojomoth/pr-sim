from PIL import Image, ImageChops
P='/Users/jyl/work/study/pr-sim/app/.verify/g3/'
cur=Image.open(P+'p2/verify-1/visual/current/06-feedback-mobile-full.png').convert('L')
old=Image.open(P+'recheck1/visual/current/06-feedback-mobile-full.png').convert('L')
vp=Image.open(P+'p2/verify-1/visual/current/06-feedback-mobile.png').convert('L')
dr=Image.open('/Users/jyl/work/study/pr-sim/docs/screens/draft/06-feedback.png').convert('L')
dr=dr.resize((780,round(dr.size[1]*780/798)))
# row-band diff old vs cur (same height?)
print('sizes',cur.size,old.size)
d=ImageChops.difference(cur,old)
rows=[y for y in range(cur.size[1]) if max(d.crop((0,y,780,y+1)).getdata())>40]
# group
g=[];s=None;p=None
for y in rows:
    if s is None: s=y
    elif y!=p+1: g.append((s,p)); s=y
    p=y
if s is not None: g.append((s,p))
print('changed row groups', g[:40])
def mn(img,box): return min(img.crop(box).getdata())
print('질문01 min lum cur',mn(cur,(1400-800,590,1495-800,630)),'old',mn(old,(600,600,700,640)),'draft',mn(dr,(630,620,730,655)))
print('내답변 label min cur',mn(cur,(55,970,140,1005)),'draft',mn(dr,(48,870,140,900)))
# ink density of body text (fraction of pixels <100) in a block
def dens(img,box):
    px=list(img.crop(box).getdata()); return round(sum(1 for v in px if v<100)/len(px),4)
print('answer body dens cur',dens(cur,(55,1030,720,1330)),'old',dens(old,(55,1030,720,1330)),'draft',dens(dr,(48,935,540,1035)))
print('feedback body dens cur',dens(cur,(55,1510,720,1730)),'old',dens(old,(55,1510,720,1730)),'draft',dens(dr,(48,1195,690,1290)))
# CTA radius: in cur full CTA rows 3502-3614; find first dark x per row at top
for y in [3502,3504,3508,3514,3524,3540,3558]:
    xs=[x for x in range(0,780) if cur.getpixel((x,y))<60]
    print('cta row',y, xs[0] if xs else None)
print('cta height css',(3614-3502)/2)
# draft CTA
ys=[y for y in range(1600,1900) if dr.getpixel((390,y))<60]
print('draft cta y',ys[0],ys[-1],(ys[-1]-ys[0])/2)
y0=ys[0]
for dy in [0,2,6,12,24,40]:
    xs=[x for x in range(0,780) if dr.getpixel((x,y0+dy))<60]
    print(' draft cta row +',dy, xs[0] if xs else None)
# viewport: luminance rows between 1385 and 1445 at x=100
print('vp rows 1380-1445 x=100',[vp.getpixel((100,y)) for y in range(1380,1446,4)])
print('vp rows near bar top x=700',[vp.getpixel((700,y)) for y in range(1386,1440,4)])
