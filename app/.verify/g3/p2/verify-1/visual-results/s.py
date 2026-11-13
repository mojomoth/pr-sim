from PIL import Image
import statistics
C='/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/visual/current/'
D='/Users/jyl/work/study/pr-sim/docs/screens/draft/05-results.png'
m=Image.open(C+'05-results-mobile.png').convert('L')
d=Image.open(D).convert('L')
def runs(im,y0,y1,x0,x1,th=110):
    rs=[]
    for y in range(y0,y1,3):
        r=0
        for x in range(x0,x1):
            if im.getpixel((x,y))<th: r+=1
            elif r: rs.append(r); r=0
    return statistics.median(rs), len(rs)
def ink(im,box,th=110):
    c=im.crop(box); px=c.load(); w,h=c.size
    return sum(1 for x in range(w) for y in range(h) if px[x,y]<th)/(w*h)
print('title stroke cur', runs(m,270,432,100,700), 'draft', runs(d,256,423,100,700))
print('title ink cur', ink(m,(170,269,610,432)), 'draft', ink(d,(170,256,630,423)))
print('cta label cur', runs(m,1475,1515,250,470,th=150), 'draft')
