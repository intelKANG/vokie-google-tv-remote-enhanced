#ifndef VOKIE_ATVV_ADPCM_H
#define VOKIE_ATVV_ADPCM_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    int32_t predictor;
    int stepIndex;
} ATVVADPCMState;

static inline int16_t ATVVADPCMDecodeNibble(uint8_t nibble, ATVVADPCMState *state) {
    static const int indexTable[8] = {-1,-1,-1,-1,2,4,6,8};
    static const int stepTable[89] = {
        7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,
        80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,
        494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,2066,
        2272,2494,2740,3008,3307,3638,4002,4402,4842,5327,5860,6446,7091,7800,
        8580,9438,10382,11420,12562,13818,15200,16720,18392,20231,22254,24479,
        26927,29620,32767
    };
    const int index = state->stepIndex < 0 ? 0 : state->stepIndex > 88 ? 88 : state->stepIndex;
    const int step = stepTable[index];
    int difference = step >> 3;
    if (nibble & 4) difference += step;
    if (nibble & 2) difference += step >> 1;
    if (nibble & 1) difference += step >> 2;
    state->predictor += (nibble & 8) ? -difference : difference;
    if (state->predictor < INT16_MIN) state->predictor = INT16_MIN;
    if (state->predictor > INT16_MAX) state->predictor = INT16_MAX;
    const unsigned indexValue = nibble & 7;
    state->stepIndex += indexTable[indexValue];
    if (state->stepIndex < 0) state->stepIndex = 0;
    if (state->stepIndex > 88) state->stepIndex = 88;
    return (int16_t)state->predictor;
}

static inline size_t ATVVUpsampleLinear8k(
    const int16_t *input,
    size_t count,
    int16_t *output,
    int16_t *previous,
    bool *hasPrevious
) {
    if (!input || !output || !previous || !hasPrevious) return 0;
    for (size_t i = 0; i < count; i++) {
        const int16_t current = input[i];
        const int16_t prior = *hasPrevious ? *previous : current;
        output[i * 2] = (int16_t)(((int32_t)prior + (int32_t)current) / 2);
        output[i * 2 + 1] = current;
        *previous = current;
        *hasPrevious = true;
    }
    return count * 2;
}

#endif
