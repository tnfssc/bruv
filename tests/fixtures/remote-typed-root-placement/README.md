# Typed remote root placement proof

This NEW fixture is independent of the existing finite-child placement runner.
It tests one server Die/Pi RPC session, with laptop terminal presentation of typed
prompt/abort/jobs/questions facets. It does **not** test a TTY relay. Server SSH
refuses TTYs; only the host uses tmux to automate human keys.

## Run

Use direct Bun 1.4.2, not a mise shim:

~~~sh
export TMPDIR=/home/tnfssc/.die/tmp-pi-removal
BUN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
$BUN test tests/remote-typed-root-placement-fixture.test.ts
$BUN scripts/remote-root-placement-e2e.ts --probe
DIE_BIN=/absolute/path/to/combined/compiled/die $BUN scripts/remote-root-placement-e2e.ts
~~~

DIE_BIN is mandatory outside probe mode. It must combine the lead CLI/extension
wiring, root-owner backend (task_ebba316b, remote/task-placement-root-owner), and
root client (task_8f4236df, remote/task-placement-root-client). No implicit dist/die
candidate is accepted. Do not claim acceptance from probe mode or focused tests.

Default cached base: die-remote-e2e-2434886-5027:latest. Override with
REMOTE_ROOT_PLACEMENT_BASE_IMAGE only for an already-cached local SSH/git image.
Docker builds and containers use network:none; pulls/package installs are absent.
A docker exec byte relay connects the isolated container's loopback SSH socket.
Fake OpenAI inference runs only inside the container. There is no parent inference
server, local model registry/configuration, provider key, real host or WAN access.
The server agent/settings.json selects fixture/typed-root; server subagents.json
selects fixture/typed-root-normal. All apparent API keys are fixture constants.

The only authorization seed is explicitly labelled one-time fixture HUMAN
permission: pinned RemoteClient.connect in a separate temporary-HOME Bun setup
process. The terminal then opens with an empty local agent directory and no local
provider/model configuration. Authorization never comes from fake inference.
Normal first prompt is typed AFTER --place startup; no positional prompt is used.

## Assertions in actual-binary mode

Each of two independent roots receives TWO explicit human prompt commands plus a
real saved-question answer. First prompt executes shell on the server at root
role/depth0, launches a normal depth1 child in a real server worktree (without a
target), and asks a real question after ordinary child completion. The client
opens the normal /questions picker, detaches, reopens WITHOUT --remote-fresh and
checks the same root ID, request ID, pinned owner/epoch, repo, journal and question
ID/owner/version. Human Enter keys choose and answer the question. Saved answer
continues that root; the second explicit prompt must see the first edit. Work
phase logs assert every root/child execution occurred exactly once.

/ps opens the ordinary tasks picker and selected job inspection. /abort is tested
on an idle root without detaching. /close must be authoritatively closed with
exitCode=0 BEFORE any source return. Reopening the closed root may not recapture
source, replay prompts, rerun tools or cumulatively apply the patch again.

Clean scenario uses default tracked dirty source, omits both untracked files and
returns the second edit safely. The local repo has two commits; the transmitted
snapshot and child honestly have one orphan baseline commit, not full history.
The drift scenario starts a fresh root AFTER the first successful source return,
explicitly authorizes --remote-include authorized.txt, and changes local guard.txt
AFTER capture. Return must remain a review patch, preserving local source. That
patch must start from ROOT_RETURN_TWO, not replay ROOT_TRACKED_DIRTY.

Additional acceptance scenarios (not yet run against the combined binary):
- A fixture SSH shim forwards the real ROOT_REPLY_LOSS command, records its real
  successful reply, then discards the bytes with exit 255. It gates status reads
  until a genuine durable local unknown receipt is captured. Detach/reattach must
  reconcile the same command ID via command-status, with exactly one send and one
  server tool execution. No production transport or ledger is edited.
- The same third root launches a 600-second server shell process. Human /ps uses
  inspection, Cancel, and confirmation. Assertions require prior running state,
  successful typed stop, terminal non-success inspection, actual PID disappearance,
  and no natural-finish marker. The root stays running; detach does NOT return source.
- Full-history and worktree CLI requests and conflicting existing-repo/local-source
  choices must fail with specific errors and no root/state/source/inference changes.

The two source-return roots explicitly check local diff and absent outcome after
both first and second turns. Only successful close permits safe/review return.
Remaining gaps stay explicit: owner crash/dispatching-to-unknown is NOT reply-loss
recovery; running shell cancellation is NOT streaming-root abort; CLI rejection
is NOT server protocol rejection. Focused tests are fixture/guard tests, not Docker
or compiled-binary acceptance.

## Artifacts / schema assumptions

Text/JSON only, no video or private keys. Temporary SSH keys/HOME/source/container
and built fixture image are removed in finally. Artifacts survive outside repo;
REMOTE_ROOT_PLACEMENT_ARTIFACTS may select an external directory (symlink-aware
check). Receipt includes source commit/dirty state, binary/Bun SHA256, image ID,
network mode, scenario root IDs, journal paths and question identity. Server fake
request logs, root ledgers/journals/work counts and safe/review patches survive.

Runner reads frontend roots/<session>/root.json (pointer data, intent, commands,
record.sessionFile, original source provenance and outcome). Typed completed
questions.list/jobs.list/jobs.inspect/answer receipts are authoritative. It reads
the SERVER journal through fixture SSH rather than creating a local Pi session.
Receipt paths can be adapted to production layout changes; semantic assertions
must not be weakened. Root close return is terminal, not a claimed live incremental
sync mechanism. Worktree source has orphan history; no full-history promise.
