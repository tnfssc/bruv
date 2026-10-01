#!/usr/bin/env python3
"""Render newly recorded clean PTY snapshots. Never filters product text or outcomes."""
import argparse,json,re,hashlib,pathlib,subprocess
p=argparse.ArgumentParser();p.add_argument('--output',required=True);args=p.parse_args()
out=pathlib.Path(args.output).resolve();root=str(out)
sha=lambda b:hashlib.sha256(b).hexdigest()
receipt=json.loads((out/'capture-receipt.json').read_text())
assert receipt['binarySha256']=='e7dd04755a529eab1f6ba58dbd132a6997eed07b1b84604e3d473114fea21282'
assert receipt['networkMode']=='none'
banned=[r'PLACEMENT_',r'ROOT_',r'typed-root',r'RootCommand',r'ROOT_READY',r'fixture verified',r'acceptance',r'nonce',r'receipt',r'(?i)toolcode',r'root-proof',r'ROOT_BASE',r'ACK_ONLY',r'query\s+status',r'Saved answer for',r'"replyId"',r'"branchId"',r'Execution failed',r'BuildMessage',r'Pane is dead']
source_timeline=json.loads((out/'timeline.json').read_text())
rendered_paths={r['path'] for r in source_timeline if r['step']!='05-detached'}
originals=[]
for path in sorted(out.glob('*.txt')):
 if path.name not in ['failure.txt']:
  raw=path.read_bytes();text=raw.decode();hits=[v for v in banned if re.search(v,text)]
  # Successful tmux exit overlay is retained as automation diagnostics, never terminal product footage.
  rendered = path.name in rendered_paths
  if rendered: assert not hits,(path.name,hits)
  originals.append({'path':str(path),'sha256':sha(raw),'markerFindings':hits,'rendered':rendered})
diagnostic_audit=[]
for path in sorted((out/'diagnostics').glob('*.scrollback.txt')):
 raw=path.read_bytes();text=raw.decode()
 diagnostic_audit.append({'path':str(path),'sha256':sha(raw),'findings':[v for v in banned if re.search(v,text)],'purpose':'Offscreen full original scrollback; not a rendered viewport'})
excluded_take_audit=[]
for path in sorted(out.glob('failed-*/**/*.txt')):
 raw=path.read_bytes();text=raw.decode()
 excluded_take_audit.append({'path':str(path),'sha256':sha(raw),'findings':[v for v in banned if re.search(v,text)],'purpose':'Preserved failed producer attempt; not used for final frames'})
timeline=[];redactions=[]
for row in source_timeline:
 if row['step']=='05-detached': continue # Full original capture kept: tmux-only successful-exit overlay, not product UI.
 path=out/row['path'];raw=path.read_bytes();screen=raw.decode()
 # The only text substitution is this disclosed disposable HOME prefix.
 screen,count=re.subn(r'/home/tnfssc/\.die/(?:tmp-pi-removal|probes)/[^/\s]+/home','[demo HOME]',screen)
 assert len(screen.splitlines())<=44, 'Never discard terminal rows'
 row['screen']=screen;timeline.append(row);redactions.append({'step':row['step'],'count':count,'originalSha256':sha(raw)})
timeline.append(dict(timeline[-1],t=receipt['durationSeconds']))
(out/'screens.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in timeline))
frame_audit=[]
import sys,json,re,math,subprocess,unicodedata,os
from PIL import Image,ImageDraw,ImageFont
rows=timeline
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
proc=subprocess.Popen(['ffmpeg','-y','-loglevel','warning','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(fps),'-i','pipe:0','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',root+'/task-placement-clean.mp4'],stdin=subprocess.PIPE)
i=0; sampled=set()
for f in range(frames):
 t=f/fps
 while i+1<len(rows) and rows[i+1]['t']<=t:i+=1
 r=rows[i];im=Image.new('RGB',(W,H),'#0b1220');draw=ImageDraw.Draw(im)
 draw.text((36,20),'die — work on a named server',font=title,fill='#f8fafc')
 draw.text((36,60),'Actual CLI capture replay · isolated Docker SSH · fake inference',font=small,fill='#94a3b8')
 draw.text((36,102),r['caption'],font=captionfont,fill='#67e8f9')
 draw.rounded_rectangle((30,143,1570,1135),radius=9,fill='#111827',outline='#334155')
 drawscreen(draw,r['screen'])
 draw.text((36,1155),f'{t:05.1f}s  |  Disposable HOME paths redacted · no real hosts or paid APIs',font=small,fill='#94a3b8')
 # Every frame's complete visible text is audited, not only selected samples.
 for pattern in banned:
  assert not re.search(pattern, r['screen']+'\n'+r['caption']), (f, pattern)
 frame_audit.append({'frame':f,'t':t,'step':r['step'],'screenSha256':sha(r['screen'].encode())})
 proc.stdin.write(im.tobytes())
 if r['step'] not in sampled and t-rows[i]['t']>=0:
  im.save(root+'/sample-'+r['step']+'.png');sampled.add(r['step'])
proc.stdin.close();assert proc.wait()==0
print(json.dumps({'duration':frames/fps,'frames':frames,'size':os.path.getsize(root+'/task-placement-clean.mp4')}))


(out/'all-frame-audit.json').write_text(json.dumps({'patterns':banned,'captures':originals,'diagnosticScrollback':diagnostic_audit,'failedAttemptCaptures':excluded_take_audit,'frames':frame_audit},indent=2)+'\n')
video=out/'task-placement-clean.mp4'
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(video)]))
stream=probe['streams'][0];assert stream['codec_name']=='h264' and stream['pix_fmt']=='yuv420p'
# Fully decode every encoded frame; fail on corrupt playback.
subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(video),'-f','null','-'],check=True)
# Explicit MP4 atom order check for faststart.
b=video.read_bytes();offset=0;atoms=[]
while offset+8<=len(b):
 n=int.from_bytes(b[offset:offset+4],'big');tag=b[offset+4:offset+8].decode('ascii');atoms.append(tag)
 assert n>=8;offset+=n
assert atoms.index('moov')<atoms.index('mdat')
receipt.update({'originalCaptures':originals,'diagnosticScrollbackAudit':diagnostic_audit,'failedAttemptCaptureAudit':excluded_take_audit,'scrollbackDisclosure':'The product emits saved-answer internal JSON in full scrollback. This is retained untouched in diagnostic side files. None appears in captured viewport frames; natural final notes preview fills the actual terminal viewport. No filtering, scrollback reclassification of old recordings, or terminal text deletion.','homeRedactions':redactions,'videoSha256':sha(b),'videoBytes':len(b),'captureSha256':sha((out/'screens.jsonl').read_bytes()),'frameCount':frames,'fps':fps,'allRenderedFramesAndCapturesMarkerAudit':'passed','omittedCaptureDisclosure':'The original 05-detached snapshot includes tmux remain-on-exit status0 chrome. It is preserved and audited, but omitted as automation-only footage. The clip shows the normal question picker before detach and the same picker after real reopen; no terminal text, failure or outcome was deleted.','fullyDecoded':True,'codec':'h264','pixelFormat':'yuv420p','faststart':True,'mp4Atoms':atoms,'presentation':'Retimed new actual compiled CLI PTY snapshots; no synthetic typed input/output, no deletion of diagnostic text. Producer uses natural prompts, tool labels and outputs; verification stays in side files.'})
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
