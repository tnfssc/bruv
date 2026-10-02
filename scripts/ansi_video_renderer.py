"""Shared PIL snapshot renderer; callers own provenance and acceptance audits."""
import math, os, re, subprocess, unicodedata
from PIL import Image, ImageDraw, ImageFont

def render_video(rows, video, heading, subheading, footer, audit_frame=None):
 W,H=1600,1200; fps=5; duration=rows[-1]['t']; frames=math.ceil(duration*fps)
 fontpath='/usr/share/fonts/noto/NotoSansMono-Regular.ttf'
 mono=ImageFont.truetype(fontpath,18);
 symbolpath='/usr/share/fonts/TTF/MesloLGMDZNerdFontMono-Regular.ttf'
 symbols=ImageFont.truetype(symbolpath,18) if os.path.exists(symbolpath) else mono
 title=ImageFont.truetype(fontpath,24); small=ImageFont.truetype(fontpath,16); captionfont=ImageFont.truetype(fontpath,20)
 base=['#0f172a','#f87171','#86efac','#fde68a','#93c5fd','#c4b5fd','#67e8f9','#e2e8f0']
 def ansi(n):
  if n<16:return base[n%8]
  if n>=232:return (8+(n-232)*10,)*3
  n-=16;r=n//36;g=(n//6)%6;b=n%6;vals=[0,95,135,175,215,255];return tuple(vals[x] for x in (r,g,b))
 def drawscreen(draw,text):
  fg='#e2e8f0'; bg=None; bold=False
  for row,line in enumerate(text.splitlines()[:44]):
   col=0
   for token in re.split(r'(\x1b\[[0-9;]*m)',line):
    if token.startswith('\x1b'):
     nums=[int(v or 0) for v in token[2:-1].split(';')];i=0
     while i<len(nums):
      n=nums[i]
      if n==0:fg='#e2e8f0';bg=None;bold=False
      elif n==1:bold=True
      elif n==22:bold=False
      elif n==39:fg='#e2e8f0'
      elif n==49:bg=None
      elif 30<=n<=37:fg=base[n-30]
      elif 90<=n<=97:fg=base[n-90]
      elif 40<=n<=47:bg=base[n-40]
      elif n in (38,48) and i+2<len(nums):
       color=None
       if nums[i+1]==5:color=ansi(nums[i+2]);i+=2
       elif nums[i+1]==2 and i+4<len(nums):color=tuple(nums[i+2:i+5]);i+=4
       if color is not None:
        if n==38:fg=color
        else:bg=color
      i+=1
     continue
    for char in token:
     if ord(char)<32:continue
     width=0 if unicodedata.combining(char) else 2 if unicodedata.east_asian_width(char) in ('W','F') else 1
     x=44+col*11;y=151+row*22
     if bg:draw.rectangle((x,y,x+width*11,y+22),fill=bg)
     draw.text((x,y),char,font=symbols if ord(char)>=0xE000 or char in ('✗','✓','⚠') else mono,fill=fg,stroke_width=0)
     col+=width
     if col>=120:break
 proc=subprocess.Popen(['ffmpeg','-y','-loglevel','warning','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(fps),'-i','pipe:0','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(video)],stdin=subprocess.PIPE)
 i=0; sampled=set()
 for f in range(frames):
  t=f/fps
  while i+1<len(rows) and rows[i+1]['t']<=t:i+=1
  r=rows[i];im=Image.new('RGB',(W,H),'#0b1220');draw=ImageDraw.Draw(im)
  draw.text((36,20),heading,font=title,fill='#f8fafc')
  draw.text((36,60),subheading,font=small,fill='#94a3b8')
  draw.text((36,102),r['caption'],font=captionfont,fill='#67e8f9')
  draw.rounded_rectangle((30,143,1570,1135),radius=9,fill='#111827',outline='#334155')
  drawscreen(draw,r['screen'])
  draw.text((36,1155),footer(t),font=small,fill='#94a3b8')
  if audit_frame: audit_frame(f,t,r)
  proc.stdin.write(im.tobytes())
  if r['step'] not in sampled and t-rows[i]['t']>=0:
   im.save(str(video.parent/('sample-'+r['step']+'.png')));sampled.add(r['step'])
 proc.stdin.close();assert proc.wait()==0
 return frames, fps
