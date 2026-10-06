# SDK large-text block render fix

## Scope and result

Base: b3d7d7857a69ddafd8f47c54b86207cc26366d62. Bun 1.4.2, Pi 1.0.3, Marked 18.0.11, Linux x64 / Ryzen 9 7940HS. Read values, [interaction lab](terminal-interaction-lab.md), [send workloads](terminal-send-workloads.md), and [tool mutations](tool-interaction-mutation-probes.md).

Owned: SDK text-render hunks in the two existing Bun patches, two focused tests, this NEW note. No harness/shared-note/editor/ScrollView changes. Existing ScrollView/layout and startup-grammar patch hunks stay byte-for-byte intact. Another worker owns editor.handlePaste. No PR/push.

The measured 1.05–1.12 SECOND large-message frame becomes 79.76–149.14 ms. This removes the dominant regex stall; **all-frame/action <8 ms remains open**. Paste still takes 42–69 ms; tool reveal still takes 10–30 ms; large final rendering is still synchronous and well over 8 ms. No work was relocated across doRender or hidden in reveal.

## Exact cause, not wrapping guessed from medians

First CPU profile: artifacts/text-render/CPU.20261006.003129.749705.0.001.cpuprofile and corresponding .md. Setext lheading regex accounts for 609.7 ms (36.3% self), GFM paragraph regex for 503.7 ms (29.9% self). Exact stacks are Tokenizer.lheading/paragraph -> Lexer.blockTokens -> Lexer.lex, once inside SDK Mermaid transform, again inside Pi Markdown.render. Mermaid transform always lexes even a message without diagrams.

The whole-source setext matcher repeats a nested per-character alternative. The paragraph matcher embeds a complete table-body regex in the interruption lookahead at every newline. A direct original-regex probe on 1k/4k/16k/40k repeated lines showed lheading costs 43.8/143.9/266.2/260.0 ms and paragraph 0.70/23.04/91.96/261.46 ms. This is not a safe asymptotic timing claim: Bun also has a regex effort limit. Original lheading accepts a late underline at 4k lines but returns null at 16k/40k. Rewriting the whole heading scanner would therefore change actual Bun reference rendering. That prototype was rejected.

Final bounded scanner:
- Cheap necessary-condition setext prefilter: without a newline followed by a possible underline start, original lheading cannot match. Otherwise preserve original matcher, including engine-limit behavior.
- Scan plain paragraph line boundaries. Evaluate the original GFM interruption predicate on **at most the candidate line plus its following line**, sufficient to detect possible table header/delimiter interruption. If a structural interruption is possible, use original paragraph matcher instead. Blank boundaries stop normally. A non-interrupting paragraph consumes its complete original text with no per-character nested whole-block match.
- No truncation, changed wrapping/width algorithm, cross-frame cache, async prep, worker, plain-text substitution, or modified journal/provider payload.

GfmBlockTokenizer lives and is typed/exported in pi-tui; Pi Markdown's existing tokenizer extends it; pi-coding-agent Mermaid uses it. Marked.use enumerates **own** tokenizer hooks, so constructor assigns the two prototype functions as own properties (not bound: Marked supplies its actual lexer/tokenizer receiver). Merely extending Tokenizer does not activate overrides; a first prototype-only experiment did not remove the hot calls. Tests explicitly fail if whole-block regexes still run on the plain fixture. Other parser hooks/options retain their prior behavior; non-GFM/pedantic delegate unchanged.

Concrete synchronous call traces (wrappers add overhead; these are not clean acceptance timings). Both parse input lengths are 1,048,590 bytes. Parent methods contain child times; **do not sum inclusive rows**:

| state | call | bytes | entry-through-return ms |
|---|---|---:|---:|
| before | concrete.lheading | 1048590 | 303.544160 |
| before | concrete.paragraph | 1048590 | 247.672062 |
| before | Lexer.lex | 1048590 | 560.224540 |
| before | concrete.lheading | 1048590 | 263.692708 |
| before | concrete.paragraph | 1048590 | 241.124006 |
| before | Lexer.lex | 1048590 | 513.843286 |
| before | Markdown.render | — | 1125.855757 |
| after | concrete.lheading | 1048590 | 0.523315 |
| after | concrete.paragraph | 1048590 | 8.121777 |
| after | Lexer.lex | 1048590 | 22.732589 |
| after | concrete.lheading | 1048590 | 0.487808 |
| after | concrete.paragraph | 1048590 | 6.144104 |
| after | Lexer.lex | 1048590 | 18.112414 |
| after | Markdown.render | — | 118.242155 |

Raw: baseline-call-trace.json and final-call-trace.json. Traced full frame: 1130.837075 -> 126.168527 ms. Final parser work is about 41 ms total across both lexers; wrapping/styling/layout remains significant. No async promise lifetime is presented as CPU.

