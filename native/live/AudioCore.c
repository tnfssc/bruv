#include "AudioCore.h"
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
typedef struct { int generation, count; int16_t data[LL_PLAY_SAMPLES]; } PlayBlock;
typedef struct { int count, epoch; float data[LL_CAPTURE_SAMPLES]; } CaptureBlock;

typedef enum {
    RENDER_EMPTY,
    RENDER_LAST_SAMPLE,
    RENDER_SAMPLE_PAIR
} RenderWindow;

// Only the render callback owns this cursor. Flush changes the shared generation,
// not callback memory; the callback discards its interpolation window on observing it.
typedef struct {
    int generation;
    int blockOffset;
    int sample, lookahead;
    RenderWindow window;
    double phase;
} PlaybackCursor;

struct LLCore {
    // Command thread produces blocks; render callback consumes them.
    _Atomic unsigned playWrite, playRead;
    _Atomic uint64_t pending; // upper 32 bits: generation; lower 32: queued playback frames
    PlayBlock play[LL_PLAY_BLOCKS];
    PlaybackCursor renderer;

    // Capture callback produces tagged blocks; output queue drains them.
    _Atomic unsigned capWrite, capRead;
    _Atomic unsigned captureDropped;
    _Atomic int captureEpoch;
    _Atomic uint64_t captureCutoff;
    CaptureBlock capture[LL_CAPTURE_BLOCKS];
};
LLCore *ll_create(void) {
    LLCore *c = calloc(1, sizeof(LLCore));
    if (c) atomic_store(&c->captureEpoch, -2);
    return c;
}
void ll_destroy(LLCore *c) { free(c); }
int ll_generation(LLCore *c) { return (int)(atomic_load(&c->pending) >> 32); }
void ll_flush(LLCore *c, int gen) {
    // Only the command thread writes generations. Callback CAS cannot subtract from a new epoch.
    atomic_store(&c->pending, (uint64_t)(unsigned)gen << 32);
}
int ll_play_push_batch(LLCore *c, const int16_t *data, int count, int gen) {
    if (count < 1 || count > LL_PLAY_BLOCKS * LL_PLAY_SAMPLES || gen != ll_generation(c)) return 0;
    unsigned blocks = ((unsigned)count + LL_PLAY_SAMPLES - 1) / LL_PLAY_SAMPLES;
    unsigned w = atomic_load(&c->playWrite), r = atomic_load(&c->playRead);
    if (w-r > LL_PLAY_BLOCKS || blocks > LL_PLAY_BLOCKS - (w-r)) return 0;
    // Single producer; reserve the entire command before publishing any blocks.
    uint64_t old = atomic_load(&c->pending);
    for (;;) {
        if ((int)(old >> 32) != gen) return 0;
        if (atomic_compare_exchange_weak(&c->pending, &old, old + (unsigned)count)) break;
    }
    for (unsigned i=0; i<blocks; ++i) {
        unsigned n = (unsigned)count - i*LL_PLAY_SAMPLES;
        if (n > LL_PLAY_SAMPLES) n = LL_PLAY_SAMPLES;
        PlayBlock *b = &c->play[(w+i) % LL_PLAY_BLOCKS];
        b->generation=gen; b->count=(int)n;
        memcpy(b->data, data+i*LL_PLAY_SAMPLES, n*sizeof(int16_t));
        atomic_store(&c->playWrite, w+i+1);
    }
    return 1;
}
int ll_queued_ms(LLCore *c) {
    unsigned frames = (unsigned)atomic_load(&c->pending);
    return (int)((frames * 1000u + 23999u) / 24000u);
}
static void consumed(LLCore *c, int gen) {
    uint64_t old = atomic_load(&c->pending);
    while ((int)(old >> 32) == gen && (unsigned)old != 0 &&
           !atomic_compare_exchange_weak(&c->pending, &old, old - 1)) { }
}
static int pull_playback_sample(LLCore *c, int *sample) {
    PlaybackCursor *cursor = &c->renderer;
    while (atomic_load(&c->playRead) != atomic_load(&c->playWrite)) {
        unsigned read = atomic_load(&c->playRead);
        PlayBlock *block = &c->play[read % LL_PLAY_BLOCKS];
        if (block->generation != cursor->generation || cursor->blockOffset >= block->count) {
            cursor->blockOffset = 0;
            atomic_store(&c->playRead, read + 1);
            continue;
        }
        *sample = block->data[cursor->blockOffset++];
        consumed(c, cursor->generation);
        return 1;
    }
    return 0;
}

static void reset_interpolation(PlaybackCursor *cursor, int generation) {
    cursor->generation = generation;
    cursor->window = RENDER_EMPTY;
    cursor->phase = 0;
    // Keep blockOffset until pull discards the old block and advances playRead.
}

static void load_lookahead(LLCore *c) {
    PlaybackCursor *cursor = &c->renderer;
    if (pull_playback_sample(c, &cursor->lookahead)) {
        cursor->window = RENDER_SAMPLE_PAIR;
    } else {
        cursor->lookahead = cursor->sample;
        cursor->window = RENDER_LAST_SAMPLE;
    }
}

