# Voice (`/voice`, `src/voice/`)

Built 2026-10-17. Replaces the 0.x live mode (tag `v0.16.25`: Google Live and two OpenAI realtime
stacks, a Swift/C audio helper and Pi patches). The rewrite cut it (`rewrite.md` D5) because it never
reached SSH or T3 Code.

## Choices and why

- **`/voice` is the terminal; `/voice web` adds a browser page.** `/voice` uses this machine's own
  devices (pw-record/pw-play, parec/pacat, arecord/aplay or sox) with no echo cancelling, so use
  headphones; `/voice` again stops. The page server starts only for `/voice web` or `/voice tunnel`, in
  the same session and the same call. The page answers the question that sank 0.x: bruv can run
  anywhere the page can reach (locally, over SSH with a forwarded port, behind an https tunnel), and the
  browser cancels echo, so you can talk over a reply played through speakers. The page came first and
  was the default; the user wanted `/voice` to mean the terminal.
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

- **The page follows shadcn/ui (zinc tokens, new-york components) and uses Lucide icons**, ported by hand to
  plain CSS and inline SVG. The page is one file served from memory; a build step or a CDN would cost more
  than the few components it needs. Mobile first: safe areas, a screen wake lock. On touch screens
  (`pointer: coarse`) mute and stop are wide buttons and the talk button is a pad; with big controls the
  pad and buttons fill the bottom half. Little text: the state badge, icons, one line when empty. The
  keys sit in a ⋯ menu (a `<dialog>`). No pills or bubbles: the state is plain text with a dot, your words are
  plain grey text, and there are no borders anywhere. Mute, stop and the menu are ghost buttons;
  the talk button is the only filled one, and on phones its fill deepens with the voice level. Nothing moves the layout: no slide-in or press scaling,
  the status has a fixed width with the dot pinned, the heard line becomes the final line in place, and
  the transcript only follows new words when it is already at the end. Checked with Chromium's
  `layout-shift` entries.
- **One button, two ways to talk.** The button starts a held turn the moment it goes down (`talk` to
  the worker, which skips the VAD while held). Letting go after 280 ms ends the turn, after a 0.3 s tail
  because the last word often ends after the finger lifts; the words are final about 0.5 s after
  release. Letting go sooner is a tap, which turns hands-free on or off. Turning it on sends `talk` off
  with `keep`: the worker keeps the turn's stream and gives the VAD 1.2 s to hear speech, so words said
  during the tap are kept and silence ends the turn as usual. A held turn is never taken for echo. A
  separate mode switch came first; one gesture is simpler and nothing has to be chosen.
- **Big or small controls.** On phones the controls take the bottom half of the screen, or one row of
  76 px after the arrow button; the choice is kept in localStorage. The ⋯ menu only lists keys, so it
  is hidden on touch screens.
- **Optimistic start.** The page connects when it loads. The first touch starts at once: both
  AudioContexts are made inside the tap (Safari needs that), the button shows the turn, and the
  microphone opens behind it. Anything sent before the socket is open waits in an outbox (up to about
  20 s of audio) and goes when it opens. A page only takes the microphone when it starts (`mic`), so
  opening the page on a phone doesn't steal it from another. A drop shows only after 2 s.
- **`show` puts things on the page.** One tool (`exposure: "codemode"`), switched on with
  `setActiveTools` while voice is on and off again after, as `apply_patch` is. That costs one uncached
  request when voice starts. `deferred` was tried first, to keep the tool list still: in a real run the
  model looked for the tool, didn't find it, and opened a page in the desktop browser instead. html goes inline
  into a sandboxed `srcdoc` iframe (scripts, no same origin, no referrer, so it never sees the key);
  files are served at `/shown/<random id>` with byte ranges (Safari video needs them) and a sandbox CSP.
  Shown things start in a fixed 16rem box and take their own height only while they are last in the
  conversation, so nothing above or below moves. They are capped to the visible part of the conversation, so each can be
  seen whole with its title bar. Your own words bring the conversation back to the end.
