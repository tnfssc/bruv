// Keep the helper's internal operations private to its translation unit; this
// harness exercises them without opening devices or adding a production test API.
#define main liveHelperMain
#include "../main.cpp"
#undef main
#include <cassert>

namespace {
using Result = PlaybackBuffer::AppendResult;

void testEmptyFrames() {
  PlaybackBuffer buffer;
  auto empty = buffer.takeFrame();
  assert(!empty.flush && !empty.hasAudio);
  for (auto byte : empty.bytes) assert(byte == 0);
}

void expectNextRampFrame(PlaybackBuffer& buffer, int firstSample) {
  auto frame = buffer.takeFrame();
  assert(!frame.flush && frame.hasAudio);
  for (int i = 0; i < 240; ++i)
    assert(load(frame.bytes.data() + 2*i) == firstSample + i);
}

void testRingCapacityAndReuse() {
  PlaybackBuffer buffer;
  array<uint8_t, 48000> pcm{}; // One second: samples 0 through 23999 at 24 kHz.
  for (size_t i = 0; i < pcm.size()/2; ++i) store(pcm.data() + 2*i, int16_t(i));
  assert(buffer.append(0, pcm.data(), pcm.size()) == Result::Queued);
  assert(buffer.queuedMs() == 1000);
  assert(buffer.append(0, pcm.data(), 2) == Result::Full);
  assert(buffer.append(1, pcm.data(), 2) == Result::WrongGeneration);
  assert(buffer.queuedMs() == 1000); // Rejections did not mutate or truncate.

  // Free two 10 ms frames, then wrap the tail by appending the same two frames.
  for (int frameIndex = 0; frameIndex < 2; ++frameIndex)
    expectNextRampFrame(buffer, frameIndex*240);
  assert(buffer.append(0, pcm.data(), 960) == Result::Queued);
  for (int frameIndex = 2; frameIndex < 100; ++frameIndex)
    expectNextRampFrame(buffer, frameIndex*240);
  for (int frameIndex = 0; frameIndex < 2; ++frameIndex)
    expectNextRampFrame(buffer, frameIndex*240);
  assert(buffer.queuedMs() == 0);

  // Reuse the drained ring at its advanced head with less than a full frame.
  assert(buffer.append(0, pcm.data(), 2) == Result::Queued);
  auto partial = buffer.takeFrame();
  assert(partial.hasAudio); // A zero-valued real sample is still queued audio.
  for (auto byte : partial.bytes) assert(byte == 0);
  assert(!buffer.takeFrame().hasAudio);
}

void testFlushGenerationAndFramePriority() {
  PlaybackBuffer buffer;
  array<uint8_t, 480> pcm{};
  assert(buffer.append(0, pcm.data(), pcm.size()) == Result::Queued);
  assert(!buffer.flush(0, true));
  assert(buffer.queuedMs() == 10);
  assert(buffer.flush(1, true));
  assert(buffer.queuedMs() == 0);
  assert(buffer.append(0, pcm.data(), pcm.size()) == Result::WrongGeneration);
  assert(buffer.append(1, pcm.data(), pcm.size()) == Result::Queued);
  assert(buffer.takeFrame().flush); // Flush wins, without consuming new audio.
  assert(buffer.queuedMs() == 10);
  assert(!buffer.takeFlush());
  assert(buffer.takeFrame().hasAudio);
}

void testFlushWithoutRenderSpace() {
  PlaybackBuffer buffer;
  assert(buffer.flush(1, true));
  assert(buffer.takeFlush()); // The pump can flush even without rendering space.
  assert(!buffer.takeFlush());
  assert(!buffer.takeFrame().flush);
}

void testClearPreservesGenerationAndDropsPendingFlush() {
  PlaybackBuffer buffer;
  array<uint8_t, 2> pcm{};
  assert(buffer.flush(3, false));
  assert(!buffer.takeFlush()); // No device flush is pending while stopped.
  buffer.clear();
  assert(!buffer.flush(3, true)); // Stop/start must not rewind generations.
  assert(buffer.append(2, pcm.data(), pcm.size()) == Result::WrongGeneration);
  assert(buffer.append(3, pcm.data(), pcm.size()) == Result::Queued);
  assert(buffer.flush(4, true));
  buffer.clear();
  auto cleared = buffer.takeFrame();
  assert(!cleared.flush && !cleared.hasAudio);
}

void testEchoReferencePreservesConstantSignal() {
  array<uint8_t, 480> bytes{};
  for (auto sample : echoReference(bytes)) assert(sample == 0);
  for (int16_t value : {int16_t(-32768), int16_t(1234), int16_t(32767)}) {
    for (int i = 0; i < 240; ++i) store(bytes.data() + 2*i, value);
    for (auto sample : echoReference(bytes)) assert(sample == value);
  }
}
} // namespace

int main() {
  testEmptyFrames();
  testRingCapacityAndReuse();
  testFlushGenerationAndFramePriority();
  testFlushWithoutRenderSpace();
  testClearPreservesGenerationAndDropsPendingFlush();
  testEchoReferencePreservesConstantSignal();
  puts("playback buffer and echo reference OK");
}
