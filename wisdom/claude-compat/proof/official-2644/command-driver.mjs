// Focused real-connector proof: two human zero-model commands on one native query.
import fs from 'node:fs/promises';
import path from 'node:path';
export {prepare,captureIdentity} from '../../../../scripts/claude-native-acceptance/driver.mjs';
// Composer and sidebar consume separate upstream projections. One shared budget,
// not a sleep or a fresh timeout per indicator; require all original idle states.
export async function waitForCommandIdle(page, timeout=30000) {
 const deadline=performance.now()+timeout;
 const states=[
  [page.getByRole('button',{name:'Stop generation',exact:true}),'hidden'],
  [page.getByRole('button',{name:'Submit message',exact:true}),'visible'],
  [page.getByText('Working',{exact:true}),'hidden'],
 ];
 for(;;) {
  for(const [locator,state] of states) {
   const remaining=deadline-performance.now();
   if(remaining<=0)throw Error('Command UI did not converge to idle within '+timeout+'ms');
   await locator.waitFor({state,timeout:remaining});
  }
  const visible=await Promise.all(states.map(([locator])=>locator.isVisible()));
  if(visible.every((value,i)=>value===(states[i][1]==='visible')))return;
 }
}
export async function exercise({page,snapshot,config}) {
 const message=page.getByRole('textbox',{name:'Message',exact:true});
 await message.waitFor();
 await page.locator('[data-chat-provider-model-picker="true"]').first().click();
 await page.getByText('Local deterministic acceptance (not Claude)',{exact:true}).last().click();
 for(let n=1;n<=2;n++) {
  await message.fill('/bruv status');
  await page.getByRole('button',{name:'Submit message',exact:true}).click();
  for(let i=0;i<300;i++) {
   const rows=(await fs.readFile(config.wire,'utf8')).trim().split('\n').map(JSON.parse);
   const inputs=rows.filter(r=>r.kind==='stdin'&&r.value.type==='user'&&r.value.message?.content==='/bruv status');
   const input=inputs[n-1]?.value;
   if(input&&rows.some(r=>r.kind==='stdout'&&r.value.type==='result'&&r.value.user_message_uuid===input.uuid))break;
   if(i===299)throw Error('No actual correlated command result');
   await new Promise(r=>setTimeout(r,100));
  }
  await waitForCommandIdle(page);
  await snapshot('command-'+n+'-idle');
 }
}
export async function verify({proof,t3Version,t3BinarySha256}) {
 await fs.writeFile(path.join(proof,'result.json'),JSON.stringify({focusedCommandProof:true,passed:true,t3Version,t3BinarySha256},null,2));
}
