import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Preserve the complete result for the ordinary execute reader. The voice wire gets a
 * bounded preview and a concrete artifact path, never an invented empty result. */
export async function voiceToolResult(result: unknown, artifactDirectory?: string): Promise<Record<string, unknown>> {
  let serialized: string;
  try {
    serialized = JSON.stringify({ output: result ?? null });
  } catch {
    return { error: "Could not serialize tool result." };
  }
  const bytes = Buffer.byteLength(serialized);
  // Function responses are JSON, not a visual modality: do not suggest that the
  // model actually saw inline image content. Keep bytes available to execute.
  const hasImage =
    typeof result === "object" &&
    result !== null &&
    Array.isArray((result as { content?: unknown }).content) &&
    (result as { content: unknown[] }).content.some(
      (block) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "image",
    );
  if (bytes <= 64 * 1024 && !hasImage) return { output: result ?? null };
  try {
    if (artifactDirectory) await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(artifactDirectory ?? tmpdir(), "bruv-live-tool-"));
    const path = join(directory, "result.json");
    await writeFile(path, serialized, { mode: 0o600 });
    return {
      truncated: bytes > 64 * 1024,
      imageNotVisuallyRendered: !!hasImage,
      bytes,
      preview: serialized.slice(0, 8192),
      artifactPath: path,
      note: "Full JSON result: artifactPath. Read with execute. Preview may end mid-value. Image bytes stay in the file; JSON output does not show images.",
    };
  } catch {
    return { error: "Could not deliver or save tool result.", bytes };
  }
}