- **`show` in the terminal.** The newest shown thing sits in a widget above the input, so it works however
  the tool was called (directly or from a codemode script) and never goes to the model. Pictures are
  drawn with Pi's `Image` (Kitty protocol; Pi's full-screen view turns iTerm2 pictures off, since it
  can't place them), a video gets its first frame from ffmpeg when
  installed, and pages, videos and pictures get an OSC 8 link. With the page server running, links go
  through it (`/shown/<id>`, the tunnel's address when there is one), so they work over SSH and from
  other machines, and pages keep the sandbox (`CSP: sandbox allow-scripts`). Without it they are
  `file://` links on this machine; an inline page is saved under `bruv/voice/shown/`, which is deleted
  when voice stops. Rendering a page to a picture would need a headless browser,
  too heavy to ship. The tool result says where it went (`shownOn`), so the agent can say where to look.
- **One microphone at a time.** The call takes audio from one device: whichever is heard first, until a
  page claims it by starting or by its button being pressed; when that page goes, the terminal's
  microphone takes over again. Without this, `/voice` plus `/voice web` fed both microphones into one
  stream and garbled both.
- **The model is told where voice is.** The voice section of the prompt ends with a line saying whether
  the user is at the terminal, on the page, or both, and the tunnel's host. It changes only when the user
  turns parts on or off, so the cache holds in between. On and off need no message: the section comes
  and goes. Messages in the conversation on each change were considered and left out as noise.
- **Brand.** The header uses the wordmark and the favicon the b from `site/assets/brand`, drawn in
  `currentColor` so they follow light and dark.
- **Terminal demo.** `.tmp/tv/` (not kept) runs bruv in a pseudo-terminal (`script`) shown in xterm.js,
  with stand-in `pw-record` and `pw-play` first on PATH: the recorder says WAV files named in a queue file,
  the player "plays" in real time into one speaker track and drops what it hasn't played when killed, as
  a speaker would. bruv's own audio code runs unchanged. xterm.js can't keep Kitty pictures through Pi's
  full-screen redraws (its add-on frees a picture's data on delete-all and binds pictures to cells), and
  Xvfb is broken on this machine, so the video shows the placeholder and link a terminal without
  pictures shows.
- **Demo video.** `.tmp/demo/` (not kept in git) records the real agent over RPC with a virtual
  microphone in the page: TTS-made questions are played into a `MediaStreamDestination` returned by a
  replaced `getUserMedia`, and a `MediaRecorder` takes the microphone and the page's speaker together.
  The agent's long think is cut to a labelled fast-forward with ffmpeg.
- **Mute replays the sentence.** Sentences are numbered (`part`); the server sends `part` before a
  sentence's audio. The page keeps the played audio of the sentence playing, so unmuting starts it again.
  Muting is the page's own; the server still thinks it is speaking. Talking unmutes.
- **`/voice tunnel`: a Cloudflare API token and a host are enough.** It finds the zone (longest suffix the
  token can see), makes or reuses the tunnel `bruv-voice-<host>`, sets its ingress to the local port
  (again on every start, since the port can change), adds a proxied CNAME, and runs `cloudflared` with
  the tunnel's token in `TUNNEL_TOKEN`. A tunnel token from the dashboard is run as it is. It never
  replaces a DNS record it did not make. If cloudflared is missing it asks to download the release binary
  (Linux, macOS).
- **The Cloudflare key is in Pi's `auth.json`** as `cloudflare-tunnel`, which `/logout` lists. Pi exports
  no writer, so `keys.ts` takes Pi's lock (proper-lockfile's `auth.json.lock` folder) and writes it.

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

- Not tried with a real Cloudflare account: the API calls were checked against Cloudflare's docs and a fake
  API in the tests only. A bad tunnel token makes cloudflared give up after about 20 s.
- Cloud speech, so the page or an app could work without this machine's models: researched 2026-10-17, not
  built. Deepgram Flux (speech to text with end-of-turn, $0.39/hr) and Aura-2 (speech, $30 per 1M
  characters) share one short-lived browser token; AssemblyAI Universal-Streaming ($0.15/hr) and Inworld
  TTS-1.5 Mini ($5 per 1M characters, price unclear) are cheaper. The brain would still be bruv.
- The headphone play/pause button could mute through the Media Session API; it needs an `<audio>` element
  playing, not only Web Audio.

- English only. Nemotron 3.5 streaming (40 languages, same size) is in the same sherpa-onnx release.
- A turn model (Pipecat's Smart Turn v3, ONNX, CPU) could replace the fixed 0.6 s silence.
- A small local or fast model could answer at once while the main model works; not needed yet.
- `played` from the page clears echo detection; a gap between sentences can clear it early.
