import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { BROWSER_INPUT_MARKER, browserInputReport } from "./browser-protocol";

/** Private input labels arrive before keys. Reset only at real editor boundaries. */
export function createBrowserRequestInput() {
  let attached: CustomEditor | undefined;
  let author: string | undefined;
  let mixed = false;
  let ticket: string | undefined;
  let label: { author: string; ticket?: string } | undefined;
  const apply = () => {
    if (!label) return;
    if (label.author === "-" || (author && author !== label.author)) mixed = true;
    author ??= label.author;
    if (label.ticket) ticket = label.ticket;
  };
  let submitted: string | undefined;
  const clear = () => {
    author = undefined;
    mixed = false;
    ticket = undefined;
  };
  return {
    observe(data: string) {
      if (!data.startsWith(BROWSER_INPUT_MARKER)) {
        if (!browserInputReport(data)) apply();
        return;
      }
      const match = /^([a-f0-9]{32}|-):([a-f0-9]{32})?$/.exec(data.slice(BROWSER_INPUT_MARKER.length, -1));
      if (!match || !data.endsWith("\x07")) mixed = true;
      else {
        label = { author: match[1], ticket: match[2] };
        apply();
      }
      return { consume: true };
    },
    /** Wrap the shipped editor, keeping its text, shortcuts and submit binding. */
    attach(editor: CustomEditor) {
      attached = editor;
      let handling = false;
      let onSubmit = editor.onSubmit;
      const descriptor = Object.getOwnPropertyDescriptor(editor, "onSubmit");
      const originalHandleInput = editor.handleInput;
      const originalSetText = editor.setText;
      Object.defineProperty(editor, "onSubmit", {
        configurable: true,
        get: () => (text: string) => {
          submitted = mixed ? undefined : ticket;
          clear();
          return onSubmit?.(text);
        },
        set: (callback: typeof editor.onSubmit) => {
          onSubmit = callback;
        },
      });
      const handleInput = editor.handleInput.bind(editor);
      editor.handleInput = (data) => {
        handling = true;
        try {
          handleInput(data);
        } finally {
          handling = false;
          if (!editor.getText()) clear();
        }
      };
      const setText = editor.setText.bind(editor);
      editor.setText = (text) => {
        setText(text);
        if (!handling && !text) clear();
      };
      return () => {
        Object.defineProperty(editor, "onSubmit", { ...descriptor, value: onSubmit });
        editor.handleInput = originalHandleInput;
        editor.setText = originalSetText;
        clear();
        label = undefined;
        submitted = undefined;
        attached = undefined;
      };
    },
    take(editor: CustomEditor | undefined): string | undefined {
      const request = editor && editor === attached ? submitted : undefined;
      submitted = undefined;
      return request;
    },
  };
}
