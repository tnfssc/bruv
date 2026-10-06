import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getDiskBackedEntryMetadata } from "./session-manager";

let installed = false;
/** Count bookkeeping from the owned journal index, not a second body replay. */
export function installSelectorLifecycle(): void {
  if (installed) return;
  installed = true;
  const original = SessionManager.prototype.getEntryCountByType;
  SessionManager.prototype.getEntryCountByType = function (type) {
    const metadata = getDiskBackedEntryMetadata(this);
    if (!metadata) return original.call(this, type);
    let count = 0;
    for (const entry of metadata) if (entry.type === type) count++;
    return count;
  };
}
