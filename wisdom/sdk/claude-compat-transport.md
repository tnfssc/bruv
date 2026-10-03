# Claude-compatible stream transport foundation

Use this note when wiring Bruv's native SDK-compatible entrypoint/engine, not as
proof that CLI launch flags, authentication, model discovery, or engine semantics
are integrated. This change owns transport only.

## Contract and public API

Source: published @anthropic-ai/claude-agent-sdk **0.3.276** `sdk.d.ts` declarations
(`SDKUserMessage`, `SDKControlRequest`, `SDKControlResponse`,
`SDKControlCancelRequest`, `SDKControlPermissionRequest`) and the read-only
native binary spike's `prompt-wire.ndjson`/`interrupt-wire.ndjson`.
No vendor transport implementation was copied.

`src/claude-compat/transport.ts` exports `ClaudeCompatTransport` and a deliberately
small envelope type subset; no dependency on the SDK package is needed.

- Construct with byte-stream `input`/`output`, `onUser(envelope, signal)`,
  and an explicit `controls` method table. Optional diagnostic sink must be
  stderr or a dedicated log stream, never protocol stdout.
- Call `run()` once **before sending/requesting**. Observe its promise; it
  rejects for stream errors, explicit close, or resource-limit shutdown.
- `send(envelope)` emits one NDJSON record, preserving supplied UUIDs/session
  IDs/tool IDs. Await it for ordered write completion and writable drain.
- `request(innerRequest, { signal?, requestId? })` issues a peer control request,
  resolving the correlated success body (`{}` for an absent acknowledgement
  body), or rejecting a peer error/malformed response/EOF/close/abort. A new
  UUID is generated only for locally originated requests lacking an explicit
  request ID. Pending outbound IDs must be unique.
- Aborting a local peer callback emits `control_cancel_request`; incoming peer
  cancellation aborts the matching injected control handler. Late/unknown
  responses do not resurrect callbacks. Listener and pending-map entries are
  removed on settlement. These maps are transient correlation, not a ledger.
- A control handler returns an optional response object, or throws a truthful
  error. Missing methods and malformed correlatable control requests get
  `control_response.response.subtype = "error"` with the original request ID.
  Broken JSON/user frames and unsupported input types without valid control
  correlation are logged only; no invented universal wire error exists.

## Engine responsibilities / lifecycle

Handlers run concurrently: awaiting a permission response must not block reading
that response or an interrupt. **The engine queues user turns and owns control
payload validation, initialize metadata, interrupt/config behavior, permission
policy, outgoing SDK event shapes, and all session/task state.** Returning from
`onUser` should mean the accepted turn has finished emitting output, not merely
that it was placed in an untracked background queue. Honor handler abort signals.
Errors from `onUser` close the transport; the engine should itself emit truthful
SDK result envelopes for ordinary turn failures before returning.

EOF rejects pending peer callbacks and prevents new ones, but drains accepted
handlers and writes (so a finite prompt input can finish). A handler that waits
forever without a peer callback still needs engine-owned cancellation; there is
no speculative timeout. Keep stdin open for interactive permission requests.
`close(error?)` aborts handlers, rejects callbacks/writes and stops/destroys input;
`run()` does not wait forever for a handler that ignores cancellation. Output
is caller-owned: the entrypoint must end/exit it after `run()` or shutdown as
appropriate. EOF normally resolves `run()` and closes transport state. No stream
or transport can be reused for a second run.

Defaults: 8 MiB/frame, 16 MiB queued output, 128 pending peer callbacks, 128
active handlers, configurable by constructor. Frame accumulation uses one
geometrically grown buffer, not an unbounded tiny-fragment metadata list.
Output/frame limits reject writes; pending callback overflow rejects new requests;
active control overflow returns a correlated error; active user overflow and
oversized input terminate the connection rather than silently losing a turn.

## Validation receipt (2026-10-03)

- `bun test tests/claude-compat-transport.test.ts`: 15 tests pass using real Node
  streams and independently authored envelopes matching published/captured shapes.
- Focused strict TypeScript check and Biome check pass; no root dependency install,
  web build, package/build changes, CLI or engine modifications.
- Exact SDK 0.3.276 native `query()` driver against a cache-only Bun executable
  using this transport: initialize, prompt streaming/result, interrupt, and a
  `can_use_tool` callback round-trip all passed. Two runs (prompt/interrupt),
  one permission callback each, zero provider calls. Synthetic captured output
  is fixture-only, including its empty account/models; production transport
  provides no such metadata and makes no account/auth claims.
- Local optional reproduction: `node .cache/transport-sdk-driver.mjs`. This
  scratch fixture imports the read-only spike's installed SDK; it is not a
  committed executable, engine, or dependency. Parent can reproduce in the
  original worktree; cherry-pick verification remains the committed unit tests.

Values stayed unchanged: the local lessons apply the existing principles of
small seams, truthful boundaries, and validating the real consumer; they don't
introduce a new project-wide rule.
