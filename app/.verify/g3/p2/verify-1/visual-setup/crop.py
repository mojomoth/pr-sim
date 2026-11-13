import sys
from PIL import Image
cur=Image.open('current/02-setup-mobile-full.png').convert('RGB')
d=Image.open('/Users/jyl/work/study/pr-sim/docs/screens/draft/02-setup.png').convert('RGB')
d=d.resize((780,round(1968*780/799)))
print('draft scaled', d.size, 'ratio', d.size[1]/780, 'cur ratio', cur.size[1]/780)
# side by side full
W=780*2+20; H=max(cur.size[1],d.size[1])
sb=Image.new('RGB',(W,H),'red'); sb.paste(d,(0,0)); sb.paste(cur,(800,0)); sb.save('crops/setup-side-by-side.png')
def regions(img,name):
    # find rows that are not pure white per row, print bands of non-bg
    px=img.load(); w,h=img.size
    rows=[]
    for y in range(h):
        nonw=0
        for x in range(0,w,3):
            r,g,b=px[x,y]
            if r<250 or g<250 or b<250: nonw+=1
        rows.append(nonw)
    bands=[];inb=False
    for y,n in enumerate(rows):
        if n>0 and not inb: s=y;inb=True
        if n==0 and inb: bands.append((s,y));inb=False
    if inb: bands.append((s,h))
    print(name, [(a,b,b-a) for a,b in bands if b-a>3])
regions(d,'draft'); regions(cur,'cur')
