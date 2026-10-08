# Official T3 usage contract fixture

Unmodified read-only source copies from official T3 **v0.0.46-nightly.20261005.2702**:

- usageTranscripts.ts.txt: apps/server/src/usage/usageTranscripts.ts, SHA-256 0eef232bab3b9c804ec1ac866901467cf862e4d5a0bc352027d7647c86c318e4
- usagePricing.ts.txt: apps/server/src/usage/usagePricing.ts, SHA-256 f4f3d5d8adf2497239bd5b28ac4548560cfa5db9eadf109e6ba6c9e9e58b0f3d

Inputs supplied for this task: /home/tnfssc/.bruv/cache/t3-unpriced-usageTranscripts.ts and t3-unpriced-usagePricing.ts. These are test fixtures, not a T3 fork or production dependency. Source remains byte-identical. index.ts erases type-only imports with Bun's transpiler and loads the pure exported functions, without installed T3 settings, network, provider calls, or price-table mappings.

Tests send actual written Bruv JSONL through mightCarryUsage and parseClaudeLine, then priceUsage with an empty Map. This exercises the official costUSD -> reportedCostUsd -> providerReported contract independently of Bruv's own implementation. T3 calls the cost source providerReported; Bruv supplies Pi's catalog-priced usage total, not a verified invoice.

Source: https://github.com/pingdotgg/t3code/tree/v0.0.46-nightly.20261005.2702/apps/server/src/usage. Upstream MIT terms and copyright are kept in [LICENSE](LICENSE). These fixtures are tests only and are not embedded in Bruv binaries.
