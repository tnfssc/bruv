# Remote v0.15.7 release

User asked to finish the whole integrated workflow and release, not stop at checkpoints. Integrated worker fb29b8a (tested source afd3a8c) at parent 395ec79. Independent review task_94dcc37d found no confirmed blocker; 20 focused tests passed there, owner test dependency was missing. Parent exact integrated build and full suite passed task_4b268de0: 1261 pass,17 skip,0 fail,29153 assertions. Logs /tmp/die-integrated-parent-{check,build,tests}.log. Build used verified existing web assets; hosted release performs platform gates.

Preparing v0.15.7. No publication claim until workflow succeeds and release assets/source metadata are checked. Remote scope and limits in src/remote/README.md. Worker and branch paths in wisdom/remote-workspaces/integrated-normal-session.md. Values reviewed; unchanged: whole-path checks, explicit grants, durable ownership and honest evidence cover the work.

Pushed f90528d and dispatched https://github.com/tnfssc/die/actions/runs/36334245328. Watch log /tmp/die-v0157-release-watch.log. Await success and verify assets before calling published.

Published: release workflow 36334245328 passed. Verified stable non-draft v0.15.7 with all 12 assets and SOURCE.txt commit f90528d6eba8d4f012aed5a4314d758d62a7b33a. https://github.com/tnfssc/die/releases/tag/v0.15.7 . Hosted gates passed; this does not extend Docker remote evidence to actual Mac/server deployment. No local install performed. Values unchanged after broad review: existing principles cover findings.
