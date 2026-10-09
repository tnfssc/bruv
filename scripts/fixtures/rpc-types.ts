/** Fields read by the fixture runners from the CLI's JSON output. */
export type FixtureMessage = {
  role?: string;
  customType?: string;
  content?: string | { type: string; text?: string }[];
};
export type FixtureRpcEvent = {
  type: string;
  id?: string;
  method?: string;
  toolName?: string;
  isError?: boolean;
  error?: string;
  message?: FixtureMessage;
  value?: { id?: string; type?: string; confirmed?: boolean; message?: string };
  data?: { messages?: FixtureMessage[] };
};
export type FixtureTarget = { name: string; authorized: boolean; kind: string };
