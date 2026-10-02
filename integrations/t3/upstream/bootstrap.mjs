// Loaded with Bun --preload before the unmodified upstream CLI entry.
// Never let interpreter mode leak into Bruv CLI/RPC or terminal children.
delete process.env.BUN_BE_BUN;
