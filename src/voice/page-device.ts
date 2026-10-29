import { WebSocket } from "ws";
import type { Device, DeviceEvent } from "./call";

/**
 * A browser page as a call's speaker: events go as JSON, audio as raw 16-bit PCM. The sample rate and the
 * sentence number go only when they change, so each chunk of audio costs its bytes and nothing more.
 * `wanted` leaves out events the page has no use for.
 */
export function pageDevice(ws: WebSocket, wanted: (event: DeviceEvent) => boolean = () => true): Device {
  let rate = 0;
  let part = 0;
  return {
    screen: true,
    send: (event) => {
      if (ws.readyState === WebSocket.OPEN && wanted(event)) ws.send(JSON.stringify(event));
    },
    play: (pcm, sampleRate, sentence) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (sampleRate !== rate) {
        rate = sampleRate;
        ws.send(JSON.stringify({ type: "rate", rate }));
      }
      if (sentence !== part) {
        part = sentence;
        ws.send(JSON.stringify({ type: "part", part }));
      }
      ws.send(pcm);
    },
  };
}

/** Microphone audio from a page, copied onto its own buffer so it can move to the engine's thread. */
export function pcmFrom(data: Buffer | ArrayBuffer | Buffer[]) {
  const bytes = Buffer.isBuffer(data)
    ? data
    : Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.from(data as ArrayBuffer);
  const pcm = new Int16Array(bytes.length >> 1);
  new Uint8Array(pcm.buffer).set(bytes.subarray(0, pcm.length * 2));
  return pcm;
}
