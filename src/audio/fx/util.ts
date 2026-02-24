export const rampParam = (
  param: AudioParam,
  value: number,
  when: number,
  timeConstant = 0.015
): void => {
  param.cancelScheduledValues(when);
  param.setTargetAtTime(value, when, timeConstant);
};

export interface CrossfadeRouter {
  input: GainNode;
  output: GainNode;
  laneInputs: [GainNode, GainNode];
  laneOutputs: [GainNode, GainNode];
  setActiveLane: (context: BaseAudioContext, laneIndex: 0 | 1, fadeSeconds?: number) => void;
  disconnect: () => void;
}

export const makeCrossfade = (context: AudioContext, initialActiveLane: 0 | 1 = 0): CrossfadeRouter => {
  const input = context.createGain();
  const output = context.createGain();
  const laneInputA = context.createGain();
  const laneInputB = context.createGain();
  const laneOutputA = context.createGain();
  const laneOutputB = context.createGain();

  input.gain.setValueAtTime(1, context.currentTime);
  output.gain.setValueAtTime(1, context.currentTime);
  laneInputA.gain.setValueAtTime(initialActiveLane === 0 ? 1 : 0, context.currentTime);
  laneInputB.gain.setValueAtTime(initialActiveLane === 1 ? 1 : 0, context.currentTime);
  laneOutputA.gain.setValueAtTime(initialActiveLane === 0 ? 1 : 0, context.currentTime);
  laneOutputB.gain.setValueAtTime(initialActiveLane === 1 ? 1 : 0, context.currentTime);

  input.connect(laneInputA);
  input.connect(laneInputB);
  laneOutputA.connect(output);
  laneOutputB.connect(output);

  return {
    input,
    output,
    laneInputs: [laneInputA, laneInputB],
    laneOutputs: [laneOutputA, laneOutputB],
    setActiveLane(activeContext, laneIndex, fadeSeconds = 0.02) {
      const when = activeContext.currentTime;
      const time = Math.max(0.001, fadeSeconds);
      const inactiveIndex: 0 | 1 = laneIndex === 0 ? 1 : 0;
      rampParam(this.laneInputs[laneIndex].gain, 1, when, time);
      rampParam(this.laneOutputs[laneIndex].gain, 1, when, time);
      rampParam(this.laneInputs[inactiveIndex].gain, 0, when, time);
      rampParam(this.laneOutputs[inactiveIndex].gain, 0, when, time);
    },
    disconnect() {
      input.disconnect();
      output.disconnect();
      laneInputA.disconnect();
      laneInputB.disconnect();
      laneOutputA.disconnect();
      laneOutputB.disconnect();
    },
  };
};

