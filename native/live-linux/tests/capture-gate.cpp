#include "../CaptureGate.h"
#include <cassert>

static void continuousCaptureDoesNotRequireTiming() {
  CaptureGate gate;
  assert(gate.accepts(0, false));
}

static void holdStartsBeyondDeviceBacklog() {
  CaptureGate gate;
  gate.set(-1);
  assert(!gate.accepts(100000, true)); // muted, no buffering
  gate.set(0);
  assert(!gate.accepts(100000, true)); // wait for a fresh server snapshot

  // At 16 kHz, 10001 us rounds up to 161 pending PCM16 samples (322 bytes).
  gate.arm(6400, 10001);
  assert(gate.frontier == 6722);
  assert(!gate.accepts(0, true)); // pre-hold data can arrive after arming
  assert(!gate.accepts(6720, true)); // discard the whole straddling block
  assert(!gate.accepts(6722, false)); // unknown/corrupt read index fails closed
  assert(gate.accepts(6722, true)); // the frontier itself is eligible
}

static void newHoldRequiresNewSnapshot() {
  CaptureGate gate;
  gate.set(0);
  gate.arm(6400, 10001);
  assert(gate.accepts(9000, true)); // beyond the first hold's frontier

  gate.set(-1);
  assert(!gate.accepts(9000, true));
  gate.set(7);
  assert(!gate.accepts(9000, true)); // old frontier cannot authorize this hold

  gate.arm(12000, 0);
  assert(!gate.accepts(9000, true)); // now reject against the new frontier
  assert(gate.accepts(12000, true));
  assert(gate.epoch == 7);
}

int main() {
  continuousCaptureDoesNotRequireTiming();
  holdStartsBeyondDeviceBacklog();
  newHoldRequiresNewSnapshot();
}
