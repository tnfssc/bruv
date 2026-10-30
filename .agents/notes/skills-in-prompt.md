---
name: skills-in-prompt
description: Why bruv keeps Pi's skill list in the system prompt.
---

bruv once cleared `systemPromptOptions.skills` to save tokens, assuming the model would look skills up
when needed. It never did: with no list, the model didn't know skills existed, where they lived, or that
it should read `SKILL.md` before a matching task. A list of names, descriptions and paths costs a few
lines per skill and is the only way the model can route to one, so bruv now leaves Pi's skill section
alone. Pi already picks the right wording when the reader is behind codemode.

The web assistant still clears the list: it has no file reader, so it could not load a skill anyway.
