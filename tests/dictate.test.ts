import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { registerDictate } from "../src/dictate";
import { sdk } from "./sdk";

// Writes `bytes` of audio, then waits to be stopped like a real recorder.
const recorder = (bytes: number, stderr = "") => ({
  command: "sh",
  args: (file: string) => [
    "-c",
    `trap 'exit 0' INT; printf '${stderr}' >&2; head -c ${bytes} /dev/zero > '${file}.part'; mv '${file}.part' '${file}'; while :; do sleep 0.01; done`,
  ],
});
const claims = { "https://api.openai.com/auth": { chatgpt_account_id: "account-795" } };
const apiKey = `test.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.test`;

async function setup(bytes: number, reply: () => Response, stderr = "") {
  const pasted: string[] = [];
  const notices: string[] = [];
  const sent: { url: string; auth: string | null; size: number }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const file = (init.body as FormData).get("file") as Blob;
    sent.push({ url, auth: new Headers(init.headers).get("Authorization"), size: file.size });
    return reply();
  }) as typeof globalThis.fetch;
  const app = await sdk([(pi) => registerDictate(pi, { recorder: recorder(bytes, stderr), fetch })], {
    pasteToEditor: (text) => {
      pasted.push(text);
    },
    notify: (text) => {
      notices.push(text);
    },
  });
  app.session.extensionRunner.createContext().modelRegistry.registerProvider(app.faux.getModel().provider, { apiKey });
  await app.session.setModel({ ...app.faux.getModel(), id: "codex-dictate", api: "openai-codex-responses" });
  const clips = () => {
    const dir = join(app.session.sessionManager.getSessionDir(), "bruv");
    return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".wav")) : [];
  };
  // Starts dictation and waits for the fake recorder to finish writing.
  const record = async () => {
    await app.session.prompt("/dictate");
    for (let i = 0; i < 200 && !clips().length; i++) await Bun.sleep(10);
  };
  return { ...app, pasted, notices, sent, clips, record };
}

test("dictation records until stopped, sends the clip with the ChatGPT sign-in, and types the text", async () => {
  const app = await setup(32_044, () => Response.json({ text: " fix the footer \n" }));
  try {
    await app.record();
    expect(app.clips()).toHaveLength(1);
    await app.session.prompt("/dictate");
    expect(app.sent).toEqual([
      { url: "https://chatgpt.com/backend-api/transcribe", auth: `Bearer ${apiKey}`, size: 32_044 },
    ]);
    expect(app.pasted).toEqual(["fix the footer"]);
    expect(app.clips()).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("an empty recording or a failed transcription types nothing and says why", async () => {
  const silent = await setup(44, () => Response.json({ text: "never" }), "no default source");
  try {
    await silent.record();
    await silent.session.prompt("/dictate");
    expect(silent.sent).toHaveLength(0);
    expect(silent.notices.at(-1)).toContain("no default source");
  } finally {
    await silent.close();
  }
  const failing = await setup(32_044, () => new Response("", { status: 403 }));
  try {
    await failing.record();
    await failing.session.prompt("/dictate");
    expect(failing.pasted).toHaveLength(0);
    expect(failing.notices.at(-1)).toContain("403");
    expect(failing.clips()).toHaveLength(0);
  } finally {
    await failing.close();
  }
});
