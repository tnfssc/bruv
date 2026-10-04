const [a, b] = await Promise.all(process.argv.slice(2).map((p) => Bun.file(p).json()));
if (a.identity !== b.identity || b.epoch !== a.epoch + 1 || b.phase !== "done")
  throw Error("restart continuity failed: " + JSON.stringify({ a, b }));
console.log("restart identity retained, epoch incremented; completed outcome retained");
export {};
