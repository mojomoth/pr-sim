from PIL import Image
P='/Users/jyl/work/study/pr-sim/app/.verify/g3/'
for n in ['p2/verify-1','recheck1']:
    im=Image.open(P+n+'/visual/current/06-feedback-mobile-full.png').convert('L')
    for y in range(3440,3502):
        row=[im.getpixel((x,y)) for x in range(0,780,10)]
        if sum(1 for v in row if v<250)>60: print(n,'full-width line y',y,min(row),max(row))
    vp=Image.open(P+n+'/visual/current/06-feedback-mobile.png').convert('L')
    for y in range(1300,1440):
        row=[vp.getpixel((x,y)) for x in range(0,780,10)]
        if sum(1 for v in row if v<250)>60: print(n,'vp line y',y,min(row),max(row))
    print(n,'CTA label rows', [y for y in range(3530,3590) if min(im.getpixel((x,y)) for x in range(300,500))>200][:3])
