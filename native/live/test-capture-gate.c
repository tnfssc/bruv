#include "AudioCore.h"
#include <assert.h>
int main(void) {
    LLCore *c = ll_create();
    float samples[1024] = {0.75f}, out[1024];
    int epoch;
    assert(ll_capture_push(c, samples, 1024));
    ll_capture_gate(c, -1, 100);
    assert(ll_capture_epoch(c, 200) == -1);
    assert(!ll_capture_push_epoch(c, samples, 1024, -1));
    assert(ll_capture_pop_epoch(c, out, &epoch) == 1024 && epoch == -2);
    ll_capture_gate(c, 0, 1000);
    assert(ll_capture_epoch(c, 0) == -1); // unknown timestamp
    assert(ll_capture_epoch(c, 999) == -1); // pre-hold buffer arrives during hold
    assert(ll_capture_epoch(c, 1000) == 0);
    assert(ll_capture_push_epoch(c, samples, 1024, 0));
    ll_capture_gate(c, -1, 2000);
    assert(!ll_capture_push_epoch(c, samples, 1024, 0)); // in-flight old callback
    ll_capture_gate(c, 1, 3000);
    assert(ll_capture_epoch(c, 2999) == -1);
    assert(!ll_capture_push_epoch(c, samples, 1024, 0));
    assert(ll_capture_pop_epoch(c, out, &epoch) == 1024 && epoch == 0); // never retag ring
    assert(ll_capture_push_epoch(c, samples, 1024, ll_capture_epoch(c, 3000)));
    assert(ll_capture_pop_epoch(c, out, &epoch) == 1024 && epoch == 1);
    assert(ll_capture_dropped(c) == 0); // mute discards aren't backpressure failures
    ll_destroy(c);
}
