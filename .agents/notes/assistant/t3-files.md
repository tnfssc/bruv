---
name: t3-files
description: How the web version gets files, pictures, videos and HTML out of T3 without touching T3's disk, and how it pairs with a T3 on another machine. Found by trying it against T3 0.1.2-nightly.20261021.3457 on 2026-10-29.
---

# Files from T3, and T3 on another machine

Pi (the assistant) and T3 may run on different machines with nothing shared but T3's HTTP origin. So
bruv never reads T3's files from disk; it asks T3 for them.

## Signed links: `assets.createUrl`

An RPC on the app websocket (like `subscribeShell`), needing scope `filesystem:read`:
`{resource: {_tag, ...}}` → `{relativeUrl, expiresAt, sourcePath?, imageDimensions?}`. The link is
`/api/assets/<signed token>/<name>` on T3's origin, needs no key, and lasts about an hour.

- `workspace-file {threadId, path}`: a path relative to the thread's folder (worktree or project
  root); anything outside it is refused (`WorkspacePathOutsideRootError`). Takes pictures, SVG, PDF and
  HTML. HTML gets a link to its folder, so `<img src="shot.png">` next to it loads; `..` gets 404.
- `media-file {threadId, path}`: the same plus video and audio. It resolves `..` and absolute paths
  without the root check, so bruv must not pass such paths.
- `attachment {attachmentId, mimeType: "text/html", disposition: "inline"}`: a page a thread showed
  with `html_render`. Without the mime type it comes as a download. The id is in the thread's activity:
  a `dynamic_tool` item for `html_render` whose output holds `htmlRender.attachmentId`.
- Code, Markdown and other text are refused (`AssetPreviewTypeValidationError`). For those,
  `projects.readFile {cwd, relativePath}` gives `{contents, byteLength, truncated}`, text only
  (`binary_file` otherwise), inside `cwd`.

What T3 sends back: HTML with `content-security-policy: sandbox allow-scripts allow-forms allow-popups
allow-downloads` (an origin of its own, so it can't reach the page that frames it); video with
`accept-ranges` and 206 answers to `Range`; ETags; `access-control-allow-origin: *`.

## Scopes and pairing with a T3 elsewhere

- bruv's session key used `orchestration:read/operate` only; links need `filesystem:read`. T3's
  standard set (`t3 pair` with no `--scope`) has it, and `access:write` too.
- `POST /api/auth/pairing-token {label, scopes?}` with a session that has `access:write` mints a
  pairing token, at most the session's own scopes (no scopes means the standard set, so the session
  must hold all of it). Exchanged at `/oauth/token`, it gives a fresh 30-day session. So once paired,
  bruv can sign in to MCP and renew its own key with no `t3` binary and no ~/.t3, which is what a
  remote T3 needs.
- `t3 pair` prints `Pairing URL: http://host/pair#token=…`; `--tailscale` makes one reachable from
  other machines. That one link is all a remote bruv needs.

## How bruv uses it (built 2026-10-29)

- `show` (`src/web/files.ts`) checks the file when called (T3 makes the link or reads the text, so a
  wrong path fails then, with a reason) and gives a `/file/<ref>.<signature>/<name>` link. The ref says
  where the file is; the signature, made with the page's key, says it was shown. No key in the link:
  an HTML page can read its own address. Links keep working in history, since T3's hour-long links are
  made again on demand and kept until shortly before they run out.
- The shown file is saved as a custom session entry (`bruv-web-show`) and sent as a line at once, not
  taken from the tool result: the model mostly calls `show` from a codemode script, and then the result
  belongs to the script. The first real run lost both files that way.
- The page frames HTML with `sandbox` (no `allow-same-origin`) and the server sends the sandbox CSP too,
  for pages opened in a tab.
- Pairing from a link was checked against the real T3 with an empty `T3CODE_HOME`: feed, MCP (signed in
  with a minted token) and file links all worked. Not tried across two real machines.
- Finding an `html_render` page took the model six steps of reading thread activity; bruv could look it
  up itself if that proves slow.
