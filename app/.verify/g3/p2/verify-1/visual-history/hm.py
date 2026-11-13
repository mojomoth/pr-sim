from PIL import Image
def bbox(img, box, thr):
    c=img.crop(box).convert('L'); w,h=c.size; p=c.load()
    xs=[];ys=[]
    for y in range(h):
        for x in range(w):
            if p[x,y]<thr: xs.append(x); ys.append(y)
    if not xs: return None
    return (box[0]+min(xs),box[1]+min(ys),box[0]+max(xs),box[1]+max(ys))
def darkest(img,box):
    c=img.crop(box).convert('RGB'); return min(c.getdata(), key=sum)
def runs_row(img,y,lo,hi,x0=0,x1=None):
    c=img.convert('L'); w=c.size[0]; x1=x1 or w; p=c.load(); segs=[];s=None
    for x in range(x0,x1):
        inn=lo<=p[x,y]<=hi
        if inn and s is None: s=x
        if not inn and s is not None:
            if x-s>3: segs.append((s,x-1))
            s=None
    if s is not None: segs.append((s,x1-1))
    return segs
def runs_col(img,x,lo,hi,y0=0,y1=None):
    c=img.convert('L'); h=c.size[1]; y1=y1 or h; p=c.load(); segs=[];s=None
    for y in range(y0,y1):
        inn=lo<=p[x,y]<=hi
        if inn and s is None: s=y
        if not inn and s is not None:
            if y-s>3: segs.append((s,y-1))
            s=None
    if s is not None: segs.append((s,y1-1))
    return segs
D=Image.open('/Users/jyl/work/study/pr-sim/docs/screens/draft/07-history.png').convert('RGB')
C=Image.open('/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/visual/current/07-history-mobile-full.png').convert('RGB')
R=Image.open('/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/visual/current/07-history-mobile-full.png').convert('RGB')
def rep(name,img,box,thr=90):
    b=bbox(img,box,thr); W=img.size[0]
    if b: print(name,b,'w%%=%.1f h%%=%.1f'%((b[2]-b[0])/W*100,(b[3]-b[1])/W*100))
    else: print(name,None)
