# Editor Space voice input

Worktree: /home/tnfssc/.bruv/worktrees/t3-7231ab8c-5442693331ce-task_fc432d67
Owned: src/ui/editor.ts, src/live/editor-push-to-talk.ts, two new input test files.
Parent owns LiveRun/capture epochs, provider gates, history and presentation.

## Decisions and source

Read parent wisdom/live/voice-cli-research/findings.md and wisdom/values.md in /home/tnfssc/.t3/worktrees/bruv/t3-7231ab8c.
Tap Space stays typed in the existing editor. Only repeated Space starts speaking. No custom panel, command fallback or replacement editor. Enter/Backspace keep normal editing semantics.

Inspected installed, patched Pi 1.0.3 sources: TuiBase.setFocusInternal writes focused=false synchronously; raw listeners precede release filtering; wantsKeyRelease opts the component in. Editor.insertCharacter gives each Space its own undo snapshot. Editor.setText would lose cursor/paste registry, so warmup rollback uses the existing undo method, guarded by exact draft/cursor, not setText or synthetic Backspace. Existing spaces/pastes/undo remain intact.

Two deliberately narrow private SDK seams are covered by real-editor tests: undo(), and inputListeners Set order. Fullscreen's earlier handleViewportInput listener consumes focus-in, mouse, search and scrolling. Merely using onTerminalInput at the tail was unsafe; the attached observer is moved to the front, preserving everyone else's relative order. No SDK edits or general input framework.

Negotiated Kitty requests flags 15 while attached, then pops. Space release (even changed modifiers) closes synchronously. A press timer never starts audio. Legacy inference: >=3 Space packets, >=350ms span, <=100ms latest gap; first repeat delay <=1200ms. Slow earlier taps are not removed. Capture closes after 250ms repeat inactivity, also bounding missing explicit-release routing. This is inferred inactivity, NOT observed key-up. Very slow repeat settings may not activate or may mute while still held; rapid intentional repeated Spaces can resemble legacy holds. Real terminal acceptance remains required.

Focus loss, other focused UI, any non-Space input (including consumed viewport events), mouse, paste, navigation, programmatic editor mutation and abort mute without deleting pending tap text. Repeat packets alone cannot restart a canceled explicit hold. Raw observer never consumes other components' Space.

## Parent integration

Use the EXISTING CompactEditor instance. ctx.ui.getEditorComponent() returns a FACTORY, not that instance. Do not call setEditorComponent for Live attach: SDK replacement migrates text only, not cursor/undo/pastes.

Suggested diff in parent-owned src/ui/startup.ts (not applied here):

```diff
@@
-export function installStartupEditor(): () => void {
+let activeInteractive: { editor: CustomEditor } | undefined;
+export function getActiveCompactEditor(): CompactEditor | undefined {
+  const editor = activeInteractive?.editor as CompactEditor | undefined;
+  return editor?.bruvCompactEditor && typeof editor.attachPushToTalk === "function" ? editor : undefined;
+}
+
+export function installStartupEditor(): () => void {
@@
   function compactInit(this: InteractiveMode): ReturnType<typeof nativeInit> {
     const mode = this as unknown as StartupSeam;
+    activeInteractive = mode;
@@
   return () => {
+    activeInteractive = undefined;
     if (interactive.init === compactInit) interactive.init = nativeInit;
```

This reads the CURRENT editor from the already-owned InteractiveMode seam, including later replacements; it does not install a singleton editor or a new screen.

Inside LiveRun after voice session is ready and initially muted:

```ts
const editor = getActiveCompactEditor();
if (!editor) { /* parent decides unavailable-editor presentation */ return; }
this.detachInput = editor.attachPushToTalk(this.ctx.ui, {
  signal: this.controller.signal,
  onTalking: (talking) => this.setTalking(talking),
  onHint: (hint) => this.ctx.ui.setStatus("live-input", hint),
});
```

Remove openPushToTalk from that path. Abort on session stop/switch, and call detachInput in teardown too (idempotent). Existing setTalking owns mic/send gate and audio-turn epochs; this module knows neither provider nor capture. Hint clearing on detach is automatic. Renderer mode replacement rebinds SDK extension listeners, losing their priority: stop/detach active voice before replacement or explicitly reattach afterward; this hook doesn't own renderer lifecycle.

## Proof and gaps

Bun 1.4.2 explicit path used; frozen install + prepare-assets; no trust or credential changes.
31 focused tests pass: editor-push-to-talk, editor-voice-integration, editor, fullscreen-editor. Integration uses real TuiMainScreen AND TuiAltScreen raw-input routing, release filtering, focus changes and CompactEditor; only terminal drawing is disabled. tsc --noEmit, owned-file Biome check and git diff --check pass.
No microphone/device, provider, paid calls, terminal multiplexer, real OS repeat timing, or end-to-end LiveRun test. Parent must wire shared history/spoken replies and validate the actual terminal flow. No edits to extension/transcript/main-owner files.
Values unchanged: this implements existing value #8's real-input-model requirement, rather than adding a new general lesson.
