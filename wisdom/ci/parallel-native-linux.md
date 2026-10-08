# Required parallel Linux native lane (2026-10-08)

Normal hosted greens 37801969829/e6b49819 and 37773223537/0d8066e4 took
346s and 328s overall. Root tests took 135.9–154.9s. Before them, the private
Pulse/WebRTC fixture took 70–71s (about 49s compiling WebRTC 1.3), plus
3–22s of sanitizers and 21–36s of tooling. These are historical Pi 1.0.3
baselines, not current-head acceptance. The separate 26-minute root stall
is not explained or fixed by moving this prefix.

CI now has one sibling `native-linux` job, gated by the same full plan as
ordinary Linux and macOS. Separate runners let the existing native work overlap
root/resources/build/transport/smoke without competing with resource probes.
The sanitizer and private Pulse steps move unchanged: exact sources, checksum,
compiler flags, helper rebuild, routes, protocol assertions and cleanup ownership.
Meson remains -j2: four hosted CPU slots alone do not prove current -j4 fixtures
safe. No matrix, root-worker change, timeout increase or mutable dependency cache.

The shared installer keeps tmux/ffmpeg for ordinary Linux and release. Its
native-only mode installs just the existing compiler/audio packages. Native CI
needs no Node, Bun or root dependency install. Download-only deb caches have
separate lane keys; installs and checksum checks still execute on cache hits.
Release gates are unchanged.

CI policy must need all three full lanes. Full requires success from each;
docs requires all three skipped. Native failure, cancellation, skipped/missing
full results and failed planning must remain red. Moving checks is not optional
coverage. Focused contracts execute the policy with injected native outcomes;
unchanged step bytes were compared against the prior workflow.

Expected whole-workflow saving is roughly 70–120s minus new-job queue/setup and
ordinary provisioning costs, **not achieved proof**. A focused follow-up PR must
get independent review and hosted current-source greens, verify timeline overlap,
native failure → red policy, docs skips, root completion and unchanged counts,
and measure whole workflow plus total runner seconds. More runners can cost more.
No local native fixture, live audio or full CI was run for this structural split.
Values stay unchanged: cut waiting, not assertions; use owned fixtures; say what
proof actually shows. See [full-path confidence](full-path-simplification.md) and
[fixture tooling](linux-fixture-tooling.md).
