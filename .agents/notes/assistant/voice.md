---
name: voice
description: How voice works in the web version's page (src/web/voice.ts, web/src/voice/), what it reuses from terminal voice, and what is still open.
---

# Voice in the web page

- **One part, its own socket.** `voicePart()` serves `/voice` on the web server (key checked with
  `allowed`): binary 16 kHz PCM up, PCM down, small JSON both ways. It reuses `Call`, the engine,
  `Sentences`, echo checks and fillers from `src/voice/`; `src/voice/page-device.ts` is the page device both
  servers share. Turning voice off in the page closes the socket.
- **Only what the page needs goes down.** The conversation comes over the main socket, so `user` words
  and replies are not sent again as `assistant`/`note`/`show` events (`forPage` in voice.ts).
- **Lazy, both ends.** The engine (about 800 MB of models in memory) starts on the first page's `mic`
  and closes 3 minutes after the last voice socket goes. Replies are spoken only while some page has voice
  on, so no speech is made for nobody. The page's voice code is its own chunk (3 KB gzip), fetched on
  the first tap (or hover); the main chunk has only the state, the button and the loader. Safari needs
  the AudioContexts made inside the tap, so the loader makes them before the chunk arrives.
- **Models are asked for in the page**, not the terminal: the server says `models` with the MB, the page
  shows a Download button, the server downloads to the same folder `/voice` uses.
- **Talking over a reply being written** stops that run (`web.stop()`) and holds the words until it has
  settled (`busy(false)`, or 5 s), so they start a new run instead of being lost as a steer into an
  aborted one. Talking while a step runs, or over a reply that is only still playing, sends the words as
  they are: T3 work is never stopped for speech. The stop-speaking button only hushes.
- **The OpenRouter voice** needs Pi's key, but parts get no extension context; `src/web/voice/engine.ts`
  reads `OPENROUTER_API_KEY` or a literal key in Pi's `auth.json`. A `WebContext` key getter from
  `modelRegistry` would be better.

Open: echo cancelling has no switch in this page yet (it reads the old page's `bruv-voice-echo` setting);
`news` is not used, since a wake-up's reply already comes through `reply` and is spoken when voice is on.
