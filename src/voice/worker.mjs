// Runs the speech models off Pi's main thread: decoding speech takes about half a CPU core while
// someone talks, and would stall the terminal. Plain JavaScript, so the worker needs no TypeScript loader.
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

const sherpa = createRequire(import.meta.url)("sherpa-onnx-node");
const { vad: vadModel, asr, tts: ttsDir, voice, threads } = workerData;
const rate = 16000;
const window = 512;
// Audio kept from before speech is detected; detection lags the first word by about 0.35 s.
const preroll = rate * 0.6;

const post = (event, transfer) => parentPort.postMessage(event, transfer);

const vad = new sherpa.Vad(
  {
    sileroVad: {
      model: vadModel,
      threshold: 0.5,
      minSpeechDuration: 0.25,
      minSilenceDuration: 0.6,
      windowSize: window,
    },
    sampleRate: rate,
    numThreads: 1,
  },
  30,
);
const recognizer = new sherpa.OnlineRecognizer({
  featConfig: { sampleRate: rate, featureDim: 128 },
  modelConfig: {
    transducer: {
      encoder: `${asr}/encoder.int8.onnx`,
      decoder: `${asr}/decoder.int8.onnx`,
      joiner: `${asr}/joiner.int8.onnx`,
    },
    tokens: `${asr}/tokens.txt`,
    numThreads: threads,
    provider: "cpu",
  },
});
const tts = await sherpa.OfflineTts.createAsync({
  model: {
    pocket: {
      lmFlow: `${ttsDir}/lm_flow.int8.onnx`,
      lmMain: `${ttsDir}/lm_main.int8.onnx`,
      encoder: `${ttsDir}/encoder.onnx`,
      decoder: `${ttsDir}/decoder.int8.onnx`,
      textConditioner: `${ttsDir}/text_conditioner.onnx`,
      vocabJson: `${ttsDir}/vocab.json`,
      tokenScoresJson: `${ttsDir}/token_scores.json`,
      voiceEmbeddingCacheCapacity: 4,
    },
    numThreads: threads,
    provider: "cpu",
  },
  maxNumSentences: 1,
});
const reference = sherpa.readWave(voice);

// Listening.
let pending = new Float32Array(0);
let recent = [];
let recentLength = 0;
let stream;
let partial = "";
/** Set while the user holds the talk button: the turn is theirs until they let go, whatever the VAD says. */
let held = false;
/**
 * Frames left for the VAD to hear speech after a tap handed it the turn. A tap starts a turn at once, so
 * words said right away are kept; if none come, the turn ends quietly.
 */
let grace = 0;
const graceFrames = Math.round((rate * 1.2) / window);
/** The words heard when the grace was last given, so it is given again only while they still grow. */
let graceText = "";

function decode() {
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  return recognizer.getResult(stream).text.trim();
}

function hear(pcm) {
  const input = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) input[i] = pcm[i] / 32768;
  const all = new Float32Array(pending.length + input.length);
  all.set(pending);
  all.set(input, pending.length);
  let at = 0;
  for (; at + window <= all.length; at += window) frame(all.slice(at, at + window));
  pending = all.slice(at);
}

function frame(samples) {
  if (held) {
    stream.acceptWaveform({ sampleRate: rate, samples });
    report();
    return;
  }
  vad.acceptWaveform(samples);
  while (!vad.isEmpty()) vad.pop();
  const talking = vad.isDetected();
  if (talking && grace > 0) {
    // The VAD has the tap's turn now; the audio kept in case it never came isn't needed.
    grace = 0;
    forget();
  }
  if (!stream && talking) {
    stream = recognizer.createStream();
    for (const chunk of recent) stream.acceptWaveform({ sampleRate: rate, samples: chunk });
    recent = [];
    recentLength = 0;
    partial = "";
    post({ type: "speech" });
  }
  if (!stream) {
    remember(samples);
    return;
  }
  stream.acceptWaveform({ sampleRate: rate, samples });
  if (talking) report();
  else if (grace > 0) {
    // Speech that starts late in the grace may reach the VAD only after it, so its start is kept too.
    remember(samples);
    grace--;
    report();
    if (grace > 0) return;
    // Words still coming: give the VAD more time. None at all: end quietly, so the turn the VAD may start
    // next begins with the audio just kept rather than losing its first words.
    if (partial && partial !== graceText) {
      graceText = partial;
      grace = graceFrames;
    } else if (!partial) {
      stream = undefined;
      post({ type: "heard", text: "" });
    }
  } else finish();
}

