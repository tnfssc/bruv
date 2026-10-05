#ifndef LIVE_AUDIO_CORE_H
#define LIVE_AUDIO_CORE_H
#include <stdint.h>
#define LL_PLAY_BLOCKS 50
#define LL_CAPTURE_BLOCKS 16
#define LL_PLAY_SAMPLES 480
#define LL_CAPTURE_SAMPLES 1024
typedef struct LLCore LLCore;
LLCore *ll_create(void);
void ll_destroy(LLCore *core);
int ll_play_push_batch(LLCore *core, const int16_t *samples, int count, int generation);
void ll_flush(LLCore *core, int generation);
int ll_generation(LLCore *core);
int ll_queued_ms(LLCore *core);
void ll_render(LLCore *core, float *out, int count, double output_rate);
// -2 is continuous, -1 muted, otherwise the hold epoch (nonnegative int32).
// origin/cutoff use the platform monotonic host clock. Whole buffers crossing
// an opening boundary are discarded, never relabeled as the new hold.
void ll_capture_gate(LLCore *core, int epoch, uint64_t cutoff);
int ll_capture_current_epoch(LLCore *core);
int ll_capture_epoch(LLCore *core, uint64_t origin);
int ll_capture_push_epoch(LLCore *core, const float *samples, int count, int epoch);
int ll_capture_pop_epoch(LLCore *core, float *samples, int *epoch);
int ll_capture_push(LLCore *core, const float *samples, int count);
unsigned ll_capture_dropped(LLCore *core);
int ll_capture_pop(LLCore *core, float *samples);
int ll_self_test(void);
#endif
