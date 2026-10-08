# PR45 notice fixture after Pi1.1

Linux run37820173264 failed only the pinned-license fallback fixture. The generator correctly pins1.1.0 after the upstream upgrade; this PR-added fixture still constructed1.0.3 and expected its fallback. CIpolicy failure followed Linux; macOS passed.

Changed three literals in that one positive fixture to1.1.0: declareddependency, installedpackage and expectednotice. Packaged-notice precedence retains its older-version fixture because packaged licenses do not depend on fallback eligibility. No generator/package/guard/assertion/gate change.

Red/green: whole focused generate-third-party-notices.test.ts invocation failed before and passed after. Exact argv/clearedenv/logs: /home/tnfssc/.bruv/agent/watchers/pr45-notice-fixture-Z9M1m0. Existingcleanup only acquiredfixture roots; no install/build/liveprovider orrealconfig use. This is fixturealignment, not a productbehavior fix. Full hostedCI remains required; earlier compiled0.16.19 proof retains unchangedproductbytes.

Freshowner /home/tnfssc/.bruv/worktrees/pr45-notice-fixture-owner-20261008, branchbruv/pr45-notice-fixture-pin, base53d97ec4. Parent owns independent review and normalPRupdate. No merge/release. Valuesunchanged: existing pinnedcontract and honestproof guidance applies.
