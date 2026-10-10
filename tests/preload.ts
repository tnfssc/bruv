delete process.env.BRUV_DEPTH;
delete process.env.BRUV_FAST;
// Never read a real bruv 0.x install from tests.
process.env.BRUV_OLD_HOME = ".tmp/no-bruv-0.x";
