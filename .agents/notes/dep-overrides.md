---
name: dep-overrides
description: Why package.json overrides undici and minimatch, and when to drop them.
---

Pi 1.1.0 (and 1.4.0, the latest on 2026-11-01) pins `undici@8.10.2` and `minimatch@10.2.6`
exactly. Both have advisories: undici is fixed in 8.12.2, minimatch only in 11.0.1 (its new
matching engine is not backported to 10.x). So root `overrides` force `undici@8.12.3` and
`minimatch@11.0.3`.

This only changes bruv's own dev install and CI. Users run the Pi they installed, so it does not
patch them; that needs a Pi release.

minimatch 11 is a major bump under Pi. Pi calls only `minimatch(path, pattern, { nocase })` (in
`core/model-resolver.js` and `core/package-manager.js`), and v11 keeps that API. Checks and tests
passed with it.

Drop an override once the Pi bruv pins ships a fixed version.
