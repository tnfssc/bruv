/** Bounded git inventory for human launch approval. This is not a snapshot guard.
 * When truncated, count is a lower bound, never an exact total; callers must
 * offer tracked-only or explicit path selection, not an "approve all" option.
 */
export async function repositoryUntracked(
  root: string,
  byteLimit = 1024 * 1024,
): Promise<{
  paths: string[];
  preview: string[];
  count: number;
  incomplete: boolean;
}> {
  const child = Bun.spawn(["git", "-C", root, "ls-files", "--others", "--exclude-standard", "-z"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let incomplete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.length > byteLimit) {
        chunks.push(value.subarray(0, byteLimit - size));
        incomplete = true;
        child.kill();
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const exit = await child.exited;
  if (!incomplete && exit !== 0) throw Error("Current directory must be a Git repository");
  // A partial final path is not a name that can be approved; still count it as
  // an observed path when reporting the minimum number omitted.
  const bytes = Buffer.concat(chunks);
  const terminated = bytes.length && bytes[bytes.length - 1] === 0;
  const parts = bytes.toString("utf8").split("\0");
  const paths = parts.slice(0, -1).filter(Boolean);
  const count = paths.length + (incomplete && !terminated ? 1 : 0);
  return {
    paths: incomplete ? [] : paths,
    preview: paths.slice(0, 12).map((path) => (path.length > 160 ? `${path.slice(0, 160)}…` : path)),
    count,
    incomplete,
  };
}
