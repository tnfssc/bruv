# Compiled terminal proof: build dist/die first; disposable HOME, no network configuration.
import os, pty, subprocess, tempfile, json, time, select, re, pathlib, shutil
binary=os.path.abspath('dist/die')
home=tempfile.mkdtemp(prefix='die-remote-pty-')
root=pathlib.Path(home)/'.die/remote'; grants=root/'capability-grants'; grants.mkdir(parents=True)
(root/'state.json').write_text(json.dumps({'tasks':{'proof1':{'taskId':'proof1','host':'unreachable.invalid','ownerId':'owner1','epoch':'epoch1','prompt':'Offline proof task','repoPath':'/tmp','outcome':'accepted','events':[],'task':{'state':'done'}}}}))
(grants/'grant_proof.json').write_text(json.dumps({'id':'grant_proof','taskId':'proof1','repoRoot':'/tmp','kinds':['repo.read']}))
master,slave=pty.openpty(); env=dict(os.environ,HOME=home,TERM='xterm-256color',NO_COLOR='1'); env.pop('DIE_REMOTE_RUNTIME_STATE',None); env.pop('OPENAI_API_KEY',None)
p=subprocess.Popen([binary,'--offline','--no-approve','--model','openai/gpt-4o-mini'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True); os.close(slave)
transcript=bytearray()
def read(sec=1):
 end=time.monotonic()+sec
 while time.monotonic()<end:
  r,_,_=select.select([master],[],[],0.1)
  if r:
   try: transcript.extend(os.read(master,65536))
   except OSError: break
def text(): return re.sub(r'\x1b\[[0-9;?]*[ -/]*[@-~]','',transcript.decode(errors='replace'))
def send(key,sec=.6):
 for byte in key:
  os.write(master,bytes([byte]));time.sleep(.09)
 read(sec)
try:
 read(3)
 send(b'\x1b[B'*4+b'\r',1.2) # do not trust this session
 send(b'/remote\r',1.5)
 assert 'Offline proof task' in text() and (grants/'grant_proof.json').exists(), 'offline inbox missing'
 send(b'\r') # task
 assert 'Local capabilities' in text(), 'offline action missing'
 send(b'Local\r') # filter capability action
 assert 'Revoke: repo.read' in text(), 'grant not visible'
 send(b'Revoke\r') # filter revoke
 assert 'Revoke local capability for this task?' in text(), 'confirmation missing'
 assert not (grants/'grant_proof.revoked').exists(), 'revoked before confirmation'
 send(b'\r',1.2) # confirm
 assert (grants/'grant_proof.revoked').exists() and 'Owner not notified' in text(), 'durable local revoke / honest status missing'
 print('PASS compiled terminal: offline task -> local capability -> confirm -> durable revoke; owner not notified')
finally:
 p.terminate();p.wait(timeout=5);os.close(master)
 shutil.rmtree(home)
