# T3 boundaries

- web/launcher.ts prints external, unmodified T3 setup guidance. It does not start
  a server, extract an embedded payload, seed settings or use a startup fallback.
- tasks/ retains the owned native task bridge and server task ownership code.
  Its name is not evidence that it belongs to the obsolete bundled web build.
- archive.ts and integrations/t3/build preserve historical patched-web tooling
  and proof, but are not final build/install/CI dependencies or startup paths.

See wisdom/claude-compat/external-t3-setup.md for the paired connector, absolute
paths, shared Bruv auth/resources, isolated SDK home, exact genuine model IDs
and manual updates. Packaging does not establish native parity.
