```js
// Read several files at once
const [a, b] = await Promise.all([tools.read({ path: "src/a.ts" }), tools.read({ path: "src/b.ts" })]);

// Edit, then check, in one script
await tools.edit({ path: "src/a.ts", oldText, newText });
return (await tools.bash({ command: "bun test tests/a.test.ts" })).output.slice(-2000);

// Hand separate pieces to agents in their own worktrees, then wait for all of them
const { ids } = await tools.agent({ prompts: files.map((f) => `Fix lint errors in ${f}`), worktree: true });
const { done } = await tools.wait({ ids, all: true });
return done.map((r) => `${r.id} ${r.status}\n${r.answer ?? r.output}`).join("\n\n");
```
