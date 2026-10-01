#!/usr/bin/env python3
"""Build the final native-terminal replay from accepted frozen-byte proof captures.
Adapted renderer: task_80e67b72/scripts/remote-video-replay.py (not its scenario).
Run from repository root: python3 scripts/task-placement-final-video.py
No product execution, network, config copying, or synthetic terminal interaction.
"""
import argparse, pathlib, hashlib, json, re
p=argparse.ArgumentParser()
p.add_argument('--proofs',default='/home/tnfssc/.die/tmp-pi-removal')
p.add_argument('--frozen-tree',default='/home/tnfssc/.die/worktrees/die-a86675007a5e-task_7c7fed9c')
p.add_argument('--output',default='.die/probes/task-placement-final-video')
args=p.parse_args(); root=args.output
out=pathlib.Path(root);out.mkdir(parents=True,exist_ok=True)
proofs=pathlib.Path(args.proofs); frozen=pathlib.Path(args.frozen_tree)
sha=lambda data:hashlib.sha256(data).hexdigest()
expected='a5b4b280be56c7ce2a8826c6d46aaf949d1bf9cb856459d404dc52f0f085ce1e'
freeze=json.loads((frozen/'dist/task-placement-freeze.json').read_text())
assert freeze['sourceCommit']=='df2123e97d9acbe1244cde54c33faa2929a1fae6'
assert sha((frozen/'dist/die-task-placement-frozen').read_bytes())==expected==freeze['binarySha256']
child='placement-combined-child-proof';server='remote-root-placement-artifacts-0zcXla'
for name in (child,server):
    receipt=json.loads((proofs/name/'receipt.json').read_text())
    assert receipt['binarySha256']==expected and receipt['networkMode']=='none'
# t is editorial hold timing, not original execution timing. No added terminal text.
sequence=[
(0,child,'01-human-connect',40,'One-time authorization · fixture host only; setup is not the daily workflow'),
(8,child,'02-question-before-restart',40,'Ordinary subagent to placement-owner · local ACK-only parent; tools run on server'),
(18,child,'03-ordinary-questions-menu',40,'Child asks the human through ordinary /questions · actual picker controls'),
(26,child,'04-explicit-human-choice',40,'Human selects PLACEMENT_HUMAN_APPROVED · not a legacy /remote answer'),
(32,child,'05-jobs-clean-safe-return',40,'Placed child completes · clean source return verified by the accepted fixture'),
(40,server,'clean-01-question-picker',44,'Server root: die --place typed-root-owner · no local provider configured'),
(48,server,'clean-02-reattached-same-question',44,'Ctrl-D detach; reopen the same root · same saved question, no new session'),
(56,server,'clean-03-human-answer-choice',44,'Human answers in /questions · tool-capable fake inference runs only on server'),
(62,server,'clean-04-second-root-turn',44,'Second explicit prompt · same server journal and repository work'),
(68,server,'clean-05-task-picker',44,'/ps · normal server child is completed · real task menu'),
(76,server,'clean-06-task-inspection',44,'Task details: actual server worktree · expected non-orchestrator delegation refusal'),
(84,server,'clean-07-closed-source-return',44,'/close · Source return: applied · guarded against local source drift'),
(92,server,'clean-08-closed-reattach-no-replay',44,'Reopen closed root · same returned result; fixture verified no replay'),
]
rows=[]; provenance=[]
for t,d,n,height,caption in sequence:
    path=proofs/d/(n+'.txt'); raw=path.read_bytes(); text=raw.decode()
    lines=text.removesuffix('\n').split('\n')
    # These captures include scrollback (-S -). Recover the original terminal's
    # bottom viewport (120x40 child, 120x44 root), without editing its content.
    screen='\n'.join(lines[-height:])
    # Sole content redaction: disposable fixture HOME prefixes, not outcomes.
    screen,count=re.subn(r'/home/tnfssc/\.die/tmp-pi-removal/(?:remote-placement-e2e-[^/\s]+|remote-root-placement-e2e-[^/\s]+)/home', '[fixture HOME redacted]',screen)
    step=d+'-'+n
    rows.append(dict(t=t,step=step,caption=caption,screen=screen))
    provenance.append(dict(step=step,path=str(path),sha256=sha(raw),terminalRows=height,originalLines=len(lines),viewportStartLine=max(1,len(lines)-height+1),homeRedactions=count))
rows.append(dict(rows[-1],t=100))
(out/'screens.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
(out/'freeze-receipt.json').write_text(json.dumps(freeze,indent=2)+'\n')
receipt=dict(schema='task-placement-final-video-v1',sourceCommit=freeze['sourceCommit'],binarySha256=expected,freezeReceipt=str(frozen/'dist/task-placement-freeze.json'),originalCaptures=provenance,captureSha256=sha((out/'screens.jsonl').read_bytes()),durationSeconds=100,actualMenuControlsVisible=True,boundary='Existing actual compiled CLI captures; Docker network:none SSH; fake inference. Child local ACK-only fake parent is distinct from server tool-capable fake provider. Server root has no local provider credentials. No new execution, real hosts, or paid APIs.',replay='Retimed native snapshot replay; no invented terminal input. Scrollback cropped to original terminal viewport. Only content redaction is disclosed disposable fixture HOME prefix.',limits=['Not a live keystroke recording','One-time authorization is separate from routine placement','Native terminal proof, not release/web-packaging or paid-provider acceptance','Clean return shown; drift safety is accepted fixture evidence, not shown here'])
import sys,json,re,math,subprocess,unicodedata,os
from PIL import Image,ImageDraw,ImageFont
rows=[json.loads(x) for x in open(root+'/screens.jsonl')]
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
proc=subprocess.Popen(['ffmpeg','-y','-loglevel','warning','-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(fps),'-i','pipe:0','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',root+'/task-placement-final.mp4'],stdin=subprocess.PIPE)
i=0; sampled=set()
for f in range(frames):
 t=f/fps
 while i+1<len(rows) and rows[i+1]['t']<=t:i+=1
 r=rows[i];im=Image.new('RGB',(W,H),'#0b1220');draw=ImageDraw.Draw(im)
 draw.text((36,20),'die — root + child task placement',font=title,fill='#f8fafc')
 draw.text((36,60),'REAL COMPILED CLI · snapshot replay (retimed) · Docker network:none SSH · fake inference · HOME redacted',font=small,fill='#94a3b8')
 draw.text((36,102),r['caption'],font=captionfont,fill='#67e8f9')
 draw.rounded_rectangle((30,143,1570,1135),radius=9,fill='#111827',outline='#334155')
 drawscreen(draw,r['screen'])
 draw.text((36,1155),f'{t:05.1f}s  |  No real hosts / paid APIs · setup separate · original menus / results unchanged',font=small,fill='#94a3b8')
 proc.stdin.write(im.tobytes())
 if r['step'] not in sampled and t-rows[i]['t']>=0:
  im.save(root+'/sample-'+r['step']+'.png');sampled.add(r['step'])
proc.stdin.close();assert proc.wait()==0
print(json.dumps({'duration':frames/fps,'frames':frames,'size':os.path.getsize(root+'/task-placement-final.mp4')}))

receipt['videoSha256']=sha((out/'task-placement-final.mp4').read_bytes())
receipt['videoBytes']=(out/'task-placement-final.mp4').stat().st_size
(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
