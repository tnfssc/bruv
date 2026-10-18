import { Worker } from "node:worker_threads";
import type { Engine, EngineEvent } from "./call";
import { type CloudSpeech, startCloudSpeech } from "./cloud";
import { Fillers } from "./fillers";
import type { ModelPaths } from "./models";
import { withoutDirections } from "./text";

/** Speech from a model on OpenRouter instead of Kokoro, and where its fillers are kept. */
export type Cloud = { model: string; key: () => Promise<string | undefined>; fillers: string };

/**
 * Runs the speech models in a worker thread. With `cloud`, a model on OpenRouter speaks, and Kokoro only
 * when it fails: for the rest of that reply, or for good when it can't work (no key or no credit).
 */
export function startEngine(paths: ModelPaths, threads = 4, cloud?: Cloud): Engine {
  const listeners: ((event: EngineEvent) => void)[] = [];
  const emit = (event: EngineEvent) => {
    for (const listener of listeners) listener(event);
  };
  const worker = new Worker(new URL("./worker.mjs", import.meta.url), { workerData: { ...paths, threads } });
  // Speech is made about three times faster than it plays, so some is always on its way here. Each hush
  // starts a new generation, and audio from an older one is dropped.
  let generation = 0;
  worker.on("message", (event: EngineEvent & { generation?: number }) => {
    if (event.type === "audio" && event.generation !== generation) return;
    emit(event);
  });
  worker.on("error", (error) =>
    emit({ type: "error", message: `Voice engine failed: ${error instanceof Error ? error.message : String(error)}` }),
  );
  const local = (text: string, part: number) => {
    const plain = withoutDirections(text);
    if (plain) worker.postMessage({ type: "speak", text: plain, part });
  };
  /** Kokoro speaks for the rest of the reply, which ends at a hush or a pause; `stopped` keeps it for good. */
  let fallen = false;
  let last = 0;
  let stopped = !cloud;
  const remote: CloudSpeech | undefined = cloud
    ? startCloudSpeech({
        model: cloud.model,
        key: cloud.key,
        audio: (pcm, rate, part) => emit({ type: "audio", pcm, rate, part }),
        failed: (rest, message, stop) => {
          fallen = true;
          if (stop && !stopped) emit({ type: "error", message: `${message}\nVoice speaks with Kokoro instead.` });
          stopped ||= stop;
          for (const { text, part } of rest) local(text, part);
        },
      })
    : undefined;
  const fillers = cloud ? new Fillers(cloud.fillers, cloud.model, cloud.key) : undefined;
  return {
    filler: (part) => {
      if (fallen || stopped) return undefined;
      const sound = fillers?.pick();
      if (sound) emit({ type: "audio", pcm: sound.pcm, rate: sound.rate, part });
      return sound?.text;
    },
    hear: (pcm) => worker.postMessage({ type: "hear", pcm }, [pcm.buffer as ArrayBuffer]),
    speak: (text, part) => {
      if (Date.now() - last > 3000) fallen = false;
      last = Date.now();
      if (remote && !fallen && !stopped) remote.speak(text, part);
      else local(text, part);
    },
    talk: (on, keep) => worker.postMessage({ type: "talk", on, keep }),
    hush: () => {
      generation++;
      worker.postMessage({ type: "hush" });
      remote?.hush();
      fallen = false;
    },
    onEvent: (listener) => listeners.push(listener),
    close: async () => {
      remote?.close();
      const exited = new Promise((resolve) => worker.once("exit", resolve));
      worker.postMessage({ type: "close" });
      const late = setTimeout(() => void worker.terminate(), 10_000);
      await exited;
      clearTimeout(late);
    },
  };
}
