# README animations

The user simplified the root README, then asked for GIF versions of the website terminal demos and one more for Live mode. After the first GIF pass, the user cut the extra copy and moved all four demos into a compact grid below the one-line pitch. Keep that layout. No extra feature pitch or remote media host.

`site/scripts/readme-gifs.ts` exports fixed timestamps through the website's colored HTML cell renderer. `site/demos.ts` stays the source for worktrees, background jobs, and wisdom. The site itself is unchanged. `site/scripts/readme-live.ts` adds a README-only scripted hold-to-talk story. It calls `src/live/status.ts` for the real status wording. Transcripts follow the native user/assistant display and mark drafts as partial. These are UI mocks, not recordings of model calls or audio. The header says scripted demo.

Keep shipped GIFs in `site/assets/demos/`. Disposable frames go under ignored `artifacts/readme-gifs/`. Rebuild steps and tool requirements live beside the GIFs.

Worktree: `/home/tnfssc/.t3/worktrees/bruv/t3-7f6ac5b1`. Branch: `t3/add-readme-gifs`.

The user asked to make values from both README cleanups. Value 8 now covers concise public copy. Source reuse, honest demo labels, and separating product assets from disposable evidence still use the existing values.

## The user's two cleanups

- `de21d7d5` cut the original README down to the brand, one-line pitch, install, updates, and commands. It removed the second product title, installer internals, feature essays, connector/version history, build details, state paths, measurement tools, maintainer release steps, and the long docs list. The T3 setup guide stayed as one short link. This was a choice about the front door, not a request to delete the deeper docs.
- `b8dff5c6` cut the GIF pass. The user removed the Demos section title, website/scripted-demo introduction, four feature headings, and the extra Live paragraph. The four images moved into a two-by-two table inside the centered brand block. Alt text stayed. The demos speak for themselves; do not add the same pitch back as captions.

The repeat lesson is to remove whole repeated ideas, not just polish their wording. A README should help someone see the product and start using it. Use compact visuals instead of a long narrated tour. Keep required steps and useful links. Put deep setup, maintainer history, and proof in their own docs. Value 8 links here. This does not justify dropping needed warnings or steps from a repair guide.

## Checks

The first full site run found a stale assertion in `site/scripts/install-ui.test.ts`: it required the installer source link that the user removed in README cleanup commit `de21d7d5`. Removed only that README-link assertion. The shared install command and both site source links are still checked. Do not undo the user's cleanup to satisfy the old assertion.

All four exports were opened at meaningful stages. The encoded Live GIF was decoded and checked too. ffprobe confirms 840 × 534 pixels and 100 / 105 / 100 / 90 frames for worktrees / background / wisdom / Live, with 20 / 21 / 20 / 18 second loops. Together the GIFs are about 151 KB. Focused story and asset tests: 13 passed. Formatting and diff checks pass. Full site rerun passed: 46 tests plus browser validation, with no browser errors. Focused strict TypeScript checking passed with `--ignoreConfig`; formatting and `git diff --check` passed. No CLI or real audio session was changed or tested.

## Handoff

The user asked to pull, format, and push after their cleanup. Pulled `b8dff5c6` with a fast-forward. `bun run format` checked 920 files with no changes; it skipped two existing large quality JSON reports with size warnings. Markdown is excluded by the repo formatter, so the user's README layout stays as written.

The user then asked to remember both cleanups as values. Updated this note and value 8 before the next commit. No GIF or website change was needed. Both focused GIF tests and `git diff --check` passed. Ready to commit and push `t3/add-readme-gifs`. No new PR or deploy was requested.
