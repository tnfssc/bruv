---
name: skills-in-prompt
description: How bruv decides which skills the model sees, and why.
---

Pi lists every loaded skill (name, description, path) in the system prompt. bruv first cleared that list
to save tokens, assuming the model would look skills up itself. It never did: with nothing in the
prompt, it didn't know skills existed or where they lived.

Listing every skill was too much for the user, so `src/skills.ts` does this instead:

- Every skill is off until turned on with `/skills`. Only skills that are on stay in Pi's list.
- Skills that are off still get a short section (`skill_folders`) saying what a skill is and which folders
  hold them, so the model can find one when a task fits. `/skill:name` runs any of them.
- Picks are per project. `.agents/bruv.json` is committed for the team; `.agents/bruv.local.json` is the
  user's own, and its keys win. Both store `name: true/false` maps so the local file holds only the
  differences and still follows team changes.
- The local file is read from the main checkout (`git rev-parse --git-common-dir`), so every worktree
  shares it; an untracked file would otherwise be missing in each new worktree. It is ignored through
  `.git/info/exclude`, like `.bruv/` in `worktree.ts`, so bruv adds no file to the repo for it.
- A pick for a skill that isn't installed is kept and shown as "not installed"; it does no harm.

The web assistant still clears the list: it has no file reader, so it could not load a skill anyway.
