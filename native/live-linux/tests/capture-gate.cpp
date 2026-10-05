#include "../CaptureGate.h"
#include <cassert>
int main() {
  CaptureGate gate;
  assert(gate.accepts(0, false)); // continuous unchanged
  gate.set(-1);
  assert(!gate.accepts(100000, true)); // muted, no buffering
  gate.set(0);
  assert(!gate.accepts(100000, true)); // not armed before fresh server snapshot
  gate.arm(6400, 10001); // source/device pipeline has 161 pending samples
  assert(gate.frontier == 6722);
  assert(!gate.accepts(0, true)); // buffered pre-hold samples arriving late
  assert(!gate.accepts(6720, true)); // straddling block is entirely discarded
  assert(!gate.accepts(6722, false)); // unavailable index must fail closed
  assert(gate.accepts(6722, true));
  gate.set(-1);
  assert(!gate.accepts(9000, true));
  gate.set(7);
  assert(!gate.accepts(9000, true)); // old frontier cannot carry into next hold
  gate.arm(12000, 0);
  assert(!gate.accepts(9000, true));
  assert(gate.accepts(12000, true));
  assert(gate.epoch == 7);
}
