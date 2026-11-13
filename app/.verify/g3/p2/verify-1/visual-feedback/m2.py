from PIL import Image
R='/Users/jyl/work/study/pr-sim/app/.verify/g3/recheck1/visual/current/'
C='/Users/jyl/work/study/pr-sim/app/.verify/g3/p2/verify-1/visual/crops/'
f=Image.open(R+'03-presentation-mobile-full.png').convert('RGB'); print(f.size)
d=Image.open(R+'03-presentation-desktop.png').convert('RGB'); print(d.size)
f.resize((f.width//2,f.height//2)).save(C+'recheck1-mobile-full-half.png')
d.crop((540,40,905,870)).save(C+'recheck1-desktop-screen.png')
