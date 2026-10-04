// Real unchanged T3 UI + current connector; no Bruv/Claude parent env or real credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {startModel,modelsConfig,modelSlug} from '../../../../scripts/claude-native-acceptance/model.mjs';
const [t3,connector,normal,browserPath,playwrightModule,output,scenario='aligned',portArgument='19383']=process.argv.slice(2);
if(!output)throw Error('Usage: replay.mjs T3 CONNECTOR NORMAL BROWSER PLAYWRIGHT_MODULE NEW_OUTPUT [aligned|default-home|no-model] [PORT]');
const root=path.resolve(output);await fs.mkdir(root,{mode:0o700});
const home=path.join(root,'home'),base=path.join(root,'t3-base'),project=path.join(root,'project'),bin=path.join(root,'bin');
for(const p of [home,project,bin,path.join(base,'userdata')])await fs.mkdir(p,{recursive:true});
const agent=path.join(home,'.bruv','claude-compat');await fs.mkdir(agent,{recursive:true});
const actual=path.join(bin,'bruv-claude-compat');await fs.copyFile(connector,actual);await fs.chmod(actual,0o755);await fs.copyFile(normal,path.join(bin,'bruv'));await fs.chmod(path.join(bin,'bruv'),0o755);
const hash=async(p)=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
assert.equal(await hash(t3),'53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48','not official 2644');
const env={HOME:home,PATH:'/usr/bin:/bin',TMPDIR:root};
const probes=[['--version'],['--help'],['auth','status']].map(args=>{const r=spawnSync(actual,args,{env,encoding:'utf8'});return {args,exitCode:r.status,stdout:r.stdout,stderr:r.stderr};});
await fs.writeFile(path.join(root,'probes.json'),JSON.stringify(probes,null,2));
const wire=path.join(root,'private-wire.ndjson'),tap=path.join(bin,'passive-tap');
// Observational wrapper only. No flags/environment/version/account translation.
await fs.writeFile(tap,(await fs.readFile(new URL('./passive-tap.mjs',import.meta.url),'utf8')).replace("'CONNECTOR_PLACEHOLDER'",JSON.stringify(actual)).replace("'WIRE_PLACEHOLDER'",JSON.stringify(wire)));await fs.chmod(tap,0o755);
const model=await startModel({reply:(body)=>{if(scenario==='two-mcp'){const messages=body.messages??[],last=messages.findLastIndex(m=>m.role==='user');if(!messages.slice(last+1).some(m=>m.role==='tool')){const tool=body.tools?.find(t=>t.function?.name.includes('orchestrator_capabilities'));assert.ok(tool,'real T3 read-only MCP tool absent');return {role:'assistant',tool_calls:[{index:0,id:'teardown_capabilities_'+(body.__sequence??1),type:'function',function:{name:tool.function.name,arguments:'{}'}}]};}}return {role:'assistant',content:'ADMISSION_CONFIRMED_REAL'};}});
if(scenario!=='no-model')await fs.writeFile(path.join(agent,'models.json'),JSON.stringify(modelsConfig(model.port)));
const providerConfig={binaryPath:tap,customModels:[{slug:modelSlug,name:'Local deterministic admission (not Claude)',capabilities:{optionDescriptors:[]}}]};
if(scenario!=='default-home')providerConfig.homePath=path.join(agent,'native-history');
await fs.writeFile(path.join(base,'userdata','settings.json'),JSON.stringify({providerInstances:{claudeAgent:{driver:'claudeAgent',enabled:true,displayName:'Bruv admission (not Claude)',config:providerConfig}}},null,2));
await fs.writeFile(path.join(project,'README.md'),'# Isolated provider admission\n');
for(const args of [['init','-q'],['add','README.md'],['-c','user.name=Admission test','-c','user.email=fixture@localhost','commit','-qm','Test']])assert.equal(spawnSync('/usr/bin/git',['-C',project,...args],{env}).status,0);
const port=Number(portArgument),url='http://127.0.0.1:'+port;
const logfile=await fs.open(path.join(root,'private-server.log'),'w',0o600);
const server=spawn(t3,['serve','--host','127.0.0.1','--port',String(port),'--base-dir',base,'--auto-bootstrap-project-from-cwd',project],{env,stdio:['ignore',logfile.fd,logfile.fd]});
let browser,page,result={scenario,t3Sha256:await hash(t3),connectorSha256:await hash(actual),normalSha256:await hash(path.join(bin,'bruv')),parentEnvironment:Object.keys(env),modelCalls:0,send:false};
const capture=async name=>{await fs.writeFile(path.join(root,name+'.txt'),(await page.locator('body').innerText()).replaceAll(root,'<RUNTIME>'));await page.screenshot({path:path.join(root,name+'.png')});};
try{
let ready=false;for(let i=0;i<300;i++){try{if((await fetch(url,{signal:AbortSignal.timeout(300)})).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
const {chromium}=await import(pathToFileURL(playwrightModule));browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1400,height:950}});page.setDefaultTimeout(15000);
const pairing=spawnSync(t3,['pair','--base-dir',base],{env,encoding:'utf8'});const token=pairing.stdout.match(/token=([A-Za-z0-9_-]+)/)?.[1];assert.ok(token);await page.goto(url+'/pair#token='+token);
const connect=page.getByText('Connect your computers',{exact:true}),readyUI=page.getByRole('button',{name:'Start without a project',exact:true}).or(page.getByRole('button',{name:'New thread',exact:true}).and(page.locator(':enabled')));await connect.or(readyUI).or(page.getByRole('button',{name:'Add project',exact:true}).first()).first().waitFor({timeout:30000});
await page.waitForTimeout(2000);if(await connect.isVisible()){await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByText('Connect your agents',{exact:true}).waitFor();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Do not import projects',exact:true}).click();await page.getByText('Set up T3 Code',{exact:true}).waitFor({state:'hidden'});}
await page.goto(url+'/settings/providers');await page.getByRole('button',{name:'Select Bruv admission (not Claude)',exact:true}).click();await page.waitForTimeout(5000);await capture('readiness');
if(scenario==='no-model'){const rows=(await fs.readFile(wire,'utf8')).trim().split('\n').map(JSON.parse);result.healthInitializationError=rows.find(x=>x.kind==='stderr'&&x.value.includes('No configured Bruv model'))?.value;assert.ok(result.healthInitializationError);}else{
await page.goto(url);await page.waitForTimeout(1500);if(await page.getByRole('button',{name:'Add project',exact:true}).first().isVisible()){await page.getByRole('button',{name:'Add project',exact:true}).first().click();await page.getByRole('option',{name:/Local folder/}).click();const folder=page.getByPlaceholder('Enter path (e.g. ~/projects/my-app)',{exact:true});await folder.fill(project);await folder.press('Enter');}else{const empty=page.getByRole('button',{name:'Start without a project',exact:true});await empty.or(page.getByRole('button',{name:'New thread',exact:true}).and(page.locator(':enabled'))).first().waitFor();if(await empty.isVisible())await empty.click();else await page.getByRole('button',{name:'New thread',exact:true}).and(page.locator(':enabled')).click();}
const message=page.getByRole('textbox',{name:'Message',exact:true});await message.waitFor();await page.locator('[data-chat-provider-model-picker="true"]').first().click();await page.getByText('Local deterministic admission (not Claude)',{exact:true}).last().click();await capture('pre-send');await message.fill('ADMISSION_SIMPLE: reply once.');await page.getByRole('button',{name:'Submit message',exact:true}).click();result.send=true;
try{await page.getByText('ADMISSION_CONFIRMED_REAL',{exact:true}).last().waitFor({timeout:25000});result.reply=true;await page.waitForTimeout(3000);result.idle=await page.getByRole('button',{name:'Submit message',exact:true}).isVisible();}catch(e){result.reply=false;result.waitError=String(e);}await capture('post-send');if(result.reply&&scenario==='two-mcp'){await message.fill('ADMISSION_SECOND: use actual capabilities then reply.');await page.getByRole('button',{name:'Submit message',exact:true}).click();for(let i=0;i<250;i++){if(await page.getByText('ADMISSION_CONFIRMED_REAL',{exact:true}).count()>=2){result.secondReply=true;break;}await page.waitForTimeout(100);}assert.ok(result.secondReply);await page.waitForTimeout(1000);await capture('post-second');}}
}catch(e){result.error=String(e);if(page)await capture('failure').catch(()=>{});}finally{result.modelCalls=model.records.length;result.modelErrors=model.records.filter(x=>x.error);result.t3Sha256After=await hash(t3);await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));await browser?.close();server.kill('SIGTERM');await new Promise(r=>{server.once('exit',r);setTimeout(()=>{server.kill('SIGKILL');r()},5000).unref()});await logfile.close();await model.close();
let rows=[];for(let i=0;i<100;i++){rows=(await fs.readFile(wire,'utf8')).trim().split('\n').map(JSON.parse);const main=rows.find(x=>x.kind==='spawn'&&x.value.args.includes('--mcp-config'));if(main){const exit=rows.find(x=>x.kind==='exit'&&x.pid===main.pid);if(exit){result.connectorExit=exit.value;result.connectorStderrLines=rows.filter(x=>x.kind==='stderr'&&x.pid===main.pid).length;break;}}await new Promise(r=>setTimeout(r,50));}
await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}if(result.error||!result.reply||!result.idle||result.connectorExit!==0||result.connectorStderrLines!==0||result.modelErrors.length)process.exitCode=1;
