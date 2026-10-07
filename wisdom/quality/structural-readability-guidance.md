# Structural readability guidance

From the user correction and independent REJECT/ACCEPT rounds in the [owner pilot](structural-readability-owner-pilot.md). Use this for broad agent-led readability work, not as thresholds or extra process for every tiny rename.

Start with actual reading problems: which journey makes a reader reconstruct scattered decisions, authorities or lifetimes? Better names help, but do not resolve that burden alone.

Group operations around their authority. In the pilot, answer acceptance, uncertain dispatch and ledger-backed acknowledgement belong together; receipt, command slot and native ledger still have distinct jobs. Keep transport framing separate from semantic decisions. Show the consequences of protocol outcomes where the task is orchestrated.

Make ownership and lifetimes visible: who starts work, observes exit, escalates shutdown, drains persistence and publishes the terminal result? Extract coherent operations with clear effects, not arbitrary blocks behind names or a shared context bag. File ownership helps focus work; it does not prohibit coherent related changes. Coordinate those edits during broad passes.

Tests and coverage support safety, not a readability verdict. Ask an independent reader to judge the actual code and follow the important journeys. Accept rejection of cosmetic-only progress; describe what was accepted and what proof is still missing.
