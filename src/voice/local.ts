import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import type { Call, Device } from "./call";

type Tool = { command: string; args: string[] };

/** Recorders that write raw 16 kHz 16-bit mono audio to stdout, best first. sox is the one for macOS. */
const recorders: Tool[] = [
  { command: "pw-record", args: ["--raw", "--rate", "16000", "--channels", "1", "--format", "s16", "-"] },
  { command: "parec", args: ["--raw", "--rate=16000", "--channels=1", "--format=s16le", "--latency-msec=20"] },
  { command: "arecord", args: ["-q", "-t", "raw", "-f", "S16_LE", "-r", "16000", "-c", "1"] },
  {
    command: "sox",
    args: ["-q", "-d", "-t", "raw", "-r", "16000", "-b", "16", "-e", "signed-integer", "-c", "1", "-"],
  },
];

/** Players that read raw 16-bit mono audio from stdin. */
const players: ((rate: number) => Tool)[] = [
  (rate) => ({ command: "pw-play", args: ["--raw", "--rate", `${rate}`, "--channels", "1", "--format", "s16", "-"] }),
  (rate) => ({ command: "pacat", args: ["--raw", `--rate=${rate}`, "--channels=1", "--format=s16le"] }),
  (rate) => ({ command: "aplay", args: ["-q", "-t", "raw", "-f", "S16_LE", "-r", `${rate}`, "-c", "1"] }),
  (rate) => ({
    command: "sox",
    args: ["-q", "-t", "raw", "-r", `${rate}`, "-b", "16", "-e", "signed-integer", "-c", "1", "-", "-d"],
  }),
];

const installed = (command: string) => spawnSync("which", [command], { stdio: "ignore" }).status === 0;
const missing = "Voice here needs pw-record and pw-play, parec and pacat, arecord and aplay, or sox.";

/** Why this machine can't record and play audio, or undefined when it can. Cheap, so it runs before the models load. */
export function audioMissing() {
  const ready =
    recorders.some((tool) => installed(tool.command)) && players.some((tool) => installed(tool(16000).command));
  return ready ? undefined : missing;
}

/**
 * This machine's microphone and speaker as a device. Nothing here cancels echo, so without headphones the
 * microphone hears the speaker; PipeWire's echo-cancel module fixes that.
 */
export function startLocal(call: Call): { stop(): void } | string {
  const recorder = recorders.find((tool) => installed(tool.command));
  const player = players.find((tool) => installed(tool(16000).command));
  if (!recorder || !player) return missing;
  let speaker: ChildProcess | undefined;
  let speakerRate = 0;
  /** Audio handed to the speaker and when it plays, kept until it has played so a pause can go back. */
  let queue: { pcm: Int16Array; rate: number; part: number; ends: number }[] = [];
  let timer: NodeJS.Timeout | undefined;
  /** Audio held while paused, from the start of the sentence that was playing. */
  let held: { pcm: Int16Array; rate: number; part: number }[] | undefined;
  const silence = () => {
    speaker?.kill();
    speaker = undefined;
    queue = [];
    clearTimeout(timer);
  };
  /** Reports each sentence once all its audio has played. */
  const tick = () => {
    const now = Date.now();
    const playing = queue.find((chunk) => chunk.ends > now);
    const last = queue.at(-1)?.part ?? 0;
    queue = playing ? queue.filter((chunk) => chunk.part >= playing.part) : [];
    call.played(playing ? playing.part - 1 : last, device);
    if (playing) timer = setTimeout(tick, playing.ends - now);
  };
  const device: Device = {
    send: (event) => {
      // A process can't pause what it has already handed to the sound server, so a pause stops playback
      // and keeps what wasn't heard, from the start of the sentence that was playing. A pause from the
      // microphone alone is ignored: nothing here cancels echo, so it is mostly the speaker heard back,
      // and restarting the sentence each time looped it forever. Real words still flush it.
      if (event.type === "pause" && event.soft) return;
      if (event.type === "pause") {
        const now = Date.now();
        const playing = queue.find((chunk) => chunk.ends > now);
        const rest = playing ? queue.filter((chunk) => chunk.part >= playing.part) : [];
        silence();
        held = [...(held ?? []), ...rest];
      } else if (event.type === "flush") {
        silence();
        held = undefined;
      } else if (event.type === "resume" && held) {
        const waiting = held;
        held = undefined;
        for (const chunk of waiting) device.play(chunk.pcm, chunk.rate, chunk.part);
      }
    },
    play: (pcm, rate, part) => {
      if (held) {
        held.push({ pcm, rate, part });
        return;
      }
      if (!speaker || speakerRate !== rate) {
        silence();
        const tool = player(rate);
        speaker = spawn(tool.command, tool.args, { stdio: ["pipe", "ignore", "ignore"] });
        speaker.stdin?.on("error", () => {});
        speakerRate = rate;
      }
      speaker.stdin?.write(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      const starts = Math.max(queue.at(-1)?.ends ?? 0, Date.now());
      queue.push({ pcm, rate, part, ends: starts + (pcm.length / rate) * 1000 });
      clearTimeout(timer);
      tick();
    },
  };
  const microphone = spawn(recorder.command, recorder.args, { stdio: ["ignore", "pipe", "ignore"] });
  let odd: Buffer | undefined;
  microphone.stdout?.on("data", (chunk: Buffer) => {
    const bytes = odd ? Buffer.concat([odd, chunk]) : chunk;
    const whole = bytes.length & ~1;
    odd = whole < bytes.length ? bytes.subarray(whole) : undefined;
    const pcm = new Int16Array(whole >> 1);
    new Uint8Array(pcm.buffer).set(bytes.subarray(0, whole));
    call.hear(pcm, device);
  });
  call.attach(device);
  return {
    stop: () => {
      call.detach(device);
      microphone.kill();
      silence();
    },
  };
}
