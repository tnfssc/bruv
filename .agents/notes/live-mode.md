# Voice (`/voice`, `src/voice/`)

Built 2026-10-17. Replaces the 0.x live mode (tag `v0.16.25`: Google Live and two OpenAI realtime
stacks, a Swift/C audio helper and Pi patches). The rewrite cut it (`rewrite.md` D5) because it never
reached SSH or T3 Code.

## Choices and why

- **A browser page is the microphone and speaker.** This answers the question that sank 0.x: bruv can
  run anywhere the page can reach (locally, over SSH with a forwarded port, behind an https tunnel). The
  browser also cancels echo, so you can talk over a reply played through speakers. `/voice here` uses
  this machine's own devices (pw-record/pw-play, parec/pacat, arecord/aplay or sox) with no echo
  cancelling; use headphones there.
- **Speech to text, the session's model, text to speech; not a speech-to-speech model.** The user wanted
  no subscription for voice. Open full-duplex models (NVIDIA Nemotron VoiceChat 11B, 2026) need an 80 GB
  GPU. A chain lets the brain be the model the user already pays for, with all of bruv's tools.
- **No fine-tuning.** A prompt section (`prompts/voice.md`, added only while voice is on) gets short,
  plain spoken replies. The agent itself is the worker; it says one line before long work.
- **sherpa-onnx (`sherpa-onnx-node`) runs every model in Node, on the CPU, without Python.** Models
  (about 560 MB) are downloaded on first use to `~/.pi/agent/bruv/voice/models` after asking:
  Silero VAD v5, `nemotron-speech-streaming-en-0.6b` int8 with 160 ms chunks, Pocket TTS int8.
  Kokoro (82M) also works but was slower here (0.45 vs 0.3 of real time) and is a 3x larger download.
- **Models run in a worker thread** (`worker.mjs`, plain JS so it needs no TypeScript loader). Decoding
  takes about half a CPU core while someone talks and would stall the terminal on the main thread.

## How interrupting works (`call.ts`)

- The VAD hears speech start (about 0.35 s after the first word; 0.6 s of audio before that is kept for
  the recognizer) → the page pauses playback (`AudioContext.suspend`).
- When the words are final (0.6 s of silence): empty or an echo of what is being said → resume.
  Real words → flush playback, drop queued speech, mute the rest of that reply, and send the words.
- Sending: if a reply was being spoken or streamed, abort the run, wait until Pi is idle, then send a
  new message. Otherwise, if the agent is busy (silent tool work), send it as a steer.
- Speech is made about 3x faster than it plays, so audio already on its way is tagged with a
  generation and dropped after a hush.

## What was tried

- Steering instead of aborting when the user talks over a reply: the model finished a long story first
  (14 s), so the answer came 18 s late.
- A follow-up queued at `agent_end` after an abort is lost; Pi is not idle yet then. Poll `isIdle`.
- `Worker.terminate()` while Pocket TTS is generating aborts the whole process. The worker is asked to
  close and exits once speech stops.

## Measured on the user's laptop (Ryzen 9 7940HS, CPU only, 4 threads)

- Recognizer: 160 ms of audio in under 80 ms; final words 0.55 s after speech ends (mostly the VAD's
  0.6 s silence).
- First audio 0.4–0.7 s after a sentence is queued.
- With gpt-6-astra at low thinking: 4–5 s from the end of a question to the first spoken word, nearly
  all of it the model. Thinking level and model speed matter most now.

## Where work stopped / ideas

- English only. Nemotron 3.5 streaming (40 languages, same size) is in the same sherpa-onnx release.
- A turn model (Pipecat's Smart Turn v3, ONNX, CPU) could replace the fixed 0.6 s silence.
- A small local or fast model could answer at once while the main model works; not needed yet.
- `played` from the page clears echo detection; a gap between sentences can clear it early.
