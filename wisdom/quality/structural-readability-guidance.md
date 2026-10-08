# Structural readability guidance

From the user correction and independent REJECT/ACCEPT rounds in the [owner pilot](structural-readability-owner-pilot.md). Use this for broad agent-led readability work, not as thresholds or extra process for every tiny rename.

Start with actual reading problems: which journey makes a reader reconstruct scattered decisions, authorities or lifetimes? Better names help, but do not resolve that burden alone.

Group operations around their authority. In the pilot, answer acceptance, uncertain dispatch and ledger-backed acknowledgement belong together; receipt, command slot and native ledger still have distinct jobs. Keep transport framing separate from semantic decisions. Show the consequences of protocol outcomes where the task is orchestrated.

Make ownership and lifetimes visible: who starts work, observes exit, escalates shutdown, drains persistence and publishes the terminal result? Extract coherent operations with clear effects, not arbitrary blocks behind names or a shared context bag. File ownership helps focus work; it does not prohibit coherent related changes. Coordinate those edits during broad passes.

Tests and coverage support safety, not a readability verdict. Ask an independent reader to judge the actual code and follow the important journeys. Accept rejection of cosmetic-only progress; describe what was accepted and what proof is still missing.

## Research behind the guidance

The original tvly research is retained in Git at fc592efd:wisdom/quality/readability-guidance.md. That branch's cosmetic implementation was rejected; we reuse the source references, not its file-edit restriction or source changes. A file is an agent's focus, not a wall around coherent repairs.

- [Google code review guidance](https://google.github.io/eng-practices/review/reviewer/looking-for.html): judge complexity, present needs, names and useful comments by reading actual code. The current history judge also read this source directly.
- [Fowler: refactoring](https://refactoring.com/): improve internal structure while preserving observable behavior. Explicit bug repairs must be identified separately.
- [Sandi Metz: the wrong abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction): forced sharing can be worse than duplication. Share a real policy owner, not merely similar lines.
- [The Grug Brained Developer](https://grugbrain.dev/): a caution about premature complexity, not a literal rulebook.

These are prompts for judgment, not scores or fixed style rules. Original pilot lessons and later independent rejections decide how they apply here.
