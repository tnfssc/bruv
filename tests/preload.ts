delete process.env.BRUV_DEPTH;
delete process.env.BRUV_FAST;
// Never read a real bruv 0.x install from tests.
process.env.BRUV_OLD_HOME = ".tmp/no-bruv-0.x";
// Keep tests away from the real Pi settings and bruv.json.
process.env.PI_CODING_AGENT_DIR ??= `${process.cwd()}/.tmp/test-agent`;
