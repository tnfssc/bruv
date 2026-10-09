// Actual shell child; release/stop comes from the acceptance harness.
import fs from "node:fs/promises";
import path from "node:path";
const [state, scenario] = process.argv.slice(2);
await fs.writeFile(path.join(state, `${scenario}.started`), String(process.pid));
console.log(`MANAGED_STARTED_${scenario}`);
while (true) {
  try {
    await fs.access(path.join(state, `${scenario}.release`));
    break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
console.log(`MANAGED_DONE_${scenario}`);
await fs.writeFile(path.join(state, `${scenario}.finished`), "done");
