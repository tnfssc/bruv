# v0.15.17

- Fix a resume picker crash caused by cancelling session scans after an invalid session header. Close each scan's file stream on completion, early return, and cancellation so late AbortError events cannot exit die.
- Keep active cancellation and unreadable-file handling intact. Valid saved sessions and their history are unchanged.
