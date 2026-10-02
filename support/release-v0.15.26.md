# v0.15.26

## Less code, same product features

- Remove dead implementation paths and share task, SSH, Live, web and test plumbing without cutting current product features.
- Retire 24 frozen historical T3 code/config files. Historical replay inputs remain recoverable from Git; the current web integration is unchanged.
- Reduce tracked code/config/test lines by 36,974 overall, while adding regression coverage around maintained behavior.
- Reject invalid unterminated comments and comma-only arrays in JSONC instead of silently repairing them. Valid JSONC remains supported.

Local validation passed: 1,718 root tests, 645 web tests, standalone smoke, and rebuilt-CLI SSH child/root placement acceptance. Release assets are published only after the hosted release gates pass.
