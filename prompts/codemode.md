```js
// Read several files at once
const [a, b] = await Promise.all([tools.read({ path: "src/a.ts" }), tools.read({ path: "src/b.ts" })]);

// Edit, then check, in one script
await tools.edit({ path: "src/a.ts", oldText, newText });
return (await tools.bash({ command: "bun test tests/a.test.ts" })).output.slice(-2000);

// Start agents and wait for all of them
const { ids } = await tools.agent({ prompts: files.map((f) => `Fix lint errors in ${f}`) });
return await tools.wait({ ids, all: true });
```
