# v0.15.29

## Fast mode for GPT sessions and subagents

- New supported CLI and SSH subagents inherit an active parent fast-mode setting. Existing child sessions keep their own settings. The separate T3-native task backend is not included.
- The footer now shows whether the provider confirmed fast mode or returned a standard tier. Until response evidence arrives, it shows fast mode as requested.
- Replace the permanent unknown fast-mode cost with Pi's tier-aware dollar estimate, marked with ~. This is a model-price estimate, not a ChatGPT credit bill.
- Preserve system prompts and tool definitions when fast mode wraps a Codex request.
