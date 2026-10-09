# README animations

The user simplified the root README, then asked for GIF versions of the website terminal demos and one more for Live mode. Keep install and commands first. Put all four GIFs in one short Demos section. No extra feature pitch or remote media host.

`site/scripts/readme-gifs.ts` exports fixed timestamps through the website's colored HTML cell renderer. `site/demos.ts` stays the source for worktrees, background jobs, and wisdom. The site itself is unchanged. `site/scripts/readme-live.ts` adds a README-only scripted hold-to-talk story. It calls `src/live/status.ts` for the real status wording. Transcripts follow the native user/assistant display and mark drafts as partial. These are UI mocks, not recordings of model calls or audio. The header says scripted demo.

Keep shipped GIFs in `site/assets/demos/`. Disposable frames go under ignored `artifacts/readme-gifs/`. Rebuild steps and tool requirements live beside the GIFs.

Worktree: `/home/tnfssc/.t3/worktrees/bruv/t3-7f6ac5b1`. Branch: `t3/add-readme-gifs`.

Values reviewed. No new general lesson: source reuse, honest demo labels, and separating product assets from disposable evidence are already covered. Values stay the same.

## Checks

The first full site run found a stale assertion in `site/scripts/install-ui.test.ts`: it required the installer source link that the user removed in README cleanup commit `de21d7d5`. Removed only that README-link assertion. The shared install command and both site source links are still checked. Do not undo the user's cleanup to satisfy the old assertion.

All four exports were opened at meaningful stages. The encoded Live GIF was decoded and checked too. ffprobe confirms 840 × 534 pixels and 100 / 105 / 100 / 90 frames for worktrees / background / wisdom / Live, with 20 / 21 / 20 / 18 second loops. Together the GIFs are about 151 KB. Focused story and asset tests: 13 passed. Formatting and diff checks pass. Full site rerun passed: 46 tests plus browser validation, with no browser errors. Focused strict TypeScript checking passed with `--ignoreConfig`; formatting and `git diff --check` passed. No CLI or real audio session was changed or tested.

## Handoff

README and the four small looping GIFs are ready in this worktree. Rebuild with `cd site && bun run gifs`. No commit, push, PR, or website deployment was requested or done. Changes remain local and uncommitted. All started jobs have finished. Values are unchanged for the reasons above.
