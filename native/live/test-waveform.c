// Offline regression: packet arrival before the last held source sample is rendered.
// Build/run command and baseline measurements: wisdom/live/gpt-live-crackling-investigation.md.
#include "AudioCore.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>

enum { SOURCE_RATE = 24000, OUTPUT_RATE = 48000, PACKET_SAMPLES = 480 };

static void render_contiguous_reference(const int16_t *pcm, float *output) {
    LLCore *core = ll_create();
    assert(ll_play_push_batch(core, pcm, SOURCE_RATE, 0));
    ll_render(core, output, OUTPUT_RATE, OUTPUT_RATE);
    ll_destroy(core);
}

static void render_early_arriving_packets(const int16_t *pcm, float *output) {
    enum {
        PACKET_FRAMES = PACKET_SAMPLES * OUTPUT_RATE / SOURCE_RATE,
        FIRST_RENDER_FRAMES = (PACKET_SAMPLES - 1) * OUTPUT_RATE / SOURCE_RATE
    };
    LLCore *core = ll_create();
    assert(ll_play_push_batch(core, pcm, PACKET_SAMPLES, 0));
    // Render 958 of 960 frames: the final source sample is held without
    // lookahead. The next packet must arrive before those last two frames.
    ll_render(core, output, FIRST_RENDER_FRAMES, OUTPUT_RATE);
    int rendered_frames = FIRST_RENDER_FRAMES;
    for (int source_offset = PACKET_SAMPLES; source_offset < SOURCE_RATE;
         source_offset += PACKET_SAMPLES) {
        assert(ll_play_push_batch(core, pcm + source_offset, PACKET_SAMPLES, 0));
        ll_render(core, output + rendered_frames, PACKET_FRAMES, OUTPUT_RATE);
        rendered_frames += PACKET_FRAMES;
    }
    // No more packets: finish the two held tail frames to complete one second.
    ll_render(core, output + rendered_frames, OUTPUT_RATE - rendered_frames, OUTPUT_RATE);
    ll_destroy(core);
}

int main(void) {
    // One second of 437 Hz PCM16, rendered at twice the source rate.
    int16_t pcm[SOURCE_RATE];
    float expected[OUTPUT_RATE], actual[OUTPUT_RATE];
    for (int i = 0; i < SOURCE_RATE; i++) {
        pcm[i] = (int16_t)lrint(10000 * sin(2 * 3.141592653589793 * 437 * i / SOURCE_RATE));
    }
    render_contiguous_reference(pcm, expected);
    render_early_arriving_packets(pcm, actual);

    double max_error = 0, squared_error = 0;
    int mismatched = 0;
    for (int i = 0; i < OUTPUT_RATE; i++) {
        double error = fabs(actual[i] - expected[i]);
        if (error) mismatched++;
        if (error > max_error) max_error = error;
        squared_error += error * error;
    }
    printf("one_second_437Hz_20ms_packets mismatched=%d max_error=%.9f rms_error=%.9f\n",
           mismatched, max_error, sqrt(squared_error / OUTPUT_RATE));
    assert(mismatched == 0);
}
