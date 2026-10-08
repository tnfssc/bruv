#include "AudioCore.h"
#include <assert.h>
#include <stdio.h>

// Packet boundaries must not change the output of contiguous PCM. Each schedule
// gets its own cores, so neither a prior render nor a flush supplies the baseline.
static void assert_packet_matches_contiguous(const int16_t *samples, int count,
                                             double rate, int framesBeforeArrival) {
    LLCore *whole = ll_create(), *split = ll_create();
    assert(whole && split);
    float expected[64], actual[64];
    assert(ll_play_push_batch(whole, samples, count, 0));
    ll_render(whole, expected, 64, rate);
    assert(ll_play_push_batch(split, samples, 2, 0));
    ll_render(split, actual, framesBeforeArrival, rate);
    assert(ll_play_push_batch(split, samples + 2, count - 2, 0));
    ll_render(split, actual + framesBeforeArrival, 64 - framesBeforeArrival, rate);
    for (int i = 0; i < 64; ++i) assert(actual[i] == expected[i]);
    assert(ll_queued_ms(split) == 0);
    ll_destroy(whole);
    ll_destroy(split);
}

static void test_packet_arrival_at_rates(void) {
    const double rates[] = {24000, 44100, 48000, 96000};
    const int16_t ramp[] = {0, 10000, 20000, 30000, 20000, 10000, 0, -10000};
    for (unsigned r = 0; r < sizeof(rates) / sizeof(rates[0]); ++r) {
        // Arrive after the first source sample's output, before the tail drains.
        int framesBeforeArrival = (int)(rates[r] / 24000.0);
        if (framesBeforeArrival * 24000 < rates[r]) ++framesBeforeArrival;
        assert_packet_matches_contiguous(ramp, 8, rates[r], framesBeforeArrival);
    }
}

static void test_packet_arrival_during_held_sample(void) {
    const int16_t ramp[] = {0, 10000, 20000, 30000};
    assert_packet_matches_contiguous(ramp, 4, 48000, 2); // before the held sample
    assert_packet_matches_contiguous(ramp, 4, 48000, 3); // halfway through it
}

static void test_flush_starved_tail_at_rates(void) {
    const double rates[] = {24000, 44100, 48000, 96000};
    const int16_t old[] = {0, 10000};
    const int16_t fresh[] = {-7000, -11000};
    for (unsigned r = 0; r < sizeof(rates) / sizeof(rates[0]); ++r) {
        LLCore *core = ll_create();
        assert(core);
        float output[64];
        int framesBeforeFlush = (int)(rates[r] / 24000.0);
        if (framesBeforeFlush * 24000 < rates[r]) ++framesBeforeFlush;
        assert(ll_play_push_batch(core, old, 2, 0));
        ll_render(core, output, framesBeforeFlush, rates[r]);
        ll_flush(core, 1);
        ll_render(core, output, 64, rates[r]);
        for (int i = 0; i < 64; ++i) assert(output[i] == 0);
        assert(!ll_play_push_batch(core, old, 2, 0));
        assert(ll_play_push_batch(core, fresh, 2, 1));
        ll_render(core, output, 64, rates[r]);
        assert(output[0] == fresh[0] / 32768.f);
        for (int i = 16; i < 64; ++i) assert(output[i] == 0);
        assert(ll_queued_ms(core) == 0);
        ll_destroy(core);
    }
}

// Flush must discard both a partially consumed pair and a fractional last sample.
// The fresh packet sits behind old ring data in the pair case.
static void assert_flush_discards_window(int queuedSamples, int renderedFrames) {
    LLCore *core = ll_create();
    assert(core);
    int16_t old[480];
    for (int i = 0; i < 480; ++i) old[i] = 24000;
    float output[8];
    assert(ll_play_push_batch(core, old, queuedSamples, 0));
    ll_render(core, output, renderedFrames, 48000);
    assert(output[renderedFrames - 1] == 24000.f / 32768.f);

    ll_flush(core, 1);
    assert(ll_queued_ms(core) == 0);
    assert(!ll_play_push_batch(core, old, queuedSamples, 0));
    int16_t fresh[] = {-8000, -16000, -24000};
    assert(ll_play_push_batch(core, fresh, 3, 1));
    ll_render(core, output, 8, 48000);
    const int16_t expected[] = {-8000, -12000, -16000, -20000, -24000, -24000, 0, 0};
    for (int i = 0; i < 8; ++i) assert(output[i] == expected[i] / 32768.f);
    assert(ll_queued_ms(core) == 0);
    ll_destroy(core);
}

