from PIL import Image
C='/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-2/visual/current/'
D='/Users/jyl/work/study/pr-sim/docs/screens/draft/04-review.png'
O='/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-2/visual/crops/'
m=Image.open(C+'04-review-mobile.png').convert('RGB'); d=Image.open(D).convert('RGB'); k=Image.open(C+'04-review-desktop.png').convert('RGB')
m.crop((0,0,780,180)).save(O+'r-m-top.png')
k.crop((530,40,910,180)).resize((760,280)).save(O+'r-d-top.png')
m.crop((560,1280,780,1330)).resize((660,150)).save(O+'r-m-tail.png')
d.crop((600,1520,798,1580)).resize((594,180)).save(O+'r-draft-tail.png')
m.crop((460,480,760,600)).save(O+'r-m-statuspill.png')
# side by side top half
sbs=Image.new('RGB',(780+798,1100),'white'); sbs.paste(d.crop((0,0,798,1100)),(0,0)); sbs.paste(m.crop((0,0,780,1100)),(798,0)); sbs.resize((789,550)).save(O+'r-sbs-top.png')
sbs2=Image.new('RGB',(780+798,900),'white'); sbs2.paste(d.crop((0,1071,798,1971)),(0,0)); sbs2.paste(m.crop((0,788,780,1688)),(798,0)); sbs2.resize((789,450)).save(O+'r-sbs-bottom.png')
px=m.load()
def bbox(im,box,f):
    p=im.load();xs=[];ys=[]
    for y in range(box[1],box[3]):
        for x in range(box[0],box[2]):
            if f(p[x,y]): xs.append(x);ys.append(y)
    return (min(xs),min(ys),max(xs),max(ys)) if xs else None
g=lambda p: 225<p[0]<240 and abs(p[0]-p[2])<4
print('end pill cur', bbox(m,(600,60,780,180),g))
print('end pill draft', bbox(d,(620,110,798,210),lambda p: 225<p[0]<240 and abs(p[0]-p[2])<6))
print('tail cur maxx', bbox(m,(700,1280,780,1320),lambda p: sum(p)<80))
print('tail draft maxx', bbox(d,(700,1500,798,1580),lambda p: sum(p)<80))
print('logo cur ink rows', bbox(m,(20,0,260,60),lambda p: sum(p)<150))
print('desk top remnant', bbox(k,(545,80,700,100),lambda p: sum(p)<500))
print('statuspill cur', bbox(m,(460,480,760,600),lambda p: sum(p)<80))
print('mic circle cur', bbox(m,(100,1420,300,1540),lambda p: 220<p[0]<236 and abs(p[0]-p[2])<4))
print('mic circle draft', bbox(d,(100,1680,320,1820),lambda p: 215<p[0]<232 and abs(p[0]-p[2])<6))
