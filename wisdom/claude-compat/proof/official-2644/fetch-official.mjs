// Fetch only the pinned supported Linux x64 artifact; never install or replace a cache.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const tag='v0.0.46-nightly.20261004.2644';
const expectedArchive='5f9e29cf2712c87736556c99ea580606b399897cb846c2401a434a0d05c4eeca';
const expectedBinary='53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48';
const destination=process.argv[2];
const browserRuntime=process.argv[3];
if(!destination || !browserRuntime) throw Error('Usage: node fetch-official.mjs NEW_CACHE EXISTING_PLAYWRIGHT_RUNTIME');
if(process.platform!=='linux'||process.arch!=='x64')throw Error('This proof pins Linux x64 only');
const cache=path.resolve(destination);
await fs.mkdir(cache); // An existing cache is an error, not permission to overwrite.
const hash=data=>createHash('sha256').update(data).digest('hex');
async function get(url) {
 const r=await fetch(url);if(!r.ok)throw Error(`${url}: ${r.status}`);
 return Buffer.from(await r.arrayBuffer());
}
const releaseBytes=await get(`https://api.github.com/repos/pingdotgg/t3code/releases/tags/${tag}`);
const release=JSON.parse(releaseBytes);
if(release.target_commitish!=='737993303d36e10674c54b95e5bd3826682c99c7'||release.published_at!=='2026-10-04T03:41:53Z')throw Error('Release source/published metadata changed');
const name='t3-0.0.46-nightly.20261004.2644-linux-x64.tar.gz';
const artifact=release.assets.find(a=>a.name===name);
const sums=release.assets.find(a=>a.name==='SHA256SUMS');
if(!artifact||!sums||artifact.digest!==`sha256:${expectedArchive}`)throw Error('Release digest changed');
const checksumBytes=await get(sums.browser_download_url);
if(!checksumBytes.toString().split('\n').includes(`${expectedArchive}  ${name}`))throw Error('Release checksum mismatch');
const archive=await get(artifact.browser_download_url);
if(hash(archive)!==expectedArchive)throw Error('Downloaded archive checksum mismatch');
await fs.writeFile(path.join(cache,'release.json'),releaseBytes);
await fs.writeFile(path.join(cache,'SHA256SUMS'),checksumBytes);
await fs.writeFile(path.join(cache,'platform.tar.gz'),archive);
const platform=path.join(cache,'platform');await fs.mkdir(platform);
execFileSync('/usr/bin/tar',['-xzf',path.join(cache,'platform.tar.gz'),'--strip-components=1','-C',platform]);
if(hash(await fs.readFile(path.join(platform,'t3')))!==expectedBinary)throw Error('Extracted executable mismatch');
// Browser helper modules only; the executable, web assets and SDK are from 2644.
await fs.access(path.join(browserRuntime,'node_modules/playwright/package.json'));
await fs.symlink(path.resolve(browserRuntime),path.join(cache,'runtime'));
console.log(JSON.stringify({cache,tag,archiveSha256:expectedArchive,binarySha256:expectedBinary},null,2));
