from PIL import Image
cur=Image.open('current/02-setup-mobile-full.png').convert('RGB')
d=Image.open('/Users/jyl/work/study/pr-sim/docs/screens/draft/02-setup.png').convert('RGB').resize((780,1921))
def pair(name,dy,cy):
    a=d.crop((0,dy[0],780,dy[1])); b=cur.crop((0,cy[0],780,cy[1]))
    H=max(a.size[1],b.size[1]); im=Image.new('RGB',(1580,H),(255,0,0)); im.paste(a,(0,0)); im.paste(b,(800,0)); im.save(f'crops/setup-{name}.png')
pair('top',(0,410),(0,480))
pair('sliders',(640,965),(740,1095))
pair('files',(975,1380),(1110,1500))
pair('judges',(1370,1921),(1480,2188))
