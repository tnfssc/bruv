#ifndef LIVE_CAPTURE_GATE_H
#define LIVE_CAPTURE_GATE_H
#include <cstdint>

// Pulse record read/write indices are byte positions, not callback receive times.
// Every opening first requests a fresh server timing snapshot while discarding.
// The frontier includes source latency (samples acquired but not delivered yet).
// Reject whole buffers that start before it, including straddling buffers.
struct CaptureGate {
  int epoch = -2; // continuous=-2, muted=-1, otherwise hold epoch
  bool armed = false;
  int64_t frontier = 0;
  void set(int value) { epoch = value; armed = false; frontier = 0; }
  void arm(int64_t writeIndex, uint64_t sourceUsec) {
    const int64_t pendingSamples = int64_t(sourceUsec / 1000000) * 16000 +
        int64_t((sourceUsec % 1000000 * 16000 + 999999) / 1000000);
    frontier = writeIndex + pendingSamples * 2;
    armed = true;
  }
  bool accepts(int64_t readIndex, bool valid) const {
    return epoch == -2 || (epoch >= 0 && armed && valid && readIndex >= frontier);
  }
};
#endif
