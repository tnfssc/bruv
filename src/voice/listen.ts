/**
 * Speech recognition by a model on OpenRouter instead of Nemotron on this machine, so voice can start
 * without the 463 MB recogniser. None of them streams: the words come 1–2 s after each turn ends, and no
 * live words come while the user talks, so a reply is only cut in on when their turn is over.
 */
export type Listen = { model: string; key: () => Promise<string | undefined> };

/** 16 kHz mono 16-bit audio as a WAV file. Some models take only 16 or 24 kHz. */
export function wav(pcm: Int16Array, rate = 16000) {
  const out = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(out.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) out[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  out.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return out;
}

/** The words in one turn of 16 kHz audio. */
export async function transcribe(listen: Listen, pcm: Int16Array, fetch = globalThis.fetch) {
  const key = await listen.key();
  if (!key) throw new Error("Voice can't hear you: there is no OpenRouter key any more.");
  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: listen.model,
      input_audio: { data: Buffer.from(wav(pcm)).toString("base64"), format: "wav" },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const message = /"message":"([^"]*)"/.exec(body)?.[1];
    throw new Error(
      `OpenRouter couldn't transcribe with ${listen.model} (${response.status})${message ? `: ${message}` : ""}`,
    );
  }
  const { text } = (await response.json()) as { text?: string };
  return (text ?? "").trim();
}

/**
 * Turns sent in order and their words given back in the same order, so a short turn that is transcribed
 * first can't overtake the one before it. A failure gives no words, and says why.
 */
export function startListening(
  listen: Listen,
  heard: (text: string, held: boolean) => void,
  failed: (message: string) => void,
  fetch = globalThis.fetch,
) {
  let last: Promise<void> = Promise.resolve();
  return (pcm: Int16Array, held: boolean) => {
    const words = transcribe(listen, pcm, fetch).catch((error: unknown) => {
      failed(error instanceof Error ? error.message : String(error));
      return "";
    });
    last = last.then(async () => heard(await words, held));
  };
}
