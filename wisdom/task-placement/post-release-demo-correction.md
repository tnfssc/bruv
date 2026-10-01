# Post-release demo correction

The user objected to debug output in the video after v0.15.19 shipped. Parent approved engineering receipts and a few frames, then called the product demo done. That was wrong. Original clip is withdrawn from PR15 body and comment5932629742; raw captures/provenance stay preserved.

A fresh natural-work capture removed fixture markers but exposed two real product defects. RootTranscript printed tool-call arguments/source and protocol role names by default. It also ignored display:false and showed internal saved-answer JSON in scrollback. A cleaner viewport was not a product fix.

The root presenter now shows readable speakers, action labels and status. Ctrl-O opens successful tool code/output explicitly; failures remain visible by default. Hidden custom messages stay hidden in snapshots, streaming and detail mode, while server inference/context data stays intact. Control authority, command identity, detach and source return are unchanged.

Production tree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_4a76ba31, branch die/fix-raw-diagnostic-rendering-in-placed-r-4a76ba31. Reviewed source1a385eb8859cc9fc9f4792bde24e5b0ae0c6131f. Local native proof dist/die-root-presentation-fixed SHA056580d1688b4787c076cc14e5d430d398b93dbeda416fd2c4cb3aad18ce1695. Bun1.4.2 compiled real cached web archive directly: native UI proof only, not hosted release packaging. Standard packed reuse correctly rejected missing producer manifest; no forged manifest. Nine focused presenter/control tests and prepared-tree typecheck pass.

New capture owner task8cd72a17, tree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_8cd72a17, branch die/capture-corrected-root-ui-with-fixed-pro-8cd72a17. Reuses scoped presentation tooling28d12fc from task66; original capture artifacts remain /home/tnfssc/.die/probes/task-placement-clean-product-video. New fixed-byte take goes in /home/tnfssc/.die/probes/task-placement-fixed-ui-product-video. Parent must inspect normal transcript/action/question/return states, not just menus or a marker regex. Do not upload or call clean yet.

Next: actual capture approval, full hosted CI, merge exact checked head, full patch Release gate, upload checked clip and replace PR demo links. Source/debug fix is not published yet. Value8 already says test real rendered human flows; scoped demo wisdom refines the distinction between engineering evidence and presentation. No new value needed.
