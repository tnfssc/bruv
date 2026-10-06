import {
  type CustomEditor,
  InteractiveMode,
  type KeybindingsManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Container, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { CompactEditor } from "./editor";

/**
 * Keep Pi CLI presentation policy here because Pi has no settings injection
 * hook. One applyOverrides() call is not enough: startup saves and reloads rebuild
 * the settings snapshot. Wrap the public presentation getter instead. Do not
 * change saved preferences, skill discovery, or command registration. Pi still
 * honors --verbose as an explicit diagnostic override.
 */
export function installQuietStartup(): () => void {
  const original = SettingsManager.prototype.getQuietStartup;
  const quiet = () => true;
  SettingsManager.prototype.getQuietStartup = quiet;
  return () => {
    if (SettingsManager.prototype.getQuietStartup === quiet) {
      SettingsManager.prototype.getQuietStartup = original;
    }
  };
}

let activeInteractive: { editor: CustomEditor } | undefined;

/** Read the current editor through the existing InteractiveMode owner, without replacing it. */
export function getActiveCompactEditor(): CompactEditor | undefined {
  const editor = activeInteractive?.editor as CompactEditor | undefined;
  return editor?.bruvCompactEditor && typeof editor.attachPushToTalk === "function" ? editor : undefined;
}

/**
 * Pi 1.0.0 starts painting before awaiting terminal colors and session_start.
 * Replace its not-yet-active default editor before init, rather than installing
 * a custom editor later. Pi must wire startup submit/exit and normal app actions
 * onto this same instance. No terminal start or extension initialization is delayed.
 * This private seam is local to bruv, not a mutation of the installed SDK files.
 */
export function installStartupEditor(): () => void {
  const interactive = InteractiveMode.prototype;
  const nativeInit = interactive.init;
  type StartupSeam = {
    isInitialized: boolean;
    defaultEditor: CustomEditor;
    editor: CustomEditor;
    editorContainer: Container;
    editorComponentFactory?: (tui: TUI, theme: EditorTheme, bindings: KeybindingsManager) => CompactEditor;
    ui: TUI;
    keybindings: KeybindingsManager;
  };
  function compactInit(this: InteractiveMode): ReturnType<typeof nativeInit> {
    const mode = this as unknown as StartupSeam;
    activeInteractive = mode;
    if (!mode.isInitialized && mode.editor === mode.defaultEditor) {
      const previous = mode.defaultEditor;
      const autocompleteMaxVisible = previous.getAutocompleteMaxVisible();
      const factory = (tui: TUI, theme: EditorTheme, bindings: KeybindingsManager) =>
        new CompactEditor(tui, theme, bindings, {
          paddingX: 0,
          autocompleteMaxVisible,
          embedWorkingStatus: true,
        });
      // Reuse Pi's live theme functions, including its select-list styling.
      const theme = (previous as unknown as { theme: EditorTheme }).theme;
      const editor = factory(mode.ui, theme, mode.keybindings);
      editor.setText(previous.getText());
      mode.defaultEditor = editor;
      mode.editor = editor;
      mode.editorContainer.clear();
      mode.editorContainer.addChild(editor);
      // session_start must recognize our editor and not replace it again.
      // Other extensions can still replace it through setEditorComponent.
      mode.editorComponentFactory = factory;
    }
    return nativeInit.call(this);
  }
  interactive.init = compactInit;
  return () => {
    activeInteractive = undefined;
    if (interactive.init === compactInit) interactive.init = nativeInit;
  };
}
