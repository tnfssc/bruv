# Human status recovery visibility

The operation status payload includes repositoryPreparations even when there are no saved tasks. Render both snapshot_incomplete and prepared_not_confirmed_launched with their task ID and local artifact; never print the stored prompt. An incomplete snapshot requires local inspection; a prepared-but-unconfirmed launch requires reconciliation with the pinned owner before retrying the same ID. Do not call this state “No saved tasks” without showing the preparation.

Show saved reply question/reply IDs and cancellation delivery state in task summaries and status. A requested cancellation is local intent, uncertain means delivery needs reconciliation, and confirmed means only that the request was acknowledged. None proves terminal cancellation; sync for terminal task truth. Terminal tasks should be labeled separately rather than presented as pending cancellation.
