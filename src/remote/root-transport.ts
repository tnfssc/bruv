import type { RootTransport } from "./root-contract";
import { sshControl } from "./ssh";

export { validHost, validPath } from "./ssh";
export const rootSshTransport: RootTransport = (host, bruvPath, request) =>
  sshControl("--remote-root-control", host, bruvPath, request);
