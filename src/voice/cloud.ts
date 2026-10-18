/**
 * Speech from a model on OpenRouter, Fish Audio's Drama 3 by default: it sounds like a person talking, with
 * the "um"s and the moods the agent writes, where Kokoro reads. A sentence comes back in about a second and
 * plays as it arrives, so the next is usually ready before this one ends.
 */
export const cloudModel = "fish-audio/drama-3";

export interface CloudSpeech {
  speak(text: string, part: number): void;
  hush(): void;
  close(): void;
}

type Options = {
  model: string;
  key: () => Promise<string | undefined>;
  /** Audio for `part`, in order. */
  audio: (pcm: Int16Array, rate: number, part: number) => void;
  /**
   * A sentence couldn't be made, so it and the ones after it are handed back, in order, to be said
   * another way. `stop` when the cloud shouldn't be tried again: no credit, a bad key, a wrong model.
   */
  failed: (rest: { text: string; part: number }[], message: string, stop: boolean) => void;
  fetch?: typeof globalThis.fetch;
};

/**
 * Brings each sentence to one loudness. Drama 3 swings by 10 dB from one sentence to the next, so a quiet
 * one was hard to hear and a loud one came back through the microphone as words. The level is set from the
 * first moments of speech and held for the sentence, so it doesn't pump.
 */
export class Level {
  private held: Int16Array[] = [];
  private length = 0;
  private gain: number | undefined;

  constructor(
    private rate: number,
    /** About Kokoro's level: -23 dBFS. */
    private target = 2300,
  ) {}

  push(pcm: Int16Array): Int16Array[] {
    if (this.gain !== undefined) return [this.apply(pcm)];
    this.held.push(pcm);
    this.length += pcm.length;
    return this.length >= this.rate * 0.4 ? this.end() : [];
  }

  /** What is held, once the sentence ends early. */
  end(): Int16Array[] {
    if (this.gain === undefined) {
      const all = new Int16Array(this.length);
      let at = 0;
      for (const pcm of this.held) {
        all.set(pcm, at);
        at += pcm.length;
      }
      this.gain = this.measure(all);
    }
    const held = this.held.map((pcm) => this.apply(pcm));
    this.held = [];
    return held;
  }

  /** From the loudness of the 20 ms frames with speech in them. */
  private measure(pcm: Int16Array) {
    const size = Math.round(this.rate / 50);
    let sum = 0;
    let count = 0;
    for (let at = 0; at + size <= pcm.length; at += size) {
      let frame = 0;
      for (let i = at; i < at + size; i++) frame += pcm[i] * pcm[i];
      if (frame / size < 180 * 180) continue;
      sum += frame;
      count += size;
    }
    return count ? Math.min(2, Math.max(0.25, this.target / Math.sqrt(sum / count))) : 1;
  }

  private apply(pcm: Int16Array) {
    const gain = this.gain ?? 1;
    const out = new Int16Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * gain)));
    return out;
  }
}

type Job = {
  text: string;
  part: number;
  chunks: Int16Array[];
  rate: number;
  done: boolean;
  stop: AbortController;
};

/**
 * Sends each sentence as soon as it comes and plays them in order: a later one that arrives first waits
 * for the one before it.
 */
export function startCloudSpeech(options: Options): CloudSpeech {
  const fetch = options.fetch ?? globalThis.fetch;
  let jobs: Job[] = [];
  const drop = (dropped: Job[]) => {
    for (const job of dropped) job.stop.abort();
  };
  /** A failure waiting for the sentences before it to finish, with what is to be said another way. */
  let failing: { rest: { text: string; part: number }[]; message: string; stop: boolean } | undefined;

  /** Hands over what is ready, from the front, stopping at a sentence still coming. */
  const drain = () => {
    while (jobs.length) {
      const job = jobs[0];
      for (const pcm of job.chunks.splice(0)) options.audio(pcm, job.rate, job.part);
      if (!job.done) return;
      jobs.shift();
    }
    if (!failing) return;
    const { rest, message, stop } = failing;
    failing = undefined;
    options.failed(rest, message, stop);
  };

  const request = async (job: Job) => {
    const key = await options.key();
    if (!key) throw Object.assign(new Error("No OpenRouter key."), { stop: true });
    return fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: options.model, input: job.text, response_format: "pcm" }),
      signal: job.stop.signal,
    });
  };

  const make = async (job: Job) => {
    const { signal } = job.stop;
    try {
      // One more try when the service has a moment's trouble.
      let response = await request(job);
      if (response.status >= 500 || response.status === 429) response = await request(job);
      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => "");
        let detail = body.slice(0, 200);
        try {
          detail = JSON.parse(body).error?.message ?? detail;
        } catch {}
        // No credit, a bad key or an unknown model won't mend by retrying.
        const stop = [400, 401, 402, 403, 404].includes(response.status);
        throw Object.assign(new Error(`OpenRouter speech failed: ${detail} (${response.status})`), { stop });
      }
      job.rate = Number(/rate=(\d+)/.exec(response.headers.get("content-type") ?? "")?.[1] ?? 44_100);
      const level = new Level(job.rate);
      let odd: Uint8Array | undefined;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        if (signal.aborted) return;
        const bytes = odd ? Buffer.concat([odd, chunk]) : chunk;
        const whole = bytes.length & ~1;
        odd = whole < bytes.length ? bytes.slice(whole) : undefined;
        if (!whole) continue;
        const pcm = new Int16Array(whole >> 1);
        new Uint8Array(pcm.buffer).set(bytes.subarray(0, whole));
        job.chunks.push(...level.push(pcm));
        drain();
      }
      job.chunks.push(...level.end());
    } catch (error) {
      if (signal.aborted || !jobs.includes(job)) return;
      // What already played of it stays, and the sentences before it play on; it and the ones after it are
      // said another way, after those, so the order holds.
      const failed = jobs.slice(jobs.indexOf(job));
      jobs = jobs.slice(0, jobs.indexOf(job));
      drop(failed);
      // A later sentence may have failed first; its handback comes after this one's.
      failing = {
        rest: [...failed.map(({ text, part }) => ({ text, part })), ...(failing?.rest ?? [])],
        message: error instanceof Error ? error.message : String(error),
        stop: (error as { stop?: boolean }).stop === true || failing?.stop === true,
      };
      drain();
      return;
    }
    job.done = true;
    drain();
  };

  return {
    speak: (text, part) => {
      if (failing) {
        failing.rest.push({ text, part });
        return;
      }
      const job: Job = { text, part, chunks: [], rate: 44_100, done: false, stop: new AbortController() };
      jobs.push(job);
      void make(job);
    },
    hush: () => {
      drop(jobs);
      jobs = [];
      failing = undefined;
    },
    close: () => {
      drop(jobs);
      jobs = [];
    },
  };
}
