import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CustomEditor,
  InteractiveMode,
  SettingsManager,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import { Container, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { CompactEditor, IDLE_PROMPT_ICON } from "../src/ui/editor";
import { installQuietStartup, installStartupEditor } from "../src/ui/startup";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

async function fixture(settings: object = {}) {
  const root = await mkdtemp(join(tmpdir(), "bruv-startup-"));
  const agentDir = join(root, "agent");
  await Bun.write(join(agentDir, "settings.json"), JSON.stringify(settings));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return { root, agentDir, path: join(agentDir, "settings.json") };
}

describe("quiet startup", () => {
  test("uses Pi's quietStartup override without changing resource behavior", async () => {
    const { root, agentDir } = await fixture({ quietStartup: false, enableSkillCommands: true });
    const restore = installQuietStartup();
    cleanup.push(restore);

    const manager = SettingsManager.create(root, agentDir);

    expect(manager.getQuietStartup()).toBe(true);
    expect(manager.getEnableSkillCommands()).toBe(true);
  });

  test("does not persist the product override to user settings", async () => {
    const original = { quietStartup: false, skills: ["skills/example"], enableSkillCommands: true };
    const { root, agentDir, path } = await fixture(original);
    const restore = installQuietStartup();
    cleanup.push(restore);

    const manager = SettingsManager.create(root, agentDir);
    expect(manager.getSkillPaths()).toEqual(["skills/example"]);
    manager.setTheme("light");
    await manager.flush();
    await manager.reload();
    expect(manager.getQuietStartup()).toBe(true);

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ...original, theme: "light" });
  });

  test("restores the startup getter for callers and tests", async () => {
    const { root, agentDir } = await fixture();
    const restore = installQuietStartup();
    restore();

    expect(SettingsManager.create(root, agentDir).getQuietStartup()).toBe(false);
  });
});

describe("startup editor", () => {
  const identity = (text: string) => text;
  const theme: EditorTheme = {
    borderColor: identity,
    selectList: {
      selectedPrefix: identity,
      selectedText: identity,
      description: identity,
      scrollInfo: identity,
      noMatch: identity,
    },
  };
  function modeFixture(custom = false) {
    const ui = { terminal: { rows: 24 }, requestRender() {} } as unknown as TUI;
    const keybindings = { matches: () => false } as unknown as KeybindingsManager;
    const defaultEditor = new CustomEditor(ui, theme, keybindings, { autocompleteMaxVisible: 9 });
    defaultEditor.setText("startup draft");
    const editor = custom ? new CustomEditor(ui, theme, keybindings) : defaultEditor;
    const editorContainer = new Container();
    editorContainer.addChild(editor);
    return {
      isInitialized: false,
      ui,
      keybindings,
      defaultEditor,
      editor,
      editorContainer,
      editorComponentFactory: undefined as
        | undefined
        | ((tui: TUI, theme: EditorTheme, bindings: KeybindingsManager) => CompactEditor),
    };
  }

  test("replaces the default before native init wires startup input and paints", async () => {
    const native = InteractiveMode.prototype.init;
    const mode = modeFixture();
    let submitted = "";
    const simulatedInit = async () => {
      // These are the same default-editor ownership operations as Pi init.
      expect(mode.editor).toBe(mode.defaultEditor);
      mode.defaultEditor.onSubmit = (text) => {
        submitted = text;
      };
      mode.isInitialized = true;
      expect(mode.editorContainer.children).toEqual([mode.editor]);
      expect(Bun.stripANSI(mode.editor.render(80)[0]!)).toStartWith(IDLE_PROMPT_ICON + " startup draft");
    };
    InteractiveMode.prototype.init = simulatedInit;
    cleanup.push(() => {
      InteractiveMode.prototype.init = native;
    });
    const restore = installStartupEditor();
    cleanup.push(restore);
    await InteractiveMode.prototype.init.call(mode as unknown as InteractiveMode);
    expect(mode.editor).toBeInstanceOf(CompactEditor);
    expect(mode.editor.getAutocompleteMaxVisible()).toBe(9);
    expect(mode.editorComponentFactory).toBeDefined();
    mode.editor.onSubmit?.(mode.editor.getText());
    expect(submitted).toBe("startup draft");
    const firstEditor = mode.editor;
    await InteractiveMode.prototype.init.call(mode as unknown as InteractiveMode);
    expect(mode.editor).toBe(firstEditor);
    restore();
    expect(InteractiveMode.prototype.init).toBe(simulatedInit);
  });

  test("does not overwrite an editor already selected before init", async () => {
    const native = InteractiveMode.prototype.init;
    InteractiveMode.prototype.init = async () => {};
    cleanup.push(() => {
      InteractiveMode.prototype.init = native;
    });
    const restore = installStartupEditor();
    cleanup.push(restore);
    const mode = modeFixture(true);
    const previous = mode.editor;
    await InteractiveMode.prototype.init.call(mode as unknown as InteractiveMode);
    expect(mode.editor).toBe(previous);
    expect(mode.editorContainer.children).toEqual([previous]);
  });
});
