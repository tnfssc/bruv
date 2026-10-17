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

/**
 * This machine's microphone and speaker as a device. Nothing here cancels echo, so without headphones the
 * microphone hears the speaker; PipeWire's echo-cancel module fixes that.
 */
export function startLocal(call: Call): { stop(): void } | string {
  const recorder = recorders.find((tool) => installed(tool.command));
  const player = players.find((tool) => installed(tool(16000).command));
  if (!recorder || !player)
    return "Voice here needs pw-record and pw-play, parec and pacat, arecord and aplay, or sox.";
  let speaker: ChildProcess | undefined;
  let speakerRate = 0;
  let endsAt = 0;
  let timer: NodeJS.Timeout | undefined;
  /** Audio that came in while paused. */
  let held: [Int16Array, number, number][] | undefined;
  const silence = () => {
    speaker?.kill();
    speaker = undefined;
    endsAt = 0;
    clearTimeout(timer);
  };
  const device: Device = {
    send: (event) => {
      // A process can't pause what it has already handed to the sound server, so a pause stops playback
      // and holds what comes next.
      if (event.type === "pause") {
        silence();
        held ??= [];
      } else if (event.type === "flush") {
        silence();
        held = undefined;
      } else if (event.type === "resume" && held) {
        const waiting = held;
        held = undefined;
        for (const [pcm, rate, part] of waiting) device.play(pcm, rate, part);
      }
    },
    play: (pcm, rate, part) => {
      if (held) {
        held.push([pcm, rate, part]);
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
      endsAt = Math.max(endsAt, Date.now()) + (pcm.length / rate) * 1000;
      clearTimeout(timer);
      timer = setTimeout(() => call.played(), endsAt - Date.now());
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
    call.hear(pcm);
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
