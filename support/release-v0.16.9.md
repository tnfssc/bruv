# v0.16.9

## Live push-to-talk

- Live now starts muted in push-to-talk mode. The mic stays open locally; muted
  audio is discarded, not saved or sent.
- In the talk panel, press and release Space once to check terminal support.
  Then hold Space to speak and release to end the speaking turn. Playback and
  agent jobs stay active.
- Enter starts speaking and Backspace mutes on terminals without key releases.
  Esc returns to text muted. Use /live talk to reopen the panel, or /live input
  to choose continuous mic before starting Live.
- Gemini and OpenAI Realtime support manual turns. GPT-Live primary has no
  manual input-turn control; choose a supported model or explicitly choose
  continuous mode. Connector-host Live also needs explicit continuous mode.
- Native capture gates and hold epochs prevent muted capture backlogs from
  entering a later speaking turn. Focus loss and modified Space releases mute.

This release also includes the shared CI/Release Linux gate and fixture fixes
merged after v0.16.8. Device-free checks do not establish acoustic echo behavior
or physical terminal key-release support.
