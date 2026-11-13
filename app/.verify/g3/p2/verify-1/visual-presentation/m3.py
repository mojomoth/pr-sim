from PIL import Image
V='/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/visual/current/'
d=Image.open(V+'03-presentation-desktop.png').convert('RGB')
def vext(im,x,y0,y1,t=740):
    ys=[y for y in range(y0,y1) if sum(im.getpixel((x,y)))<t]; return (ys[0],ys[-1]) if ys else None
for x in (580,606,630):
    print(x,vext(d,x,636,712))
# screen inner area: white screen bounds at x=720
print('screen top/bottom white at x=720', [y for y in range(0,900) if d.getpixel((720,y))==(255,255,255)][:1], [y for y in range(0,900) if d.getpixel((720,y))==(255,255,255)][-1:])
# timer glyph height mobile vs draft
m=Image.open(V+'03-presentation-mobile.png').convert('RGB')
dr=Image.open('/Users/jyl/work/study/pr-sim/docs/screens/draft/03-presentation.png').convert('RGB')
def rowsdark(im,y0,y1,x0,x1,t=200):
    ys=[y for y in range(y0,y1) if any(sum(im.getpixel((x,y)))<t for x in range(x0,x1,2))]; return (ys[0],ys[-1]) if ys else None
print('timer mobile',rowsdark(m,270,420,200,580),'draft',rowsdark(dr,300,460,200,600))
def colsdark(im,y,x0,x1,t=200):
    xs=[x for x in range(x0,x1) if sum(im.getpixel((x,y)))<t]; return (xs[0],xs[-1]) if xs else None
print('timer width mobile',colsdark(m,340,100,700),'draft',colsdark(dr,385,100,700))
# end button
print('end btn mobile', rowsdark(m,1540,1688,300,320,100),'draft',rowsdark(dr,1850,1971,150,160,100))
