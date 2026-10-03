import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {exercise} from './native-actions.mjs';
const upstream=path.resolve(process.env.T3_UPSTREAM || '/home/tnfssc/Code/bruv/.cache/acp-t3-upstream-experience');
const binary=path.join(upstream,'platform/t3');
const browserPath=process.env.BROWSER_PATH || '/home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const port=Number(process.env.FIXTURE_PORT || '18783');
const url='http://127.0.0.1:'+port;
const root=path.resolve('.cache/claude-native-ui-replay');
const proof=path.resolve(process.env.PROOF_OUTPUT || '.cache/claude-native-ui-replay-proof-'+Date.now());
// Never reuse a credential-bearing runtime or remove an unrelated directory.
await fs.mkdir(root,{mode:0o700});await fs.mkdir(proof);
const home=path.join(root,'home'),project=path.join(root,'project'),base=path.join(root,'t3-base');
await fs.mkdir(home);await fs.mkdir(project);
const fixture=path.join(root,'research-claude-compatible-fixture');
await fs.copyFile(fileURLToPath(new URL('./fixture.mjs',import.meta.url)),fixture);await fs.chmod(fixture,0o755);
await fs.writeFile(path.join(project,'README.md'),'# Isolated synthetic fixture project\nNo Bruv execution or provider inference.\n');
const env={PATH:'/usr/bin:/bin',HOME:home,SPIKE_PROTOCOL_ONLY:'1',SPIKE_LOG:path.join(root,'wire.ndjson')};
const git=(args)=>execFileSync('/usr/bin/git',['-C',project,...args],{env,stdio:'pipe'});
git(['init','-q']);git(['add','README.md']);git(['-c','user.name=Research fixture','-c','user.email=fixture@localhost','commit','-qm','Initialize fixture project']);
const before=createHash('sha256').update(await fs.readFile(binary)).digest('hex');
const version=execFileSync(binary,['--version'],{env,encoding:'utf8'}).trim();
const log=await fs.open(path.join(root,'private-server.log'),'w',0o600);
const server=spawn(binary,['serve','--host','127.0.0.1','--port',String(port),'--base-dir',base,'--auto-bootstrap-project-from-cwd',project],{env,stdio:['ignore',log.fd,log.fd]});
let browser;
try {
 let ready=false;
 for(let i=0;i<200;i++){
  if(server.exitCode!==null)throw Error('T3 exited before readiness; private log retained only until cleanup');
  try{const r=await fetch(url,{signal:AbortSignal.timeout(300)});if(r.ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.ok(ready,'T3 local HTTP readiness');
 const {chromium}=await import(pathToFileURL(path.join(upstream,'runtime/node_modules/playwright/index.mjs')).href);
 browser=await chromium.launch({headless:true,executablePath:browserPath,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1400,height:950}});const page=await context.newPage();page.setDefaultTimeout(10000);
 const paired=execFileSync(binary,['pair','--base-dir',base],{env,encoding:'utf8'});
 const token=paired.match(/token=([A-Za-z0-9_-]+)/)?.[1];assert.ok(token,'local pairing token (never exported)');
 await page.goto(url+'/pair#token='+token);await page.waitForTimeout(1500);
 // Normal native first-run flow, without external sign-in, installation, or license bypass.
 if(await page.getByText('Connect your computers',{exact:true}).isVisible()){
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByText('Connect your agents',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Do not import projects',exact:true}).click();
  await page.getByText('Set up T3 Code',{exact:true}).waitFor({state:'hidden'});
 }
 await page.goto(url+'/settings/providers');
 await page.getByRole('button',{name:'Select Claude',exact:true}).click();
 const name=page.locator('#provider-instance-claudeAgent-display-name');await name.fill('Bruv Claude-protocol research fixture');await name.blur();await page.waitForTimeout(1500);
 const executable=page.locator('#provider-instance-claudeAgent-binaryPath');await executable.fill(fixture);await executable.blur();
 await page.getByText('Authenticated',{exact:true}).first().waitFor();
 const body=()=>page.locator('body').innerText();
 const snapshot=async(name)=>{await fs.writeFile(path.join(proof,name+'.txt'),(await body()).replaceAll(root,'<RUNTIME>'));await page.screenshot({path:path.join(proof,name+'.png')});};
 await snapshot('readiness');
 await page.goto(url);await page.waitForTimeout(1500);
 if(!(await page.getByRole('textbox',{name:'Message',exact:true}).isVisible())) {
 await page.getByRole('button',{name:'Add project',exact:true}).first().click();await page.waitForTimeout(500);
 await page.getByRole('option',{name:/Local folder/}).click();
 const folder=page.getByPlaceholder('Enter path (e.g. ~/projects/my-app)',{exact:true});await folder.fill(project);await folder.press('Enter');
 }
 await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();
 await exercise({page,url,snapshot,body,assert});
 const wire=(await fs.readFile(env.SPIKE_LOG,'utf8')).trim().split('\n').map(JSON.parse);
 const incoming=wire.filter(x=>x.kind==='stdin').map(x=>x.value);
 const steer=incoming.find(m=>m.type==='user'&&m.priority==='now');assert.ok(steer,'native steering priority=now');
 assert.ok(incoming.some(m=>m.type==='control_request'&&m.request.subtype==='interrupt'),'native Stop interrupt request');
 // Export only safe seam fields. No argv, prompts/system instructions, MCP configs, UUIDs, tokens, or cookies.
 const projection=wire.flatMap(x=>{
  if(x.kind==='lifecycle')return [x];
  if(x.kind!=='stdin'&&x.kind!=='stdout')return [];
  const m=x.value;
  return [{direction:x.kind,type:m.type,...(m.subtype?{subtype:m.subtype}:{}),...(m.type==='control_request'?{control:m.request.subtype}:{}),...(m.priority?{priority:m.priority}:{}),...(m.type==='system'&&m.status?{status:m.status}:{})}];
 });
 await fs.writeFile(path.join(proof,'wire-projection.ndjson'),projection.map(x=>JSON.stringify(x)).join('\n')+'\n');
 const after=createHash('sha256').update(await fs.readFile(binary)).digest('hex');assert.equal(after,before);
 await fs.writeFile(path.join(proof,'result.json'),JSON.stringify({researchOnly:true,fixtureMode:true,anthropicAccount:false,fixtureProviderCalls:0,syntheticEventsNotBruvExecution:true,t3Version:version,t3BinarySha256:before,upstreamUnmodified:true,defaultRefusal:'tested by test-fixture.mjs',nativePrompt:'PASS',nativeSteering:'PASS (queue then Steer; priority=now)',syntheticTaskDisplay:'PASS (Running/progress/Stopped)',nativeStop:'PASS (interrupt request and Run interrupted by user)',reload:'PASS (reopen thread after real reload)',nativeAuthEnum:'authenticated is T3 local executable readiness; no account fields emitted',versionWarning:'0.0.1 unsupported warning deliberately retained; nonblocking',privateRuntimeRemoved:true},null,2)+'\n');
 console.log('PASS native prompt, active steering, synthetic monitor, Stop, reload. Proof: '+proof);
} finally {
 if(browser)await browser.close();
 if(server.exitCode===null){server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);if(server.exitCode===null)server.kill('SIGKILL');}
 await log.close();await fs.rm(root,{recursive:true,force:true});
}
