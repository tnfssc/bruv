# Final integrated task-placement video replay

> Historical replay. The user retired `scripts/task-placement-final-video.py`
> on 2026-10-04. Videos, captures and receipts were not deleted. The old
> commands below are provenance, not current run instructions. The renderer
> remains in Git at d898214f71b4131c1bca807824f4fe69420b6992.


The 100-second deliverable is a renderer replay of genuine terminal capture files from the frozen compiled child and root proof runs—not a live recording or synthetic terminal session. Captures remain unchanged source inputs; the renderer crops scrollback to the recorded terminal viewport and discloses the disposable fixture HOME-prefix redaction in its receipt. The timeline preserves the established child-then-root story and actual menus/results. Fixture networking is Docker network:none; inference is fake. The root scenario has no local provider credentials.

Historical recording command (renderer retired):

    python3 scripts/task-placement-final-video.py \
      --freeze /path/to/task-placement-integrated-freeze.json \
      --child /path/to/task-placement-integrated-child \
      --root /path/to/remote-root-placement-artifacts \
      --output /home/tnfssc/.die/probes/task-placement-final-integrated-video

The renderer checks the frozen source commit and binary SHA against both proof receipts (networkMode: none), then records capture paths/hashes, redaction counts, viewport extents, freeze receipt hash, exact binary hash, and resulting MP4 hash/size. Generated video/screens/receipt stay in the durable output directory; do not commit generated files or treat replay as packaged-product, real-provider, or real-host acceptance.

## Presentation correction

This older acceptance replay contains visible fixture/debug jargon and is not a clean product demo. Do not relabel or rewrite its original captures. See [the separate clean product scenario](clean-product-video.md) for newly executed natural work, visible-frame auditing and the remaining offscreen product metadata finding. Parent owns replacement publication.
