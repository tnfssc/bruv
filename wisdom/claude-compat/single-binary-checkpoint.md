# Single binary and simple provider setup

User confirmed the installed connector works after absolute provider paths/full model ID. Now asks for a compatibility version to remove T3's range warning, derived defaults so provider env overrides are optional, and one big binary with a tiny launcher.

Chosen interfaces: normal bruv --version stays product semver. Native connector --version advertises Claude compatibility2.1.280 and clearly names Bruv/product version. New --bruv-version returns bruv-claude-compat plus product semver for machine checks. Compatibility version is not account/auth/model identity. User explicitly approves this protocol-facing version policy; previous wisdom rejecting it is historical.

Main binary will expose bruv claude-compat. Retain bruv-claude-compat executable path as a small launcher using exec, not another compiled runtime. Platform shebang/argv/stdin/signal behavior needs tests. Default agent home becomes homedir()/.bruv/agent; default normal binary derives from installed location. Explicit overrides remain supported. SDK provider homePath still needs to align with upstream history access; do not pretend default child env fixes old parent SDK fork.

Owners:
- task_32125da3, /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_32125da3, branch bruv/replace-duplicate-connector-binary-with--32125da3: main dispatch/build/launcher/install/update/release shape. Can delegate independent review.
- task_b189315a, /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_b189315a, branch bruv/add-claude-compatibility-version-and-zer-b189315a: connector version/defaults/provider setup and UI version proof.

Important migration constraint:0.16.3 updater compares the complete connector --version string to bruv-claude-compat plus release version. A compatibility-first version cannot satisfy that exact old check. Do not add hidden staging-path-dependent identity. Need explicit verified upgrade path or documented safe manual paired installation. No current user's binaries/settings have been changed.

Parent must integrate, check real T3 profile selection/chat without warning and BRUV provider env overrides, test normal CLI plus real child launches and paired update behavior, then report size and remaining limits. No new release promised yet. Values unchanged: existing-home reuse, clear identity and actual installed-path proof already cover this work.