void ll_render(LLCore *c, float *out, int count, double rate) {
    PlaybackCursor *cursor = &c->renderer;
    int generation = ll_generation(c);
    if (cursor->generation != generation) reset_interpolation(cursor, generation);
    if (rate <= 0) {
        memset(out, 0, (size_t)count * sizeof(float));
        return;
    }
    double step = 24000.0 / rate;
    for (int i = 0; i < count; i++) {
        if (ll_generation(c) != generation) {
            generation = ll_generation(c);
            reset_interpolation(cursor, generation);
        }
        if (cursor->window == RENDER_EMPTY) {
            if (!pull_playback_sample(c, &cursor->sample)) {
                out[i] = 0;
                continue;
            }
            cursor->phase = 0;
            load_lookahead(c);
        }
        // Missing lookahead is not end-of-stream. A packet arriving while the
        // last sample is held can resume interpolation at the same phase.
        if (cursor->window == RENDER_LAST_SAMPLE) load_lookahead(c);
        out[i] = (float)(cursor->sample + (cursor->lookahead - cursor->sample) * cursor->phase) / 32768.0f;
        cursor->phase += step;
        while (cursor->phase >= 1.0) {
            cursor->phase -= 1.0;
            if (cursor->window == RENDER_LAST_SAMPLE) {
                cursor->window = RENDER_EMPTY;
                break;
            }
            cursor->sample = cursor->lookahead;
            load_lookahead(c);
        }
    }
}
void ll_capture_gate(LLCore *c, int epoch, uint64_t cutoff) {
    atomic_store(&c->captureEpoch, -1);
    atomic_store(&c->captureCutoff, cutoff);
    atomic_store(&c->captureEpoch, epoch);
}
int ll_capture_current_epoch(LLCore *c) { return atomic_load(&c->captureEpoch); }
int ll_capture_epoch(LLCore *c, uint64_t origin) {
    int epoch = ll_capture_current_epoch(c);
    if (epoch >= 0 && (origin == 0 || origin < atomic_load(&c->captureCutoff))) return -1;
    return epoch == ll_capture_current_epoch(c) ? epoch : -1;
}
int ll_capture_push(LLCore *c, const float *data, int count) {
    return ll_capture_push_epoch(c, data, count, ll_capture_epoch(c, 0));
}
int ll_capture_push_epoch(LLCore *c, const float *data, int count, int epoch) {
    if (epoch == -1 || epoch != ll_capture_current_epoch(c)) return 0;
    if (count<1 || count>LL_CAPTURE_SAMPLES) { atomic_fetch_add(&c->captureDropped, (unsigned)(count > 0 ? count : 1)); return 0; }
    unsigned w=atomic_load(&c->capWrite), r=atomic_load(&c->capRead);
    if (w-r>=LL_CAPTURE_BLOCKS) { atomic_fetch_add(&c->captureDropped, (unsigned)count); return 0; }
    CaptureBlock *b=&c->capture[w % LL_CAPTURE_BLOCKS];
    b->epoch=epoch; b->count=count; memcpy(b->data,data,(size_t)count*sizeof(float));
    atomic_store(&c->capWrite,w+1); return 1;
}
unsigned ll_capture_dropped(LLCore *c) { return atomic_exchange(&c->captureDropped, 0); }
int ll_capture_pop(LLCore *c, float *out) {
    int epoch;
    return ll_capture_pop_epoch(c, out, &epoch);
}
int ll_capture_pop_epoch(LLCore *c, float *out, int *epoch) {
    unsigned r=atomic_load(&c->capRead);
    if (r==atomic_load(&c->capWrite)) return 0;
    CaptureBlock *b=&c->capture[r % LL_CAPTURE_BLOCKS];
    *epoch=b->epoch;
    int n=b->count; memcpy(out,b->data,(size_t)n*sizeof(float));
    atomic_store(&c->capRead,r+1); return n;
}
int ll_self_test(void) {
    LLCore *c=ll_create(); if (!c) return 0;
    int16_t a[480]; for(int i=0;i<480;i++) a[i]=1234;
    float out[960];
    int ok=ll_play_push_batch(c,a,480,0) && ll_queued_ms(c)==20;
    ll_flush(c,1); ok &= ll_queued_ms(c)==0 && !ll_play_push_batch(c,a,480,0);
    ll_render(c,out,960,48000); for(int i=0;i<960;i++) ok &= out[i]==0;
    ok &= ll_play_push_batch(c,a,480,1);
    ll_render(c,out,960,48000); ok &= out[0]>0 && out[100]>0;
    float cap[1024]={0}, copy[1024]; cap[0]=0.5f;
    ok &= ll_capture_push(c,cap,1024) && ll_capture_pop(c,copy)==1024 && copy[0]==0.5f;
    ll_destroy(c); return ok;
}