Tool profile CPU.20261006.003920.764621.0.001.cpuprofile instead samples graphemeWidth, splitIntoTokensWithAnsi, wrapSingleLine and segment iteration; it is **not** the same long Markdown block-lexing stall. Instrumented reveal counts 421 segment calls, 98,576 input UTF-16 units and 73,961 yielded segments on the 65,546-byte output. Iterator instrumentation adds overhead; its 30 ms mutation is not a clean speed result. Cached short Markdown renders are individually <0.003 ms in that trace. Wrapping/segmentation remains a separate measured follow-up, not a claimed fix here.

## Matched clean real send/tool evidence

Unmodified commands, serial fresh processes (three repetitions, not mixed concurrent benchmarks):

    bun scripts/terminal-perf/send-workloads.ts normal 0 1048576 bruv-disk
    bun scripts/terminal-perf/send-workloads.ts normal 0 0 bruv-disk
    bun scripts/terminal-perf/tool-workloads.ts --shape single-line --history 8 --repetitions 3 --out <file>

Send uses actual TUI paste and Enter, real SDK one-turn admission and recording provider, Bruv disk journal, scheduled full frame. Actual fixture input is 1,048,591 bytes, SHA256 420d70c00743532c68332fa17a7141a180789ca50928e02e8dddcaa4cf393b3c; empty history hash 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945. Existing SDK submit trims the final newline: **before AND after** provider user and journal user are 1,048,590 bytes with SHA256 6a947e0d72731ea412c6f370226a2fd61461450c2947714f671bf2e8f8f6b54f. Exact semantic provider/journal capture is in both call traces; no new trimming or lost payload. Full provider-request hashes vary with SDK timestamps/system temp directory and are retained in raw samples, not claimed equal.

All six complete action ANSI outputs have identical SHA256 db1421accca8929b91506a57b59ad936fcfdde8a50ceb10945a004c740aa4bc6. Raw acknowledgment screen hashes vary only in fixture /tmp/bruv-send-perf-XXXXXX footer. Normalizing that one known path gives identical SHA256 fa5eab7f0ed4fe5db680be36014e086196853c924f2135dbfb5b42d28652afbf; exact unnormalized screens/hashes remain in raw JSON. This is not removal of user content.

Full synchronous frame duration and independent timer lateness; paste/Enter are non-overlapping top-level synchronous segments. Controlled provider timer requested delay is 10 ms; its await is not CPU:

| send sample | paste ms | Enter ms | full frame ms | provider timer lateness ms |
|---|---:|---:|---:|---:|
| before 1 | 42.954772 | 1.059915 | 1111.055279 | 1102.941744 |
| before 2 | 63.806452 | 1.887466 | 1122.184202 | 1114.108017 |
| before 3 | 42.900320 | 1.001737 | 1051.901106 | 1046.763926 |
| after 1 | 46.680242 | 0.931165 | 79.760194 | 70.013266 |
| after 2 | 68.647520 | 2.205349 | 149.138466 | 141.022857 |
| after 3 | 68.305622 | 1.603277 | 131.958897 | 123.604233 |

Every raw send JSON retains **all** synchronous and async-prefix spans with start/end/depth, provider wait/overlap, marks, exact source/content/output hashes, journal growth and work counts. final-summary.json retains all top-level entry-through-immediate-return segments, not just the frame table. Prefixes are not whole continuation CPU and nested spans are not summed. Existing fixture sourceHash map omits Markdown/Mermaid/Marked internals; final-source-manifest.json below supplies them.

Short real send full frames 4.619447 -> 3.861013 ms; identical ANSI output SHA256 3c4b0b25572322235c237bf6737b47db079615670180cde209406702ae4124ac. No short-input win is claimed from one pair; no observed regression.

Tool reveal, exact non-overlapping synchronous mutation segments and following full frames:

| tool sample | sync ms | toggleDetails/withAnchor ms | request ms | mutation total ms | following frame ms |
|---|---:|---:|---:|---:|---:|
| before 1 | 0.037069 | 24.656379 | 0.002114 | 24.695562 | 0.822883 |
| before 2 | 0.023103 | 11.028779 | 0.002515 | 11.054397 | 0.591311 |
| before 3 | 0.025658 | 10.459397 | 0.002255 | 10.487310 | 0.333371 |
| after 1 | 0.044272 | 30.072509 | 0.001934 | 30.118715 | 1.945635 |
| after 2 | 0.032510 | 10.503059 | 0.001853 | 10.537422 | 0.428248 |
| after 3 | 0.022572 | 10.259955 | 0.001743 | 10.284270 | 0.342678 |

