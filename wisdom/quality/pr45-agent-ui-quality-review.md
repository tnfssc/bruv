# PR45 quality-intent review — REJECT (one focused repair)

Target: **0d8066e49868c82eb793a1248d055fd52a62037c**. Comparisons: accepted continuation **a0d9ef19504be165384f893c5bfda48dc7c08abb**, PR base **22ad5f50acfc7b6ceed6483358022a0161a77d99**.

Actual reviewer model verified from this session's model_change event: **openai-codex/gpt-6.1-sol**, event 919e8f6e, 2026-10-08T15:00:33.738Z; session 01a11c07-a807-7617-b4fd-9a66af617967.

## Finding: Fast selection regained parallel checkpoint-building paths

**REJECT — src/agent/native-fast-mode.ts:530–565, 672–685, 697–720.** The new host path introduces persistSelection, but the command does not use it: it independently builds the same v2 session/provider/model/OAuth consent record and calls persistSetting. Inherited startup builds that record a third time and calls pi.appendEntry directly. Following “select Fast → bind billing consent → publish setting → show status / inherit into children” requires comparing three record-construction programs and two publication routes. The host-selection abstraction does not own selection publication across the feature.

This is an integration reading regression, not a claimed auth exploit or request for more tests. PR base 22ad5f50 already had host and command selections call the same persistSelection; the accepted continuation lacked the host interface. Their join restores the interface without restoring that shared operation. **Keep persistSetting:** it correctly centralizes rollback and volatile opt-out suppression.

**Repair:** one operation should construct and publish the model-bound selection, used by host and command after their eligibility/consent checks. Route inherited consent through that publication operation too, retaining its one-shot/absent-setting admission and appropriate startup error handling. Keep asynchronous confirmation and stale-consent checks in the command, explicit host consent at the host boundary, and immutable request authorization/transport guards. No generic settings framework or additional defenses needed. The improvement is one visible publication journey, not fewer names/lines.

## ACCEPT — other nine assigned files

- **agent/extension.ts:127–135, 273–297, 638–697:** host Fast control delegates policy. Compaction precedence and shake-driven capture/cache invalidation remain visible at composition. Prompt framing follows restored identity/continuity; attachment and shutdown own UI/task lifetimes.
- **agent/cache-countdown.ts:141–180, 203–386; agent/instruction-mode.ts:31–49, 86–123:** selective readers retain explicit authority boundaries. Countdown separates durable observations from request/HTTP-terminal evidence; mode delegates frame authority to continuity.
- **agent/manual-shake.ts:194–491, 568–598, 712–975; agent/native-compaction.ts:510–563, 647–805, 807–1025:** protocol matching authorizes projection, one shake commit owns append/rollback, and carry-forward stays visible. Indexed lookup selects the newest checkpoint; native capture/admission and pinned paid-attempt settlement remain separate. Coverage uses the shared shake projection, not a new permissive matcher. Native default tier (92–102) and request-local plaintext standard tier do not mutate session Fast consent.
- **goals/extension.ts:124–161, 235–340:** selective replay feeds GoalStore; reminder transport tokens remain separate from run accounting. Goal injection does not acquire journal authority.
- **ui/footer.ts:86–203, 223–380, 418–530; ui/rolling-activity.ts:146–210, 357–480; ui/task-rows.ts:77–122, 205–242:** billing remains all-branch; membership/task-row restoration remains selected-branch. Metadata selection avoids unrelated checkpoint bodies. Reduced caches do not retain message bodies; footer observers share component lifetime. Activity does not mutate native detail state/task owners; row merging separates terminal facts from display metadata. Fast/cost presentation distinguishes selected mode/catalog estimates from delivery/billing evidence.

Paths above are under src/. No additional tangible quality blocker found; acceptance is source-quality judgment, not product/runtime acceptance.

## Exact read scope

All final lines of the ten assigned files: agent/cache-countdown **1–418**, extension **1–1057**, instruction-mode **1–125**, manual-shake **1–976**, native-compaction **1–1026**, native-fast-mode **1–740**; goals/extension **1–385**; ui/footer **1–530**, rolling-activity **1–594**, task-rows **1–243**. Read their continuation-to-target diffs; inspected PR-base Fast publication **510–565, 665–686** and baseline/continuation operation locations.

Neighbor reads under src/: history/session-manager **47–135, 261–332**; history/shake-record, goals/controller and session/restore-leaf complete; agent/instruction-continuity **55–122**; agent/cache-affine-compaction **29–155, 311–389, 539–727**; claude-compat/runtime **351–383, 597–634, 661–713**; tasks/job-service **576–592**. Installed Pi ModelRuntime **447–517**. Other neighboring bodies are not independently accepted here.

Read values, structural-readability guidance, original owner pilot; focused agent/UI area summaries and assigned-file judgment rows; Linux repair judgment. Read relevant excerpts of compaction research, native Fast/canonical OAuth research, native shake coverage, rolling disclosure research/acceptance and product-first integration notes. Older judgments support retained responsibility splits, not changed-byte acceptance. Historical test counts are not this verdict's basis.

**Unverified:** runtime/provider/credential/device/SSH behavior, rendered product acceptance and exact-tip CI. No tests, install, preparation, setup retry/bypass, source edits, cleanup/deletion or push. Only this report added. Values/guidance unchanged: this applies their existing ownership/readability principle. Parent owns combining and repair.
