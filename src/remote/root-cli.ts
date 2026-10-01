import { RemoteClient } from "./client";
import { RootClient, type RootTarget, type RootClientOptions } from "./root-client";
import { presentRemoteRoot } from "./root-presenter";
export type RemoteRootCLIOptions = {
  place: string;
  cwd?: string;
  prompt?: string;
  model?: string;
  thinking?: string;
  remoteRepo?: string;
  remoteInclude?: string[];
  workspace?: RootClientOptions["workspace"];
  fresh?: boolean;
  stateDir?: string /** Supplied ONLY by lead's already-authorized named target resolver. */;
  target?: RootTarget;
  remoteClient?: RemoteClient;
};
/** Placement is resolved before normal local startup: no onboarding/model registry/tool/coordinator. */
export async function runRemoteRoot(options: RemoteRootCLIOptions): Promise<void> {
  if (!options.place || options.place === "local")
    throw Error("Remote root startup requires an explicit authorized named target");
  let target = options.target;
  if (target) {
    if (target.name !== options.place) throw Error("Named target mismatch");
  } else {
    const connection = (await (options.remoteClient ?? new RemoteClient()).read()).connection;
    if (!connection || connection.host !== options.place)
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