Each reveal performs 2 document renders + 2 native component renders across mutation/following frame, 3 branch calls/63 entries, 2 snapshot calls/16 rows, 1 expansion, 3 render requests; 31 rows change. Across all six samples, content SHA256 35e67b8437fc665aa8d808f04f1845ed835ff348ed36584d69b6cf5eb8abdc39, work SHA256 6ba9580ebb2209c9ac5ae2300515a6346c1b5c284a86c588cf899f877381b0ab, complete rendered document SHA256 db90c1b21c076b8e5e4f8b83db84cc52aaef17f1f6ca8236c63afcfcb0017438, output SHA256 93f4e957301b1e0c2a5c7d711d40a046004cbea01988acad94754ce282b3ccbb, screen SHA256 0a1a65e62553f2dc144e2dfef72c348ff8a16ad0ec0534f4bab19c9efd164f54 are identical. No tool speedup is claimed. The cold mutation tail remains.

## Tests, packaging and compiled product acceptance

- tests/sdk-markdown-blocks.test.ts: exhaustive short reference-token boundaries (headings/tables/lists/HTML/Unicode/newlines), realistic rich Markdown, complete 1 MiB long line and many-line paragraphs, large late heading preserving Bun's original effort-limit result, non-GFM/pedantic. Deterministic work: 2k/4k/8k line predicates see at most 52 units each and <2x source units, calls exactly n-1 and doubling+1; 1 MiB single-line plain block has no boundary predicates. Original whole-block matchers are forbidden on optimized fixtures. Rich ANSI and complete long-word wrapping remain intact at widths 80/31.
- 5 focused tests pass (focused.log); 25 send/tool/compiled acceptance tests pass (acceptance.log); bun run check passes (check.log).
- Fresh-cache install: BUN_INSTALL_CACHE_DIR=/tmp/bruv-render-dependency-cache bun install --force --ignore-scripts --backend=copy passes. Original editor.js equals pristine npm 1.0.3 archive; no other worker's editor edits contaminate these final pairs. Bun hard-linked package files were initially shared across worktrees: isolated render files/restored the shared original, then used fresh-cache copy install for all final validation. Do not profile mutable shared node_modules while another worker edits them.
- bun run build passes, compiled dist/bruv SHA256 b39274bb2bcb2ef9f266383b0c972185f3e34eb784ad866e32cd62ee4e8524f0. tests/sdk-large-text-tui.test.ts uses that actual CLI in a real tmux PTY with a 1,092,058-byte saved user message. Captures loaded, oldest (Ctrl-Home), bottom (Ctrl-End), narrow 46-column resize, and typed draft; checks first/last content, actual captured ANSI bold attributes and exact complete reopened journal text. Artifacts: artifacts/tui/bruv-large-text-788149-1791233573270. This is compiled product behavior, not a counting terminal substituted for terminal acceptance. It does not establish an 8 ms PTY latency bound.

Bun 1.4.2 kept bun.lock unchanged: this text lock contains dependency integrity and patchedDependency paths, no per-patch hash fields. Parent can merge the two isolated render-only patch additions with editor worker hunks and regenerate installation as needed. Existing ScrollView hunks must remain. No editor source hunks in this commit.

## Exact source hashes and raw evidence

Both states retain current pi-tui index export/helper, but baseline Markdown and Mermaid do not use it. Baseline restores just those two originals. Helper presence is not background prep or a cache. Workload, editor, renderer, session, journal, adapter source identities in each raw sample match; the manifest provides missing render internals.

| file | before SHA256 | after SHA256 |
|---|---|---|
| node_modules/@earendil-works/pi-tui/dist/components/markdown.js | 43185f806cc13c2adbe7f30b30be35bba4fce7a5ead4da81f53fe62b9bbbdc3d | af66f1109b638947bd88d8a63ea865a781d538a9d9c9bd3a745f2d33f51ea5f4 |
| node_modules/@earendil-works/pi-tui/dist/components/markdown-blocks.js | fae56bf631970aa7d793bef3e03e90fd0aa4b4e15f816807ec9c13001aad3a1a | fae56bf631970aa7d793bef3e03e90fd0aa4b4e15f816807ec9c13001aad3a1a |
| node_modules/@earendil-works/pi-tui/dist/utils.js | 6c187576b9a2f29b156a0f6cf140fdf6617a5606203db2769760a32a01f3d595 | 6c187576b9a2f29b156a0f6cf140fdf6617a5606203db2769760a32a01f3d595 |
| node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/mermaid.js | da9ebc988b4fbda381f886acda210e4efeb0a894701fe630e1cbd7f0b5bd8bb7 | 4e99c9f95e7b5e01de548a0361479cabf47982e9aa158fe105e4d23a8592fcd4 |
| node_modules/marked/lib/marked.esm.js | 05e41134d075ad3a009a748d6c779c3d83cea9b942be911c2d9abade36d1dd31 | 05e41134d075ad3a009a748d6c779c3d83cea9b942be911c2d9abade36d1dd31 |
| patches/@earendil-works%2Fpi-tui@1.0.3.patch | 0c727d0aadacfda6431b58f61aa2639dea55313b1f7bd39984d3dd57ecdc4c4b | 0c727d0aadacfda6431b58f61aa2639dea55313b1f7bd39984d3dd57ecdc4c4b |
| patches/@earendil-works%2Fpi-coding-agent@1.0.3.patch | 481c43699e4c845f8c7895d9b5af4f3d3c20e9859d76dbfae3c33a2e237ad127 | 481c43699e4c845f8c7895d9b5af4f3d3c20e9859d76dbfae3c33a2e237ad127 |
| bun.lock | a04d018ff92e589dca761d2bee0c327c2d6bb36424901e4c12827b44d51ef451 | a04d018ff92e589dca761d2bee0c327c2d6bb36424901e4c12827b44d51ef451 |

