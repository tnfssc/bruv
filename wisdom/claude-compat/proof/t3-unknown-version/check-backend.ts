// Run with Bun. Fetch pinned T3 source; test extracted, unchanged pure functions.
// No T3 settings, installed binaries, providers, or updater are invoked.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sha='cfa4f765ec05950a032b6c1cf9cdfff0c2391545';
const base=`https://raw.githubusercontent.com/pingdotgg/t3code/${sha}/`;
const files={
  semver:'packages/shared/src/semver.ts',
  snapshot:'apps/server/src/provider/providerSnapshot.ts',
  maintenance:'apps/server/src/provider/providerMaintenance.ts',
  notification:'apps/web/src/components/ProviderUpdateLaunchNotification.logic.ts',
  catalog:'apps/server/src/provider/ClaudeModelCatalog.ts',
  compatibility:'apps/server/src/provider/providerCompatibility.ts',
};
const sources:Record<string,string>={};
for(const [name,path] of Object.entries(files)) {
 const r=await fetch(base+path);if(!r.ok)throw Error(`${path}: HTTP ${r.status}`);
 sources[name]=await r.text();
}
function part(name:string,start:string,end:string) {
 const s=sources[name]; const a=s.indexOf(start),b=s.indexOf(end,a+start.length);
 if(a<0||b<0)throw Error(`${name}: missing source anchors`);return s.slice(a,b);
}
const code=[
 "import assert from 'node:assert/strict';",
 sources.semver,
 part('snapshot','export function parseGenericCliVersion','/**'),
 "const PROVIDER_UPDATE_ACTION_TOAST_MESSAGE='Install the update now or review provider settings.';",
 part('maintenance','function deriveVersionAdvisory','export function createProviderVersionAdvisory'),
 part('notification','export function isProviderUpdateCandidate','export function isProviderUpdateActive'),
 part('notification','export function isProviderSettingsUpdateCandidate','export function hasOneClickUpdateProviderCandidate'),
 part('catalog','function isVersionSupported','export function resolveClaudeCatalogEffort'),
 part('compatibility','export function resolveProviderCompatibility','/**'),
 "const results=[];\nfor(const text of ['2.1.280 (Bruv compatibility; bruv 0.16.13)','bruv-claude-compat 0.16.13','Bruv connector']) {\n const version=parseGenericCliVersion(text);\n const advisory=deriveVersionAdvisory({currentVersion:version,latestVersion:'2.1.999'});\n const provider={enabled:true,versionAdvisory:{...advisory,latestVersion:version?'2.1.999':null,canUpdate:true,updateCommand:'bruv-claude-compat update'}};\n const popup=isProviderUpdateCandidate(provider);const settingsUpdate=isProviderSettingsUpdateCandidate(provider);\n assert.equal(popup,version!==null);assert.equal(settingsUpdate,version!==null);\n results.push({output:text,parsedVersion:version,advisoryStatus:advisory.status,popup,settingsUpdate});\n}\nassert.equal(parseGenericCliVersion('Bruv connector'),null);\nconst compat=resolveProviderCompatibility([{driver:'claudeAgent',t3CodeRange:'>=0.0.0',ranges:[{range:'>=2.1.280',status:'supported'}]}],'claudeAgent',null,'0.0.46');assert.equal(compat?.status,'unknown');assert.equal(compat?.message,null);\nconst modelCatalog={models:[{model:{slug:'sonnet',name:'Sonnet'},compatibility:{minVersion:'2.1.284'}},{model:{slug:'ungated',name:'Ungated'},compatibility:{}}]};\nconst models=resolveClaudeModelsForVersion(modelCatalog,null);assert.deepEqual(models.map(x=>x.slug),['ungated']);\nconst warning=formatClaudeVersionUpgradeMessage(modelCatalog,null);assert.match(warning,/too old/);\nconsole.log(JSON.stringify({results,compatibility:compat,remainingModels:models.map(x=>x.slug),separateModelWarning:warning},null,2));\nconsole.log('11 assertions passed against extracted unchanged pinned T3 functions.');",
].join('\n');
const dir=await mkdtemp(join(tmpdir(),'t3-unknown-version-'));
try {
 const path=join(dir,'check.ts');await writeFile(path,code);
 const child=Bun.spawn([process.execPath,path],{stdout:'inherit',stderr:'inherit'});
 const result=await child.exited;if(result!==0)throw Error(`Probe exited ${result}`);
} finally {await rm(dir,{recursive:true,force:true});}
