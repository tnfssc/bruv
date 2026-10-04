const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ??
    (process.env.BRUV_PARENT_REPO ?? "/home/tnfssc/Code/bruv") +
      "/.cache/acp-t3-upstream-experience/runtime/node_modules/playwright/index.mjs"
);
import fs from "node:fs";
const root = new URL(".", import.meta.url).pathname;
const events = root + "browser-events.ndjson";
const record = (type, data) =>
  fs.appendFileSync(events, JSON.stringify({ time: new Date().toISOString(), type, ...data }) + "\n");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_BIN ?? "/home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await context.newPage();
page.on("pageerror", (e) => record("pageerror", { message: e.message, stack: e.stack }));
page.on("websocket", (ws) => {
  ws.on("framereceived", (e) => {
    const p = String(e.payload);
    const markers = [
      "EXECUTE_FINISHED_FILTERED",
      "EXECUTE_REAL_BRUV_PROOF_FILTERED",
      "JOB_STARTED_RETURNING_EARLY_FILTERED",
      "AUTOMATIC_LATE_COMPLETION_OBSERVED_FILTERED",
      "CONCURRENT_FOLLOWUP_COMPLETE_FILTERED",
    ].filter((m) => p.includes(m));
    if (markers.length) record("ws-marker", { markers });
  });
});
const log = fs.readFileSync(root + "server-private.log", "utf8");
const match = log.match(
  new RegExp("http://127[.]0[.]0[.]1:" + String(process.env.PROOF_PORT ?? 18783) + "/pair[^\\s]*"),
);
if (!match) throw Error("Pair URL not found");
await page.goto(match[0]);
await page.waitForTimeout(4000);
// Pairing/setup state is private; exclude it from selected evidence.
fs.writeFileSync(root + "browser-ready", "ready");
const steps = [
  "await page.getByRole('button',{name:'Open provider settings',exact:true}).click();await page.getByRole('button',{name:'Add provider',exact:true}).click();await page.waitForTimeout(4500);",
  "await page.getByRole('button',{name:'Enter manually',exact:true}).click();await page.getByLabel('Registry agent ID',{exact:true}).fill('pi-acp');await page.getByLabel('Executable override',{exact:true}).fill(root+'../source/dist/index.js');await page.getByRole('button',{name:'Next',exact:true}).click();await page.waitForTimeout(1000);await page.getByLabel('Label',{exact:true}).fill('Bruv pi-acp fork — ADAPTER-ONLY PROTOTYPE');await page.getByLabel('Instance ID',{exact:true}).fill('bruv-adapter-only-prototype');await page.getByRole('button',{name:'Continue to sign-in',exact:true}).click();await page.waitForTimeout(5000);",
  "await page.getByRole('button',{name:'Skip for now',exact:true}).click();",
  "await page.goto('http://127.0.0.1:18783/');await page.waitForTimeout(1200);const fs=await import('node:fs');fs.writeFileSync(root+'conversation-controls.json',JSON.stringify(await page.getByRole('button').evaluateAll(es=>es.map(e=>({text:e.innerText,label:e.getAttribute('aria-label'),title:e.getAttribute('title')}))),null,2));",
  "await page.getByRole('button',{name:'New thread',exact:true}).click();await page.waitForTimeout(800);",
  "await page.getByRole('button',{name:'gpt-6-astra',exact:true}).click();await page.waitForTimeout(250);",
  "const fs=await import('node:fs');fs.writeFileSync(root+'model-menu-controls.json',JSON.stringify(await page.locator('button,input,[role=option]').evaluateAll(es=>es.map(e=>({tag:e.tagName,role:e.getAttribute('role'),text:e.innerText,label:e.getAttribute('aria-label'),title:e.getAttribute('title'),placeholder:e.getAttribute('placeholder')}))),null,2));",
  "await page.getByRole('button',{name:'Bruv pi-acp fork — ADAPTER-ONLY PROTOTYPE',exact:true}).click();await page.waitForTimeout(250);",
  "await page.getByRole('option',{name:/Bridge research fixture/}).click({timeout:5000});await page.getByRole('textbox',{name:'Message',exact:true}).fill('LATE_PROBE: launch the bounded shell job and return early');await page.getByRole('textbox',{name:'Message',exact:true}).press('Enter');await page.waitForTimeout(6000);",
  "await page.getByRole('textbox',{name:'Message',exact:true}).fill('CONCURRENT_PROBE: follow-up while Bruv shell job is live');await page.getByRole('textbox',{name:'Message',exact:true}).press('Enter');await page.waitForTimeout(500);await page.getByRole('button',{name:'Steer',exact:true}).last().click();await page.waitForTimeout(3000);",
  "await page.waitForTimeout(20000);",
  "await page.reload();await page.waitForTimeout(1500);",
  "await page.getByRole('button',{name:'New thread',exact:true}).click();await page.waitForTimeout(500);const fs=await import('node:fs');const before=Date.now();await page.getByRole('textbox',{name:'Message',exact:true}).fill('STOP_PROBE: bounded foreground-only Stop proof');await page.getByRole('textbox',{name:'Message',exact:true}).press('Enter');const deadline=Date.now()+30000;while(Date.now()<deadline){const rows=fs.readFileSync(root+'rpc-metadata.ndjson','utf8').trim().split('\\n').map(x=>JSON.parse(x));if(rows.some(r=>r.time>before&&r.type==='bruv_task_event'&&r.event==='started'))break;await page.waitForTimeout(200);}await page.waitForTimeout(1000);",
  "await page.getByRole('button',{name:'Stop generation',exact:true}).click();await page.waitForTimeout(1200);",
  "await page.waitForTimeout(14000);",
  "await page.reload();await page.waitForTimeout(1200);const fs=await import('node:fs');fs.writeFileSync(root+'browser-stop','done');",
];
for (let i = 0; i < steps.length; i++) {
  const code = steps[i]
    .replaceAll("18783", String(process.env.PROOF_PORT ?? 18783))
    .replace("root+'../source/dist/index.js'", JSON.stringify(process.env.PROOF_ADAPTER));
  await new Function("page", "root", "return(async()=>{" + code + "})()")(page, root);
  if (i === 8 && !(await page.locator("body").innerText()).includes("Working"))
    throw Error("Expected Working during background job");
  if (i === 10 || i === 11) {
    const body = await page.locator("body").innerText();
    if (
      !body.includes("AUTOMATIC_LATE_COMPLETION_OBSERVED_FILTERED") ||
      !body.includes("CONCURRENT_FOLLOWUP_COMPLETE_FILTERED")
    )
      throw Error("Late output or followup missing");
  }
  if (i >= 8) {
    fs.writeFileSync(
      root + String(i + 1).padStart(2, "0") + "-result.json",
      JSON.stringify({ url: page.url(), body: await page.locator("body").innerText() }, null, 2),
    );
    await page.screenshot({ path: root + String(i + 1).padStart(2, "0") + "-screenshot.png" });
  }
}
await browser.close();
