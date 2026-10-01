import { RemoteClient } from "./client";
import { RootClient, type RootTarget, type RootClientOptions } from "./root-client";
import { presentRemoteRoot } from "./root-presenter";
export type RemoteRootCLIOptions = {
  place: string;
  cwd?: string;
  prompt?: string;
  model?: string;
  thinking?: string;
  projectTrusted?: boolean;
  remoteRepo?: string;
  remoteInclude?: string[];
  workspace?: RootClientOptions["workspace"];
  fresh?: boolean;
  stateDir?: string /** Supplied ONLY by lead's already-authorized named target resolver. */;
  target?: RootTarget;
  remoteClient?: RemoteClient;
};
export function assertRootStartupContext(env: NodeJS.ProcessEnv = process.env): void {
  const depth = Number(env.DIE_SUBAGENT_DEPTH ?? "0");
  if (!Number.isSafeInteger(depth) || depth !== 0 || env.T3_MCP_URL || env.T3_MCP_BEARER_TOKEN)
    throw Error(
      "Main-agent placement cannot reset a delegated/scoped agent role or depth; use normal subagent placement",
    );
}
/** Placement is resolved before normal local startup: no onboarding/model registry/tool/coordinator. */
export async function runRemoteRoot(options: RemoteRootCLIOptions): Promise<void> {
  assertRootStartupContext();
  if (!options.place || options.place === "local")
    throw Error("Remote root startup requires an explicit authorized named target");
  let target = options.target;
  if (target) {
    if (target.name !== options.place) throw Error("Named target mismatch");
  } else {
    const connection = (await (options.remoteClient ?? new RemoteClient()).read()).connection;
    if (!connection || (connection.host === "local" ? "ssh:local" : connection.host) !== options.place)
      throw Error("Place is not the authorized pinned SSH target; connect/authorize the named target first");
    target = {
      name: options.place,
      host: connection.host,
      diePath: connection.diePath,
      ownerId: connection.hello.ownerId,
      epoch: connection.hello.epoch,
    };
  }
  const client = await RootClient.open({ ...options, cwd: options.cwd ?? process.cwd(), target });
  const state = client.read();
  process.stdout.write("Root placement: " + target.name + " · " + state.sourceLabel + "\n");
  if (state.source?.omittedUntracked.length)
    process.stdout.write(
      "Untracked omitted: " + state.source.omittedUntracked.join(", ") + " (explicit --remote-include required)\n",
    );
  await client.ensureCreated();
  // Observation/reconciliation happens inside the presentation; offline reconnect still opens its saved view.
  await presentRemoteRoot(client, { prompt: options.prompt });
}
