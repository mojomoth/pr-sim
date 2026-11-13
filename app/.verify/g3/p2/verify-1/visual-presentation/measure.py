"""Measure the transparent screen hole of a phone mockup PNG (flood fill from center on alpha<128)."""
import sys, math
from collections import deque
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGBA'); W,H=im.size
A=im.getchannel('A').tobytes()
a=lambda x,y:A[y*W+x]
print('size',W,H,'center alpha',a(W//2,H//2),'corner alpha',a(0,0))
seen=bytearray(W*H); q=deque([(W//2,H//2)]); seen[(H//2)*W+W//2]=1
L,T,R,B=W,H,0,0
while q:
    x,y=q.popleft()
    L=min(L,x);R=max(R,x);T=min(T,y);B=max(B,y)
    for nx,ny in((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
        if 0<=nx<W and 0<=ny<H and not seen[ny*W+nx] and a(nx,ny)<128:
            seen[ny*W+nx]=1; q.append((nx,ny))
print('screen bbox left,top,right,bottom (inclusive):',L,T,R,B,' w',R-L+1,' h',B-T+1)
print('as %% of image: left %.4f top %.4f width %.4f height %.4f'%(L/W*100,T/H*100,(R-L+1)/W*100,(B-T+1)/H*100))
def leftmost(y):
    for x in range(L,R+1):
        if seen[y*W+x]: return x
    return None
def rightmost(y):
    for x in range(R,L-1,-1):
        if seen[y*W+x]: return x
rows=[leftmost(y)-L for y in range(T,T+220)]
rowsB=[leftmost(y)-L for y in range(B,B-220,-1)]
rowsR=[R-rightmost(y) for y in range(T,T+220)]
print('top-left offsets',[rows[k] for k in (0,1,2,5,10,20,40,60,80,100,120)])
print('bottom-left offsets',[rowsB[k] for k in (0,1,2,5,10,20,40,60,80,100,120)])
print('top-right offsets',[rowsR[k] for k in (0,1,2,5,10,20,40,60,80,100,120)])
def fit(off):
    best=None
    for Rr in range(10,220):
        e=sum((off[k]-(Rr-math.sqrt(max(0,Rr*Rr-(Rr-k-0.5)**2))))**2 for k in range(Rr))/Rr
        if best is None or e<best[0]: best=(round(e,3),Rr)
    return best
print('circle-fit radius (err,R): TL',fit(rows),'BL',fit(rowsB),'TR',fit(rowsR))
# opaque blobs inside the screen bbox (e.g. dynamic island) — scan top 200 rows center band
blob=[(x,y) for y in range(T,T+200) for x in range(L+150,R-150) if not seen[y*W+x]]
if blob:
    xs=[p[0] for p in blob]; ys=[p[1] for p in blob]
    print('opaque inside top band: x',min(xs),max(xs),'y',min(ys),max(ys))
else: print('no opaque island inside top band (island must be drawn in-app or absent)')
# bottom row widths
for y in (B,B-1,B-2,B-3):
    xs=[x for x in range(L,R+1) if seen[y*W+x]]
    print('row',y,'transparent count',len(xs),'min',min(xs) if xs else None,'max',max(xs) if xs else None)
print('BL fit (skip artifact rows)',fit(rowsB[1:]),'last full-width row from bottom', next(i for i,v in enumerate(rowsB) if v==0))
# island: opaque component containing center-top point
cx=W//2
y0=next(y for y in range(T,T+200) if not seen[y*W+cx] and a(cx,y)>=128 and y>T+5)
isl=set(); q=deque([(cx,y0)]); isl.add((cx,y0))
while q:
    x,y=q.popleft()
    for nx,ny in((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
        if L<=nx<=R and T<=ny<=T+300 and (nx,ny) not in isl and not seen[ny*W+nx]:
            isl.add((nx,ny)); q.append((nx,ny))
xs=[p[0] for p in isl]; ys=[p[1] for p in isl]
print('island bbox',min(xs),min(ys),max(xs),max(ys),'w',max(xs)-min(xs)+1,'h',max(ys)-min(ys)+1)
