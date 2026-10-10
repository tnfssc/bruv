import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import * as Pi from "@earendil-works/pi-coding-agent";

export async function sdk(
  extensionFactories: Pi.ExtensionFactory[],
  ui?: Partial<Pi.ExtensionUIContext>,
  cwd?: string,
) {
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/sdk-"));
  const faux = fauxProvider();
  const modelRuntime = await Pi.ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
    modelsStorePath: join(dir, "models.json"),
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = Pi.SettingsManager.inMemory({
    defaultTools: ["+codemode"],
    codemode: { mode: "only" },
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const resourceLoader = new Pi.DefaultResourceLoader({
    cwd: cwd ?? dir,
    agentDir: dir,
    settingsManager,
    extensionFactories: [Pi.createCodemodeExtension(), ...extensionFactories],
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await Pi.createAgentSession({
    cwd: cwd ?? dir,
    agentDir: dir,
    modelRuntime,
    model: faux.getModel(),
    resourceLoader,
    settingsManager,
    sessionManager: Pi.SessionManager.create(cwd ?? dir, dir),
  });
  await session.bindExtensions({
    mode: "rpc",
    uiContext: ui ? { ...session.extensionRunner.createContext().ui, ...ui } : undefined,
  });
  return {
    session,
    faux,
    dir,
    async close() {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
