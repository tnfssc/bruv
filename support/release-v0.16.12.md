# v0.16.12

- Voice stays in the normal terminal editor and conversation. Tap Space types a space; hold Space speaks, and release ends the spoken turn. There is no separate talk panel.
- Typed drafts stay intact. Typing, paste, navigation and focus loss mute the mic. Spoken turns remain readable when a saved session is reopened.
- Fix duplicated final Realtime replies and missing casual GPT-Live user speech. Stop failures now use plain warnings instead of internal acknowledgement wording.

Hold-to-speak supports Gemini and OpenAI Realtime. GPT-Live remains continuous-only. Older terminals infer release after 250 ms without key repeats. Real PTY tests use synthetic keyboard/audio/provider events; physical keyboard, microphone and paid-provider acceptance are not claimed.
