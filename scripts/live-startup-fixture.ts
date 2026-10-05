import { VoiceSession } from "../src/live/session";
import type { LiveAdapter } from "../src/live/types";

export const startupPhrase = "Please repeat these words: amber river seven lighthouse.";
const words = ["amber", "river", "seven", "lighthouse"];
export const trailingSilenceMs = 1200;

/** Greedy independent token checks: a missing word does not hide later flags. */
/** Mark expected words found in order, allowing unrelated words between them. */
function orderedTokenFlags(tokens: string[], expected: string[]) {
  let position = 0;
  return expected.map((word) => {
    const at = tokens.indexOf(word, position);
    if (at < 0) return false;
    position = at + 1;
    return true;
  });
}

/** Fixed flags/counts only; never return or log the provider's transcript. */
/** Count expected phrase words retained in transcript order, case-insensitively. */
export function startupWordCounts(transcript: string) {
  const tokens = transcript
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/);
  const expectedTokenFlags = words.map((word) => tokens.includes(word));
  const expectedTokenOrder = orderedTokenFlags(tokens, words);
  return {
    retainedWords: expectedTokenOrder.every(Boolean),
    matchedWordCount: expectedTokenFlags.filter(Boolean).length,
    expectedTokenFlags,
    expectedTokenOrder,
    numeric7: tokens.includes("7"),
    numeric7Order: orderedTokenFlags(tokens, ["amber", "river", "7", "lighthouse"]).every(Boolean),
  };
}

/** Run a local fixture tool with piped output and a fixed deadline; reject nonzero exits. */
export async function fixtureCommand(args: string[], input?: Uint8Array): Promise<Buffer> {
  const child = Bun.spawn(args, { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  if (input) child.stdin.write(input);
  child.stdin.end();
  const timeout = setTimeout(() => child.kill(), 4000);
  try {
    const [output, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), child.exited]);
    if (code !== 0) throw new Error("fixture_conversion_failed");
    return Buffer.from(output);
  } finally {
    clearTimeout(timeout);
    child.kill();
  }
}

/** Summarize mono PCM16LE levels and sample counts; reject empty or odd-byte input. */
export function pcmCounts(pcm: Buffer, rate: number) {
  if (!pcm.length || pcm.length % 2) throw new Error("fixture_invalid_pcm");
  let peak = 0,
    nonzeroSamples = 0,
    clippedSamples = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const value = pcm.readInt16LE(i);
    peak = Math.max(peak, Math.abs(value));
    if (value) nonzeroSamples++;
    if (value === -32768 || value === 32767) clippedSamples++;
  }
  return { rate, channels: 1, pcmBytes: pcm.length, samples: pcm.length / 2, peak, nonzeroSamples, clippedSamples };
}

/** ffmpeg's band-limited conversion, explicit mono signed PCM16LE; pipes only. */
export async function naturalFixturePcm(pcm24: Buffer) {
  if (!pcm24.length || pcm24.length % 2 || pcm24.length > 480_000) throw new Error("fixture_invalid_pcm24");
  const speech = await fixtureCommand(
    [
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      "16000",
      "pipe:1",
    ],
    pcm24,
  );
  const pcm = Buffer.concat([speech, Buffer.alloc(32 * trailingSilenceMs)]);
  if (
    !pcmCounts(speech, 16000).nonzeroSamples ||
    pcm.length > 320_000 ||
    Math.abs(speech.length / 32 - pcm24.length / 48) > 1
  )
    throw new Error("fixture_invalid_pcm16");
  return pcm;
}

/** One bounded Live response to text. Audio and transcripts stay in this process. */
export async function generateNaturalFixture(key: string, adapter?: LiveAdapter) {
  const chunks: Buffer[] = [];
  let bytes = 0,
    transcript = "",
    error: string | undefined;
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const session = new VoiceSession(
    {
      onAudio: (base64) => {
        const chunk = Buffer.from(base64, "base64");
        bytes += chunk.length;
        if (bytes > 480_000) {
          error = "fixture_audio_limit";
          session.close();
          finish();
        } else chunks.push(chunk);
      },
      onOutputTranscript: (t) => {
        transcript = t.replace ? t.text : transcript + t.text;
      },
      onTurnComplete: finish,
      onError: (e) => {
        error = e.code;
        finish();
      },
    },
    adapter,
    {
      instructions:
        "Read the supplied text aloud exactly once in a natural conversational voice. No introduction, commentary or tools.",
      tools: [],
      execute: async () => ({ status: "denied" }),
    },
  );
  const start = Date.now();
  const timer = setTimeout(() => {
    error = "fixture_deadline";
    session.close();
    finish();
  }, 34_000);
  try {
    await session.connect(key);
    if (session.state !== "ready") throw new Error(error ?? "fixture_setup_failed");
    session.sendContext(startupPhrase, { triggerResponse: true });
    await completed;
    if (error) throw new Error(error);
    const counts = startupWordCounts(transcript);
    if (!counts.retainedWords || !bytes) throw new Error("fixture_incomplete_response");
    return { pcm24: Buffer.concat(chunks), model: session.model, elapsedMs: Date.now() - start, ...counts };
  } finally {
    clearTimeout(timer);
    session.close();
  }
}
