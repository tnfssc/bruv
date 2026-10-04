const x = await Bun.file(process.argv[2]).json();
if (
  !x.offline ||
  x.fullToolResults !== 2 ||
  x.transcript.filter((e: any) => e.type === "model_turn").length !== 3 ||
  !x.transcript.some((e: any) => e.type === "outcome" && e.data.state === "done")
)
  throw Error("client disconnect did not preserve full remote result");
console.log("Offline replica after client absence: 3 model turns, 2 tools, done");
export {};