/** Keeps the last `preroll` of audio, so a turn can start a little before the VAD noticed it. */
function remember(samples) {
  recent.push(samples);
  recentLength += samples.length;
  while (recentLength - recent[0].length >= preroll) recentLength -= recent.shift().length;
}

function forget() {
  recent = [];
  recentLength = 0;
}

function report() {
  const text = decode();
  if (text === partial) return;
  partial = text;
  post({ type: "partial", text });
}

function finish(extra) {
  stream.acceptWaveform({ sampleRate: rate, samples: new Float32Array(rate * 0.5) });
  stream.inputFinished();
  const text = decode();
  stream = undefined;
  // Audio kept during a grace belongs to this turn, not the next.
  forget();
  post({ type: "heard", text, ...extra });
}

/**
 * Hold to talk: a turn starts when the button goes down and ends when it comes up. With `keep`, letting go
 * hands the turn to the VAD instead, which ends it at the next silence (a tap that turns on hands-free),
 * and pressing keeps the moment just heard (a hold that began in hands-free).
 */
function talk(on, keep) {
  if (on === held) {
    // Hands-free turned off: a turn the VAD had open ends now, as the microphone stops.
    if (!on && !keep && stream) finish();
    return;
  }
  held = on;
  vad.reset();
  if (!on && keep) {
    grace = graceFrames;
    graceText = partial;
    return;
  }
  if (on) {
    if (!stream) {
      stream = recognizer.createStream();
      if (keep) for (const chunk of recent) stream.acceptWaveform({ sampleRate: rate, samples: chunk });
    }
    recent = [];
    recentLength = 0;
    partial = "";
    post({ type: "speech" });
    return;
  }
  stream.acceptWaveform({ sampleRate: rate, samples: pending });
  pending = new Float32Array(0);
  finish({ held: true });
}

// Speaking.
const queue = [];
/** The speech being made, if any. */
let speaking;
let generation = 0;

function speak(text, part) {
  queue.push({ text, part, generation });
  run();
}

function run() {
  speaking ??= next().finally(() => {
    speaking = undefined;
    // A sentence may have come in between the loop's last check and here.
    if (queue.length) run();
  });
}

async function next() {
  while (queue.length) {
    const job = queue.shift();
    if (job.generation !== generation) continue;
    const config = new sherpa.GenerationConfig({
      referenceAudio: reference.samples,
      referenceSampleRate: reference.sampleRate,
      numSteps: 5,
      extra: { max_reference_audio_len: 12, seed: 42 },
    });
    try {
      await tts.generateAsync({
        text: job.text,
        enableExternalBuffer: false,
        generationConfig: config,
        onProgress: ({ samples }) => {
          if (job.generation !== generation) return 0;
          const pcm = new Int16Array(samples.length);
          for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 32767;
          post({ type: "audio", pcm, rate: tts.sampleRate, part: job.part, generation: job.generation }, [pcm.buffer]);
          return 1;
        },
      });
    } catch (error) {
      post({ type: "error", message: `Speech failed: ${error?.message ?? error}` });
    }
  }
}

parentPort.on("message", (message) => {
  if (message.type === "hear") hear(message.pcm);
  else if (message.type === "speak") speak(message.text, message.part);
  else if (message.type === "talk") talk(message.on, message.keep);
  else if (message.type === "hush" || message.type === "close") {
    generation++;
    queue.length = 0;
  }
  // Ending the thread while speech is being made aborts the whole process, so wait for it to stop.
  if (message.type === "close") void Promise.resolve(speaking).then(() => process.exit(0));
});
post({ type: "ready" });
