const dir = process.argv[2];
const events = (await Bun.file(dir + "/before.json").json()).events as Array<any>;
if (events.filter((x) => x.type === "accepted").length !== 1 || events.filter((x) => x.type === "model_turn").length !== 1 || !events.some((x) => x.type === "tool_execution_start") || events.some((x) => x.type === "tool_execution_end" || x.type === "outcome")) throw Error("execute not in flight");

export {};
