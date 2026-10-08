# v0.15.14

- Remove inherited Pi MCP, codemode, and tool-search built-ins and their CLI/config entries. Die keeps `execute` and jobs as its built-in code/tool path.
- Keep llama.cpp, user extensions, and die’s separate T3 task bridge. No user MCP configuration is deleted.
- Guard the Pi host adaptation against dependency drift and test source and compiled startup with configured MCP servers.
- Fix `die config` receiving session-only system-prompt flags.
