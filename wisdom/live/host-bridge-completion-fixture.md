# Subscribe before the awaited work

CI36874686991 passed Linux but the Mac host-bridge test missed completion. Its tiny process could finish during the awaited ownership checks, before the test registered its listener. The production bridge files are unchanged by placement. Subscribe before the first await, then keep every ownership, confirmation, completion and output assertion. No sleeps or success replay are needed. This helps tests that expect live completion events; late subscribers may intentionally rely on stored inspection instead.