static void test_full_playback_ring_flush(void) {
    LLCore *core = ll_create();
    assert(core);
    int16_t samples[480] = {1};
    for (int i = 0; i < LL_PLAY_BLOCKS; ++i) assert(ll_play_push_batch(core, samples, 480, 0));
    assert(!ll_play_push_batch(core, samples, 480, 0));
    ll_flush(core, 1);
    assert(ll_queued_ms(core) == 0);
    float output[960];
    ll_render(core, output, 960, 48000);
    for (int i = 0; i < 960; ++i) assert(output[i] == 0);
    ll_destroy(core);
}

static void test_capture_overflow_and_drop_reporting(void) {
    LLCore *core = ll_create();
    assert(core);
    float input[1024] = {0}, copy[1024];
    for (int i = 0; i < LL_CAPTURE_BLOCKS; ++i) assert(ll_capture_push(core, input, 1024));
    assert(!ll_capture_push(core, input, 1024));
    for (int i = 0; i < LL_CAPTURE_BLOCKS; ++i) assert(ll_capture_pop(core, copy) == 1024);
    assert(ll_capture_pop(core, copy) == 0);
    assert(ll_capture_dropped(core) == 1024);

    // Reading the drop count resets it; draining also made room for new capture.
    for (int i = 0; i < LL_CAPTURE_BLOCKS; ++i) assert(ll_capture_push(core, input, 1024));
    assert(!ll_capture_push(core, input, 1024));
    assert(ll_capture_dropped(core) == 1024);
    assert(ll_capture_dropped(core) == 0);
    ll_destroy(core);
}

static void test_short_packet_tail_and_restart(void) {
    LLCore *core = ll_create();
    assert(core);
    const int16_t tail[] = {8000, 16000, 24000};
    const int16_t expected[] = {8000, 12000, 16000, 20000, 24000, 24000, 0, 0, 0, 0, 0, 0};
    float output[12];
    for (int packet = 0; packet < 2; ++packet) {
        // Queue duration counts frames, not a fixed 20ms for this short block.
        assert(ll_play_push_batch(core, tail, 3, 0));
        assert(ll_queued_ms(core) == 1);
        ll_render(core, output, 12, 48000);
        // The final sample survives interpolation, then starvation yields silence.
        // The second packet must restart without carrying the previous phase.
        for (int i = 0; i < 12; ++i) assert(output[i] == expected[i] / 32768.f);
        assert(ll_queued_ms(core) == 0);
    }
    ll_destroy(core);
}

static void test_flush_reclaims_playback_capacity(void) {
    LLCore *core = ll_create();
    assert(core);
    int16_t samples[480] = {1};
    const int16_t tail[] = {8000, 16000, 24000};
    assert(ll_play_push_batch(core, samples, 480, 0));
    ll_flush(core, 1);
    assert(ll_queued_ms(core) == 0);
    assert(!ll_play_push_batch(core, tail, 3, 0));
    float output[12];
    ll_render(core, output, 12, 48000);
    for (int i = 0; i < 12; ++i) assert(output[i] == 0);
    // Rendering discarded the stale ring data, so a full new command now fits.
    int16_t huge[LL_PLAY_BLOCKS * LL_PLAY_SAMPLES] = {0};
    assert(ll_play_push_batch(core, huge, LL_PLAY_BLOCKS * LL_PLAY_SAMPLES, 1));
    assert(!ll_play_push_batch(core, tail, 3, 1));
    assert(ll_queued_ms(core) == 1000);
    ll_destroy(core);
}

int main(void) {
    assert(ll_self_test());
    test_full_playback_ring_flush();
    test_short_packet_tail_and_restart();
    test_packet_arrival_at_rates();
    test_packet_arrival_during_held_sample();
    test_flush_reclaims_playback_capacity();
    test_flush_starved_tail_at_rates();
    assert_flush_discards_window(480, 1); // partial old block, interpolation pair
    assert_flush_discards_window(2, 3); // exhausted ring, last sample at phase 0.5
    test_capture_overflow_and_drop_reporting();
    puts("core tests passed");
    return 0;
}
