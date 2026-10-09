// New connector version probe + unchanged installed T3 2702 + loopback inference.
// Historical 2644 proof stays unchanged. No real user data or provider requests.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const {T3_BINARY,BRUV_CONNECTOR_EXECUTABLE,BRUV_RUNTIME_BINARY,BROWSER_PATH,PLAYWRIGHT_MODULE,PROOF_OUTPUT}=process.env;
for(const [name,value] of Object.entries({T3_BINARY,BRUV_CONNECTOR_EXECUTABLE,BRUV_RUNTIME_BINARY,BROWSER_PATH,PROOF_OUTPUT}))assert.ok(value,`${name} required`);
const control=process.env.EXPECT_UPDATE_PROMPT==='1';
const binary=path.resolve(T3_BINARY);
const hash=async()=>createHash('sha256').update(await fs.readFile(binary)).digest('hex');
const connectorSha256=createHash('sha256').update(await fs.readFile(BRUV_CONNECTOR_EXECUTABLE)).digest('hex');
const normalSha256=createHash('sha256').update(await fs.readFile(BRUV_RUNTIME_BINARY)).digest('hex');
const before=await hash();assert.ok(binary.includes('0.0.46-nightly.20261005.2702'),'Use the exact inspected host release');
const proof=path.resolve(PROOF_OUTPUT);await fs.mkdir(proof,{recursive:true});
const root=await fs.mkdtemp(path.join(os.tmpdir(),'bruv-compat-version-'));
const home=path.join(root,'home'),agent=path.join(home,'.bruv/agent'),sdkHome=path.join(home,'.bruv/claude-compat-sdk'),base=path.join(root,'t3-base'),project=path.join(root,'project'),bin=path.join(root,'bin');
let server,browser,calls=0;const requests=[];
const model=http.createServer(async(req,res)=>{
 try {
  const parts=[];for await(const part of req)parts.push(part);
  const body=JSON.parse(Buffer.concat(parts));requests.push({model:body.model});calls++;
  assert.equal(body.model,'fixture-model');
  const auxiliary=body.messages.some(m=>JSON.stringify(m.content).includes('Return only JSON matching'));
  const content=auxiliary?'{"title":"Compatibility check"}':'COMPAT_REPLY_REAL';
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const [delta,finish_reason] of [[{role:'assistant',content},null],[{},'stop']])res.write(`data: ${JSON.stringify({id:'local-version-proof',object:'chat.completion.chunk',created:1,model:'fixture-model',choices:[{index:0,delta,finish_reason}]})}\n\n`);
  res.end('data: [DONE]\n\n');
 }catch(e){res.writeHead(500);res.end(String(e));}
});
try {
 for(const p of [agent,sdkHome,project,bin,path.join(base,'userdata')])await fs.mkdir(p,{recursive:true});
 await new Promise(r=>model.listen(0,'127.0.0.1',r));
 await fs.copyFile(BRUV_CONNECTOR_EXECUTABLE,path.join(bin,'bruv-claude-compat'));await fs.chmod(path.join(bin,'bruv-claude-compat'),0o755);
 await fs.symlink(BRUV_RUNTIME_BINARY,path.join(bin,'bruv'));
 await fs.writeFile(path.join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${model.address().port}/v1`,api:'openai-completions',apiKey:'loopback-only',models:[{id:'fixture-model',name:'Compatibility local model',contextWindow:32000,maxTokens:1024}]}}}));
 await fs.writeFile(path.join(agent,'settings.json'),JSON.stringify({defaultProvider:'fixture',defaultModel:'fixture-model',cacheWarming:'off'}));
 await fs.writeFile(path.join(project,'README.md'),'# Isolated compatibility test');
 await fs.writeFile(path.join(base,'userdata/settings.json'),JSON.stringify({enableProviderUpdateChecks:true,providerInstances:{claudeAgent:{driver:'claudeAgent',enabled:true,displayName:'Bruv compatibility local test (not Claude)',config:{binaryPath:path.join(bin,'bruv-claude-compat'),homePath:sdkHome,customModels:[{slug:'fixture/fixture-model',name:'Compatibility local model',capabilities:{optionDescriptors:[]}}]}}}}));
 // No two BRUV overrides and no server-level CLAUDE_CONFIG_DIR. T3's provider
 // homePath scopes its connector child; default auth home follows this HOME.
 const env={PATH:[path.dirname(process.execPath),'/usr/bin','/bin'].join(':'),HOME:home,TMPDIR:root};
 const git=a=>execFileSync('/usr/bin/git',['-C',project,...a],{env});git(['init','-q']);git(['add','README.md']);git(['-c','user.name=Fixture','-c','user.email=fixture@localhost','commit','-qm','Fixture']);
 const portServer=http.createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const url=`http://127.0.0.1:${port}`;const log=await fs.open(path.join(root,'server.log'),'w',0o600);
 server=spawn(binary,['serve','--host','127.0.0.1','--port',String(port),'--base-dir',base,'--auto-bootstrap-project-from-cwd',project],{env,stdio:['ignore',log.fd,log.fd]});await log.close();
 let ready=false;for(let i=0;i<200;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(300)})).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
 const {chromium}=await import(pathToFileURL(PLAYWRIGHT_MODULE).href);
 browser=await chromium.launch({headless:true,executablePath:BROWSER_PATH,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1400,height:950}});page.setDefaultTimeout(30000);
 const paired=execFileSync(binary,['pair','--base-dir',base],{env,encoding:'utf8'});const token=paired.match(/token=([A-Za-z0-9_-]+)/)?.[1];assert.ok(token);
 await page.goto(`${url}/pair#token=${token}`);await page.waitForTimeout(1500);
 const connect=page.getByText('Connect your computers',{exact:true});const readyNew=page.getByRole('button',{name:'Start without a project',exact:true}).or(page.getByRole('button',{name:'New thread',exact:true}).and(page.locator(':enabled')));
 await connect.or(readyNew).first().waitFor();
 if(await connect.isVisible()) {await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByText('Connect your agents',{exact:true}).waitFor();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Do not import projects',exact:true}).click();await page.getByText('Set up T3 Code',{exact:true}).waitFor({state:'hidden'});}
 await page.goto(`${url}/settings/providers`);await page.getByRole('button',{name:'Select Bruv compatibility local test (not Claude)',exact:true}).click();
 await page.getByText('Authenticated',{exact:true}).first().waitFor(); // upstream label; local readiness only
 if(control)await page.getByText(/^Update Available: Claude /).first().waitFor();
 else await page.waitForTimeout(4500); // Allow the host's bounded latest lookup window before absence assertions.
 const setup=await page.locator('body').innerText();assert.ok(!/Unsupported version/i.test(setup),setup);
 assert.match(execFileSync(path.join(bin,'bruv-claude-compat'),['--version'],{env,encoding:'utf8'}).trim(),control?/\b2\.1\.280\b/:/^Bruv connector$/);
 assert.equal(/Updates? Available:/i.test(setup),control,setup);
 assert.equal(/Install the update now or review provider settings\./i.test(setup),control,setup);
 if(!control)assert.equal(await page.getByRole('button',{name:/^Update(?: all)?$/i}).count(),0,'Provider update button should not be offered');
 await fs.writeFile(path.join(proof,'settings.txt'),setup.replaceAll(root,'<RUNTIME>'));await page.screenshot({path:path.join(proof,'settings.png')});
 assert.equal(calls,0,'health probe must not infer');
 await page.goto(url);await page.waitForTimeout(1500);
 const empty=page.getByRole('button',{name:'Start without a project',exact:true});if(await empty.isVisible())await empty.click();else await page.getByRole('button',{name:'New thread',exact:true}).and(page.locator(':enabled')).click();
 const message=page.getByRole('textbox',{name:'Message',exact:true});await message.waitFor();
 await page.locator('[data-chat-provider-model-picker="true"]').first().click();await page.getByText('Compatibility local model',{exact:true}).last().click();
 await message.fill('Reply with the local compatibility marker.');await page.getByRole('button',{name:'Submit message',exact:true}).click();
 await page.getByText('COMPAT_REPLY_REAL',{exact:false}).last().waitFor();
 const chat=await page.locator('body').innerText();assert.ok(!/Unsupported version/i.test(chat),chat);if(!control){assert.ok(!/Updates? Available:/i.test(chat),chat);assert.ok(!/Install the update now or review provider settings\./i.test(chat),chat);}
 await fs.writeFile(path.join(proof,'chat.txt'),chat.replaceAll(root,'<RUNTIME>'));await page.screenshot({path:path.join(proof,'chat.png')});
 assert.ok(calls>0);assert.equal(await hash(),before);
 await fs.writeFile(path.join(proof,'result.json'),`${JSON.stringify({passed:true,profile:control?'realT3 2702: old-version control':'realT3 2702: semver-free Bruv CLI identity',t3Sha256:before,connectorSha256,normalSha256,updatePromptAbsent:!control,oldVersionControl:control,remainingModelWarning:/too old|Upgrade to v/i.test(`${setup} ${chat}`),connectorVersion:execFileSync(path.join(bin,'bruv-claude-compat'),['--version'],{env,encoding:'utf8'}).trim(),bruvVersion:execFileSync(path.join(bin,'bruv-claude-compat'),['--bruv-version'],{env,encoding:'utf8'}).trim(),twoBruvOverrides:false,serverClaudeConfigDir:false,unsupportedWarningAbsent:true,customModel:'fixture/fixture-model',modelRequests:requests,paidCalls:0,authClaim:'upstream Authenticated label means fixture readiness; only local fake credentials used'},null,2)}\n`);
 console.log(control?'Old-version control observed Bruv update prompt on unchanged T3 2702.':'Real unchanged T3 2702 settings/chat checks completed with no Bruv update prompt.');
} catch(error) {
 await fs.writeFile(path.join(proof,'failure.txt'),`${String(error)}\n`);console.error(error);process.exitCode=1;
} finally {
 await browser?.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>{server.once('close',r);setTimeout(()=>{server.kill('SIGKILL');r()},3000).unref()});}
 await new Promise(r=>model.close(r));await fs.rm(root,{recursive:true,force:true});
}
