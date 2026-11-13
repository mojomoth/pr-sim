import sys, json
from PIL import Image
C='/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-2/visual/current/'
D='/Users/jyl/work/study/pr-sim/docs/screens/draft/04-review.png'
def L(p): return Image.open(p).convert('RGB')
def dark_bbox(im, box, thr=60):
    x0,y0,x1,y1=box; px=im.load(); xs=[];ys=[]
    for y in range(y0,y1):
        for x in range(x0,x1):
            r,g,b=px[x,y]
            if r<thr and g<thr and b<thr: xs.append(x); ys.append(y)
    return (min(xs),min(ys),max(xs),max(ys)) if xs else None
def row_profile(im,x,y0,y1):
    px=im.load(); return [(y,px[x,y]) for y in range(y0,y1)]
out={}
m=L(C+'04-review-mobile.png'); d=L(D)
out['timer_cur']=dark_bbox(m,(100,230,700,360))
out['timer_draft']=dark_bbox(d,(100,290,700,400))
# progress bar rows at center column
def runs(im,x,y0,y1,f):
    px=im.load(); res=[];st=None
    for y in range(y0,y1):
        ok=f(px[x,y])
        if ok and st is None: st=y
        if not ok and st is not None: res.append((st,y-1,px[x,st]));st=None
    if st is not None: res.append((st,y1-1,px[x,st]))
    return res
nonwhite=lambda p: sum(p)<720
out['bar_cur_rows_x100']=runs(m,100,370,430,nonwhite)
out['bar_draft_rows_x100']=runs(d,100,410,460,nonwhite)
def hruns(im,y,f):
    px=im.load(); w=im.size[0]; xs=[x for x in range(w) if f(px[x,y])]
    return (min(xs),max(xs)) if xs else None
out['bar_cur_x']=hruns(m,399,nonwhite); out['bar_draft_x']=hruns(d,432,nonwhite)
# card extents (question card)
out['qcard_cur_x_y800']=hruns(m,690,lambda p: p[0]<250 and abs(p[0]-p[2])<5)
out['qcard_draft_x_y1150']=hruns(d,1240,lambda p: p[0]<250 and abs(p[0]-p[2])<5)
# CTA
out['cta_cur_rows_x400']=runs(m,400,1540,1688,lambda p: sum(p)<120)
out['cta_cur_x_mid']=hruns(m,1650,lambda p: sum(p)<120)
out['cta_draft_rows_x400']=runs(d,400,1840,1971,lambda p: sum(p)<120)
out['cta_draft_x_mid']=hruns(d,1900,lambda p: sum(p)<120)
# CTA corner: at top edge row+2, leftmost dark x
for name,im,rows in (('cur',m,out['cta_cur_rows_x400']),('draft',d,out['cta_draft_rows_x400'])):
    if rows:
        t,b,_=rows[0]; h=b-t+1
        out['cta_'+name+'_h']=h
        out['cta_'+name+'_left_at_top+2']=hruns(im,t+2,lambda p: sum(p)<120)
        out['cta_'+name+'_left_at_mid']=hruns(im,(t+b)//2,lambda p: sum(p)<120)
# rows between hint and mic bar at x=390 (cur mobile) 
prof=row_profile(m,390,1370,1430)
out['rows_hint_to_mic_cur']=[(y,p) for y,p in prof if sum(p)<762]
# bubble right extents
out['bubble_cur_x_y1200']=hruns(m,1200,lambda p: sum(p)<80)
out['bubble_cur_x_tail_y1300']=hruns(m,1305,lambda p: sum(p)<80)
out['bubble_draft_x_y1450']=hruns(d,1450,lambda p: sum(p)<80)
out['bubble_draft_tail_y1555']=hruns(d,1555,lambda p: sum(p)<80)
# colorfulness of avatar region
def sat(im,box):
    c=im.crop(box); px=list(c.getdata()); s=sum(max(p)-min(p) for p in px)/len(px); return round(s,1)
out['avatar_cur_sat']=sat(m,(52,486,156,590))
out['photo_draft_sat']=sat(d,(60,520,740,1080))
# hero region heights
out['hero_cur_rows_x40']=runs(m,40,440,640,lambda p: sum(p)<750)
out['hero_draft_rows_x40']=runs(d,40,480,1110,lambda p: sum(p)<750)
print(json.dumps(out,indent=1,default=str))
