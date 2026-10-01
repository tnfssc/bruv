# Result-first human remote rendering

Connected fixture dogfood (2026-10-01, [report](ux-dogfood-2026-10-01.md)) found a successful repository return hidden behind a generic done result, UUID-first notices, and transcript diagnostics before the useful question.

Human task details and attention should start with the launch prompt, observed state, question/action or saved result. Keep task/question/reply IDs for explicit commands and receipt inspection, not as the main title. Transcript paging, failures, offline observation, uncertain reply delivery, and missing output must remain visible; moving them below the useful result is not removing them.

Task done is not repository applied. Render only the recorded repository return: applied, no changes, review, or unknown. Show its reason, patch artifact and receipt when saved. The current RepositoryReturn schema has no affected-file list; do not infer `tracked.txt applied` from assistant text or silently read a patch to invent one. Saved artifact manifest paths identify retained artifacts, not changed repository files. A later recorded return should produce one outcome notice without repeating the assistant answer.

Checks: direct Bun rendering/extension/menu tests and TypeScript check. This is rendering proof, not a new connected video or real-provider run; the parent integrates menu changes and records the combined compiled CLI.

Values unchanged: values 4 (observed state versus acknowledgment), 8 (human controls and truthful surfaces), and 10 (clear ownership/proof) already cover this lesson.
