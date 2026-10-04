# v0.16.7

- Fix false provider failures after a successful automatic retry. Recovered socket errors no longer mark a later successful response as failed.
- Keep genuine provider failures, interruptions, aborted responses, connector failures, and output delivery errors visible.

This fixes error classification, not the underlying network disconnect. Existing failed run records are unchanged. Restart provider sessions after updating to use the new code.
