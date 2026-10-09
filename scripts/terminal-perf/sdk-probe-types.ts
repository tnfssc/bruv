import type {
  AgentSession,
  AgentSessionEvent,
  InteractiveMode,
  SettingsManager,
  ToolDefinition,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import type { Container, Editor, TuiAltScreen } from "@earendil-works/pi-tui";

// Pinned SDK private seams used by the offline profilers.
export type ProbeMethods = Record<string, (...args: unknown[]) => unknown>;
export type ProbeInteractiveMode = Pick<InteractiveMode, "init" | "getUserInput"> & {
  // The offline runner uses the runtime's no-output stop path.
  stop(output: "none"): void;
  renderer: TuiAltScreen;
  editor: Editor;
  editorContainer: Container;
  chatContainer: Container;
  settingsManager: SettingsManager;
  sessionManager: AgentSession["sessionManager"];
  session: AgentSession;
  pendingTools: Map<string, { result?: Parameters<ToolExecutionComponent["updateResult"]>[0] }>;
  handleEvent(event: AgentSessionEvent): Promise<void>;
  showTreeSelector(leafId: string): void;
  handleResumeSession(...args: unknown[]): Promise<unknown>;
  getRegisteredToolDefinition(name: string): ToolDefinition | undefined;
};
