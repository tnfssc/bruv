# Voice (`/voice`, `src/voice/`)

Built 2026-10-17. Replaces the 0.x live mode (tag `v0.16.25`: Google Live and two OpenAI realtime
stacks, a Swift/C audio helper and Pi patches). The rewrite cut it (`rewrite.md` D5) because it never
reached SSH or T3 Code.

## Choices and why

- **Voice is a channel, not a transcript reader (2026-10-18, the user's design).** The user's words
  reach the agent as voice messages; it answers through `say` (`src/voice/say.ts`), the only thing
  spoken. Reading the transcript aloud spoke whatever the model wrote, at whatever length; with `say` the
  agent decides what is worth hearing, and the same pair (messages in, a tool out) fits any other surface.
  - `say` must be declared to the model, so its arguments stream: Pi parses tool arguments as they
    arrive, and `message_update` toolcall events feed the sentences to speech, as text deltas did. It has
    `codemode` exposure like `show` and is activated while voice is on: codemode "only" (bruv's setup)
    hides plain tools behind scripts, and the user found the agent never speaking because `say` was one
    of them. An activated codemode tool stays declared; the test checks the request's `toolsAdded`.
    `execute` speaks whatever streaming missed and returns at once, so work goes on while it plays.
  - A run must start from a user message. A run started by `sendMessage(..., { triggerTurn: true })`
    skips `before_agent_start` and gets Pi's base prompt: no voice section and none of bruv's own prompt
    (`prompt.ts`). So an idle agent gets "The user said by voice: …" as a user message; a busy one gets a
    `bruv-voice` steer (a developer message on OpenAI, like bruv's other notices). bruv elsewhere never
    starts runs from custom messages for the same reason.
  - Busy: Pi takes steers only between steps. While the agent thinks or writes (no tool running), the
    run is aborted and the words start a new one, so it answers at once; a running tool is left to
    finish, as cutting it breaks builds and edits (the user chose this). The prompt asks for slow work
    as background jobs (`job_start`, whose `wait` returns early on pending messages).
  - A voice-started run that ends without `say` gets one more step with a reminder, through
    `agent_before_settle` like bruv's other nudges, never a new run.
  - The page shows the agent's written text as quiet notes (the user wanted the full transcript there),
    never spoken. Tool steps ("bash git status…", "read README.md") were shown too, and dropped: the user
    found them noise on a phone screen.
  - **Long says: a soft check, not a cap** (the user didn't want hard limits). Past 70 words (about 30 s)
    a say stops at the last whole sentence that fits and the tool returns an error with the word count
    and the last sentence heard, asking to show the rest and say one sentence, or to call say again with
    `confirm: true` and only the unheard part. `confirm` comes first in the schema so it streams before
    the text. The prompt asks to show anything longer than two or three sentences up front. Length is
    words or characters over 6, whichever is more: a model once leaked chat-template tokens and a whole
    HTML page into one say, which counted as 54 space-separated words and was read for 100 s. Text after a
    `<|` token is dropped, and HTML tags are stripped before speaking.

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
  Silero VAD v5, `nemotron-speech-streaming-en-0.6b` int8 with 160 ms chunks, Kokoro v1.0 (82M, voice
  `af_heart`). Pocket TTS came first (98 MB, 0.26 of real time) but users found it unnatural. Kokoro's int8
  build ran at about real time on this x86 machine, too slow to keep up; the full model runs at 0.41, so
  that is the one (333 MB). It speaks a sentence at a time, so the first audio waits for the first
  sentence (about 0.3 s for "Sure."). Only the US English lexicon is loaded. The old Pocket folder is
  deleted after the download.
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
  While hands-free is on, a press starts a held turn only once it outlasts a tap, with `keep` so the
  worker starts it from the VAD's last 0.6 s. Starting it at once made the tap that turns hands-free off
  pause the reply, and as a held turn skips the echo check, the reply's own echo heard during the tap
  became a turn and cut the reply off. Turning hands-free off now just ends a turn the VAD has open.
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
- **QR code for the phone.** Only a tunnel gives a phone an address it can use (https, not
  127.0.0.1), so the code appears once the tunnel is up: above the input until a page starts (the
  server's `onStart`, on a page's `mic`), and on the page on a computer (the server sends `remote` with
  an SVG). `uqr` (MIT, no dependencies) encodes it: QR encoding is easy to get subtly wrong, so this is
  a runtime dependency worth having. Both forms were scanned back with `zbarimg`; in a dark terminal the
  default polarity reads, the inverted one doesn't.
- **The voice page is an installable app (PWA).** The key is the page's only sign-in, so the manifest
  holds it in `start_url` and is itself served only with the key (the server writes the key into the
  page's manifest link). Icons and `sw.js` need no key. Installing only lasts because the key is saved
  (`token` file), the port is fixed (7807) and the tunnel uses the user's own host; a random-host tunnel
  would leave a dead app after each restart. The worker keeps nothing offline, since the page is useless
  without bruv: it only swaps a failed load, or a 5xx from Cloudflare when bruv is stopped, for a short
  page that polls and reloads. Chromium reported no installability errors with a real profile
  (incognito always reports one).
- **Voice is the flagship.** The README, the site (headline, first demo, a muted looping video in the HTML
  view, a "Watch it" link in the terminal view) and the changelog lead with voice. The hero video
  (`.tmp/hero/` records, `.tmp/hype/` edits; not kept) is the real agent on a phone page with a
  virtual microphone. A plain walkthrough cut was tried first and read as dull; the one in use is a
  37-second square hype cut: an HTML stage (Inter, kinetic words, a realistic phone frame, live captions
  so it works muted) rendered frame by frame with Playwright at 30 fps, the real voices cut to each scene,
  and a pulse made with ffmpeg's `aevalsrc` that ducks under them. Every voice clip ends on a sentence
  end (checked by running the clip through the speech recogniser), and each cut in the footage gets a
  slice sound. In `aevalsrc`, keep `exp()` finite before an event starts (`max(t-start,0)`): infinity
  times zero is NaN, and one NaN silences the whole mix. Chromium's screencast and
  Playwright's video both record CSS pixels, so the phone is shown near its real size.
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
- **Cloud speech: Fish Audio Drama 3 through OpenRouter** (2026-10-18). The user wanted the "um"s and
  "hmm"s that make it feel like a person, and best value above that bar, after Higgs was too slow
  locally. OpenRouter's `/api/v1/audio/speech` has about 35 speech models; Drama 3 is $2 per million
  characters at its launch price (80% off), about 10¢ an hour of talk, ranked 4th for realism there.
  Measured: first bytes in 0.45–0.9 s, a whole sentence in about 1 s, PCM at 44.1 kHz; bracketed
  directions ("[a little sheepish]") are acted and not read; "uh" is spoken (Scribe and Parakeet heard
  it). The default voice is used (no `voice` sent).
  - The key is Pi's OpenRouter key, through `modelRegistry.getApiKeyForProvider("openrouter")`; bruv
    keeps no key of its own. Without one, Kokoro speaks, and a notice says once what a key would give.
  - Each sentence is sent as soon as it is whole and played in order (`cloud.ts`). A failed one and
    everything after it go to Kokoro once the sentences before it have played, so voices never overlap;
    Kokoro keeps the rest of that reply. 400–404 stop the cloud for the session; 5xx and 429 retry once.
  - Directions travel to the engine only: the page, echo checks and Kokoro get the words without them.
  - The prompt asks the agent to think aloud where a person would, not in every sentence, and to give
    a mood only when it changes. Instructions give the reason, not a list of fillers to use.
  - Its loudness swings 10 dB between sentences, so each is brought to Kokoro's level (-23 dBFS) from its
    first 0.4 s of speech, held for the sentence. Louder echo and digits read as words ("1995" heard as
    "nineteen ninety five") made the agent's own voice count as the user cutting in; echo checks now
    compare numbers in both readings and "zoom.mp4" as "zoom dot mp four".
  - Engine errors are shown in the terminal too; before, only pages showed them, so a failed cloud voice
    went unexplained.
  - In the first real-agent test (cat-jam-free, codemode only) fillers were rare ("oh nice", "yeah") and
    moods came only when asked, so the prompt says why: the user chose a voice that can act.
  - Without a voice, Fish models pick a new one per request, so every sentence had a different voice.
    `src/voice/voice.mp3` (7 s, 58 KB) is the voice the user picked; it goes with every request as
    `input_references`, with `speed: 1.2` (Drama's own pace felt slow; 1.2 gave about 170 words a
    minute). Other models get neither. The user compared ElevenLabs Flash v2.5 (245 wpm, first audio
    0.6 s, about $1 an hour), v3 Conversational, MAI-Voice 2.1 Flash, Grok, Gemini 3.8 Flash Lite (2.5 s
    to start) and Drama with a fixed voice, and chose Drama.
  - Fillers: the user found the 2–3 s before an answer felt like not being heard, and asked for a "good
    fake". 0.8 s after their turn, if nothing is being said, one of seven short sounds ("hmm", "mm,
    okay", "let me think"…) plays in the same voice, never the same twice running. They are made once
    per voice settings (`voiceId`) into `voice/fillers/`, trimmed and levelled, so they play at once.
    They are not shown on the page, count for echo, and the prompt tells the agent one may have played.
    A turn that is still going (speech starts again) or an answer that starts first cancels it.
    Measured: filler at 0.80 s, answer at 2.5–3.2 s with a 1.6 s model.
  - One set for every turn didn't work: "let me think" answered "how are you doing", and the user said
    no. Regex rules for greeting, question and request were next; the user offered a tiny local model
    instead. Scored on ~490 phrases from two test sets written apart from the training ones (phrases
    also in training left out): rules 43–52% right, a TF-IDF classifier (words, word pairs, letter
    runs 2–5) 81–92%, e5-small (33M) 84–93%, e5-base (110M) 86–95%, potion static embeddings below
    TF-IDF. Training data, not the model, was what mattered: going from 600 to 3,200 examples moved
    every model more than switching models did. The models need onnxruntime-node (300 MB; Pi runs
    on Node, and a plain-JS transformer takes 200–550 ms), so `kind.ts` is the TF-IDF one, learnt
    from `turns.tsv` (3,400 labelled turns written by agents in different voices) in about 0.3 s
    when fillers load, 0.03 ms a turn. Good and bad news are learnt apart but play one sound that
    fits either ("oh!", "whoa"): every model mixed them up on world knowledge ("sign ups doubled",
    "the memory leak is back"), and "oh nice" to bad news is the worst miss. Under 60% sure plays
    nothing; that leaves about 8 wrong sounds in 490, mostly harmless. The OpenRouter small model
    (mimo-v2.6-flash) picked well but took 0.5–3.5 s, too late for a 0.8 s filler.
  - Speed is the user's to set (`/voice speed`, `voice.speed`), relative to bruv's normal pace: 1 is
    Drama 3 at 1.2 (its own pace felt slow) and Kokoro at 1. They found 1.2 still slow. Drama 3 refuses
    speeds outside 0.5–2 (HTTP 400), so the command takes 0.5–1.6. Fillers are kept per speed (it is in
    `voiceId`), so a change makes new ones in the background.
  - `/voice web` shows the link instead of opening a browser, at the user's request. With a tunnel saved
    it says the tunnel is connecting, then gives the tunnel's link: the local page gave no sign of the
    tunnel, and the user's installed app lives at the tunnel's address.
  - Phone volume: the user saw the page switch between the media and the call volume on Android. In
    Chromium's `audio_manager_android.cc`, the first microphone opened with platform effects (echo
    cancelling, on phones with a vetted hardware canceller) turns on communication mode, and output
    streams made while it is on use `AAUDIO_USAGE_VOICE_COMMUNICATION`; ones made before keep media, so
    it depended on which started first. The emulator (no hardware canceller) stays in `MODE_NORMAL` with
    either setting, so it can't show this; checked with `dumpsys audio`. The user chose media volume:
    echo cancelling is off by default and bruv's own echo check (as in the terminal) handles the
    speaker; a "Cancel echo" switch in the ⋯ menu (shown on phones now) turns it on, kept per browser.
  - Speech recognition stays local. Cloud transcription (Scribe v2, GPT-4o mini transcribe, Parakeet,
    Nova-3, Whisper turbo) took 1–2.6 s after each turn and none streams, which barge-in needs;
    Nemotron here streams for free.
- Bigger local speech, tried 2026-10-18 and dropped. A listening test of Kokoro, Qwen3-TTS 1.7B,
  Chatterbox (and Turbo), VibeVoice Realtime 0.5B, Orpheus 3B and Higgs TTS 3 4B had the user pick
  Higgs (voice "belinda"). Run from a Python helper on this Ryzen 7940HS CPU it made 1.9 frames a second
  in bf16 and 1.1 in fp32, where speech needs 25: 13 times slower than talking, so a sentence took 45 s.
  Its licence is also research and non-commercial only. The user went back to Kokoro, or cloud speech.
  Anything over about 1B needs a real GPU; the user's laptop (Ryzen AI 9 HX 470, 64 GB DDR5-5600) has
  none that PyTorch uses well.
- Cloud speech, so the page or an app could work without this machine's models: researched 2026-10-17, not
  built. Deepgram Flux (speech to text with end-of-turn, $0.39/hr) and Aura-2 (speech, $30 per 1M
  characters) share one short-lived browser token; AssemblyAI Universal-Streaming ($0.15/hr) and Inworld
  TTS-1.5 Mini ($5 per 1M characters, price unclear) are cheaper. The brain would still be bruv.
- The headphone play/pause button could mute through the Media Session API; it needs an `<audio>` element
  playing, not only Web Audio.

- English only. Nemotron 3.5 streaming (40 languages, same size) is in the same sherpa-onnx release.
- A turn model (Pipecat's Smart Turn v3, ONNX, CPU) could replace the fixed 0.6 s silence.
- A small local or fast model could answer at once while the main model works; not needed yet.
- **Progress is per sentence.** Devices report `played(part)` for each sentence they finish (the page
  from its schedule, the terminal from its own timeline), and `Call` keeps what isn't heard yet by number.
  A bare `played` meant "caught up with what came so far", so a short first sentence ("Sure.") ended the
  reply early: "Ready" mid-reply, echo checks off, and a new question not counted as cutting in. With
  nothing left to say, the state is "thinking" until `agent_end`, so tool steps after a spoken line don't
  show "Ready". The terminal speaker keeps each sentence's audio until it has played, since killing
  `pw-play` on a pause lost everything already written to it; resume plays the sentence again from its
  start. The sentence playing when someone starts talking goes to the agent as a note on their message,
  because the reply in the history was written well ahead of the voice and usually finished.
- **Echo and soft pauses.** The echo check counts words over 3 letters, takes close matches (prefixes,
  small edit distance) and needs 75%: echo comes back misheard ("thirty-one years" as "One year"), while a
  real question sharing a few short words must still get through. A pause from the microphone alone is
  `soft`: the page turns the reply down instead of stopping it, so echo doesn't make it stutter; a press
  stops it, after the tap window. Colons no longer end sentences ("One:" alone sounded clipped).
- **Pages keep the conversation.** `Call` logs user lines, sentences and shown things with numbers; a
  page says `hello` with the call id and last number it has and gets what it missed (all of it on a new
  call), sentences already played marked past. Reloads, a second page and the installed app open on the
  conversation instead of an empty page, and a dropped connection no longer crosses out a reply that
  goes on playing. `/voice off` closes sockets with code 4000 so pages say voice is off.
- **Only players report progress.** The terminal speaker and pages that have started (claimed the mic)
  play replies; a page that is only open doesn't, and counting it marked every sentence heard on arrival.
  When the last player goes (a reload), the rest counts as heard; with no player at all, audio counts as
  heard on arrival and the state never shows speaking. A failed model run is told once, after Pi's retries
  (`agent_settled`), as a page alert and one spoken line.
- **Echo limits, tested without echo cancelling** (page playback fed back into the virtual mic): at
  −10 dB and −20 dB no false cut-ins; at −30 dB short misheard fragments still cut in (about 2 per long
  reply). The check compares a turn against every sentence since it began, ignores words of 3 letters or
  fewer, and matches close spellings and, for 5+ letters, Soundex. Looser rules started taking short real
  interruptions ("what about Saturn") for echo, so it stops here until tried on a real phone, whose
  browser cancels echo.
- **Terminal echo (laptop speakers, no echo cancelling).** The user found `/voice` in the terminal
  repeating the same sentence forever: echo set off a pause, the terminal speaker stopped and kept the
  sentence, the echo check resumed it from the start, and its echo set off the next pause. Now the terminal
  speaker ignores pauses from the microphone alone (it can't turn down `pw-play`); real words stop it. As
  echo keeps the turn open until the reply ends, the reply is stopped mid-turn once the live transcript
  has 3+ words over 3 letters that aren't in what was said (`fresh`), and runs of 4+ words of the reply
  are trimmed from the start and end of the turn (`withoutEcho`); a lone word left by the trim is dropped.
  The recogniser writes "want to" as "wanna", so common contractions are expanded before matching.
  Checked with `.tmp/echo/` (stand-in pw-play/pw-record feeding the speaker back at 0.1 and 0.3 gain,
  60 ms late, real worker): replies finish with no false turns, and a line said 4–6 s in stops the reply
  within about 2 s and reaches the agent clean.
- **First sound sooner.** Kokoro makes a piece at a time, so a long first sentence delayed the first
  sound by seconds. The first piece of a reply may end at a comma once it has 8 words.
- **The where-line follows devices,** not commands: who holds the microphone and whether a page is
  connected. "Server running" read as "user on the page" when no page was open.
- **Command and grace fixes from user testing.** `/voice` toggles only the terminal's microphone and
  speaker when the page is on (`/voice off` stops all). `/voice tunnel` asks its questions before starting
  anything, Escape changes nothing (Pi's input gives `undefined` for Escape, so a saved key is reused only
  on an empty answer), and a failed tunnel stops what it started. The audio programs are checked
  (`audioMissing` in `local.ts`) before the models load. The empty-chat logo hides when anything is drawn under it
  (`covers` in `home.ts`, from `tui.render`), since it hid the QR code at 40 rows. After a tap, audio in
  the grace also goes to the preroll; the grace grows while the words do, and with no words the turn ends
  without decoding (decoding padded a first syllable into a turn of its own), so a VAD turn right after
  starts from the kept audio. With the real models, speech starting 0.8–1.3 s after the tap used to lose
  or split its first words ("Tell me" / "Fun fact about Saturn") and now arrives whole.
