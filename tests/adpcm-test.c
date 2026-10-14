#include <assert.h>
#include <stdint.h>
#include "ATVVADPCM.h"

int main(void) {
    ATVVADPCMState state = {0, 0};
    assert(ATVVADPCMDecodeNibble(7, &state) == 11);
    assert(state.stepIndex == 8);
    assert(ATVVADPCMDecodeNibble(1, &state) == 17);
    assert(state.stepIndex == 7);

    ATVVADPCMState negative = {100, 8};
    assert(ATVVADPCMDecodeNibble(8, &negative) == 98);

    ATVVADPCMState upper = {32760, 88};
    assert(ATVVADPCMDecodeNibble(7, &upper) == INT16_MAX);
    assert(upper.stepIndex == 88);
    ATVVADPCMState lower = {-32760, 88};
    assert(ATVVADPCMDecodeNibble(15, &lower) == INT16_MIN);

    const int16_t input[] = {0, 100, 200};
    int16_t output[6] = {0};
    int16_t previous = 0;
    bool hasPrevious = false;
    assert(ATVVUpsampleLinear8k(input, 3, output, &previous, &hasPrevious) == 6);
    const int16_t expected[] = {0, 0, 50, 100, 150, 200};
    for (int i = 0; i < 6; i++) assert(output[i] == expected[i]);
    assert(previous == 200 && hasPrevious);

    const int16_t nextInput[] = {300};
    int16_t nextOutput[2] = {0};
    assert(ATVVUpsampleLinear8k(nextInput, 1, nextOutput, &previous, &hasPrevious) == 2);
    assert(nextOutput[0] == 250 && nextOutput[1] == 300);

    return 0;
}
