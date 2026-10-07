# Child Fast mode diagnosis

User saw GPT 6.1 Sol High Fast in the parent composer, but only High on a child badge. Checked on 2026-10-07 in t3/inherit-fast-mode.

## What is known

- The live host is 0.0.46-nightly.20261005.2702. Older notes about 2644 are not proof of this host.
- T3 configuration returned effort=high and fastMode=true for both parent d3066c45-5236-41dd-81cb-f938a15d4bea and its child Fix Pi host adaptation hardlink cache writes. Saved child options did not lose Fast.
- This new parent also has fastMode=true in T3. Its Pi session has no native-fast authorization record. The research child has none either.
- The connector source has no fastMode mapping. arguments.ts and binding.ts map reasoning, not Fast. runtime.ts has model and permission controls, but no Fast control.
- CLI job-service.ts passes nativeFastEnabled(ctx) to local/SSH children. That reads effective Pi authorization, not the T3 composer setting.
- Existing child projection carries model and thinking. A missing badge is not proof of provider tier. The exact current external-host badge renderer was not checked.

## Next work

Trace how the current T3 Claude adapter sends Fast options, then bind that input to the existing auth-bound native-fast path. Carry effective Fast status into child projection and labels. Do not just add a Fast label: stored options and actual request tier are different facts. Check the provider payload in a focused test. No live provider tier or billing proof was obtained.

No code fix, push, PR, install or release in this diagnosis. Values unchanged: existing proof-scope and real-path values cover this lesson.