Raw files under this worktree's artifacts/text-render/ (ignored artifacts are retained locally for parent pickup; do not claim the wisdom contains the full ANSI logs). Each file includes full sync segments/frames, not medians:

| file | bytes | SHA256 |
|---|---:|---|
| send-final-before-1.json | 1112199 | d7cbf83fb2c4b3a4c3637e42897c76028acc8bd7ac88ef4adcc4007842f3a2df |
| send-final-before-2.json | 1112199 | 2d1f5b370b23440e5a1b290283b55435ff7ee62c0cff1a9819df8b1c8af35c50 |
| send-final-before-3.json | 1112200 | 5a12889821edb1f3e0ec275d4e0c14afb571e702d9144e503a7cdf4e6ec6349d |
| short-final-before.json | 14762 | 99b2dda409c4406546498ad20b9694749a7bcbb4d1eafd7b76112b1f08df21bb |
| tool-final-before.json | 201986 | 4c99ee0cb2191fa9608d58880852f5d3c04c2bfc60204aec3c84d132301b6aa8 |
| send-final-after-1.json | 1112172 | eb51d5d995d3bbcd04a0f0413207369fd001989da9d1304e9bfe2ce7b2f733d8 |
| send-final-after-2.json | 1112166 | a5724a2203f187c4c1888482b8a0e0aa81d41c01a2d36b7acee90000f4bf58ff |
| send-final-after-3.json | 1112171 | 4a76ff881df33be16c8bb5a1b6ae8ad036e72cd1afe87ee420f9e815a2b01129 |
| short-final-after.json | 14752 | ba93fffa8c822f54f30b2fac95a5dca91a586b356db47224db269377ec90c2be |
| tool-final-after.json | 201946 | 7239cd25bc146084462410ba1d4d5ebd50f1206213602cb42bc87345416fea49 |
| final-source-manifest.json | 2079 | 339ba6d906d7c18fc027983384de7c7f1d70549b5fc5731493cef9ce06926ab7 |
| final-call-trace.json | 990 | 08997a95650be3f309c951c1d0dea8accd29ef0adc126ee6d609db48769e0425 |
| tool-wrap-trace.json | 1587 | 1ff26540e1457b773325b54b019e9dfa328362e8d118c01e6e0f7eac640545b4 |
| baseline-call-trace.json | 1376 | 9d5533d0ef8bcba96838b019e45110169acdcac6765946fab4e03d9bc8223e0e |

final-summary.json SHA256 d534dcef74a81c072b4cdb93688145a29f728b302312a9202010faa800f3c466. Sampling profiles and provisional experiments are also retained in that directory, but only named final-* and matched call-trace files above are final evidence.

## Boundaries and next work

Large structured paragraphs/possible setext headings intentionally fall back to original regexes to preserve actual rendering, including Bun effort-limit behavior. They can still stall. Tool grapheme wrapping, remaining 80–149 ms large frames, paste, arbitrary render/resize/history, and all-action8ms are open. This patch is the small fix for the measured dominant block-parser stall, not a whole terminal latency victory.

Values unchanged: existing measure-the-actual-work, whole-product proof and honest-gap principles cover these findings. Per request no shared notes edited; the new ownership/reproduction lesson lives here.

## Parent focused review

Read-only task_f2115523 found no differences in 1808 mixed block probes, 16 actual Markdown renders or 8 Mermaid transforms. It found one low-priority export issue: constructor installed base hooks as own methods, suppressing subclass lheading/paragraph overrides. Parent now captures resolved hooks instead and adds an actual Marked subclass regression. Reinstall, prepare:assets, TypeScript and 6 block tests/54318 assertions pass. Current SDK callers were unaffected. Inherited del registration remains a pre-existing SDK limitation; huge structured fallbacks remain open. Values unchanged: existing behavior proof and honest-boundary principles cover the review.
