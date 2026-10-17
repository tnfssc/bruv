import { Worker } from "node:worker_threads";
import type { Engine, EngineEvent } from "./call";
import type { ModelPaths } from "./models";

/** Runs the speech models in a worker thread. */
export function startEngine(paths: ModelPaths, threads = 4): Engine {
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
  return {
    hear: (pcm) => worker.postMessage({ type: "hear", pcm }, [pcm.buffer as ArrayBuffer]),
    speak: (text) => worker.postMessage({ type: "speak", text }),
    hush: () => {
      generation++;
      worker.postMessage({ type: "hush" });
    },
    onEvent: (listener) => listeners.push(listener),
    close: async () => {
      const exited = new Promise((resolve) => worker.once("exit", resolve));
      worker.postMessage({ type: "close" });
      const late = setTimeout(() => void worker.terminate(), 10_000);
      await exited;
      clearTimeout(late);
    },
  };
}
