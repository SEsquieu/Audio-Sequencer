import { createFxModule, FxModuleHandle, FxRenderOptions } from "./modules";
import { FxInstance } from "./types";
import { CrossfadeRouter, makeCrossfade } from "./util";

interface LaneState {
  modules: FxModuleHandle[];
  byFxId: Map<string, FxModuleHandle>;
  signature: string;
}

const STRUCTURAL_FADE_MS = 28;
const DISPOSE_DELAY_MS = 72;

const toStructuralSignature = (instances: FxInstance[], options: FxRenderOptions): string =>
  `${options.ecoMode ? "eco1" : "eco0"}|${instances.map((fx) => `${fx.id}:${fx.type}:${fx.enabled ? 1 : 0}`).join("|")}`;

const normalizeInstances = (instances: FxInstance[]): FxInstance[] =>
  instances.map((fx) => ({
    ...fx,
    params: JSON.parse(JSON.stringify(fx.params)) as FxInstance["params"],
  }));

export class FxRack {
  readonly rackIn: GainNode;
  readonly rackOut: GainNode;

  private readonly crossfade: CrossfadeRouter;
  private activeLaneIndex: 0 | 1 = 0;
  private readonly lanes: [LaneState, LaneState];
  private laneTokens: [number, number] = [0, 0];
  private renderOptions: FxRenderOptions = { ecoMode: false };
  private lastInstances: FxInstance[] = [];

  constructor(private readonly context: AudioContext) {
    this.crossfade = makeCrossfade(context, 0);
    this.rackIn = this.crossfade.input;
    this.rackOut = this.crossfade.output;
    this.lanes = [
      { modules: [], byFxId: new Map(), signature: "" },
      { modules: [], byFxId: new Map(), signature: "" },
    ];

    this.buildLane(0, []);
    this.crossfade.setActiveLane(this.context, 0, 0.001);
  }

  setFxInstances(nextInstances: FxInstance[]): void {
    const normalized = normalizeInstances(nextInstances);
    this.lastInstances = normalized;
    const structuralSignature = toStructuralSignature(normalized, this.renderOptions);
    const activeLane = this.lanes[this.activeLaneIndex];

    if (activeLane.signature === structuralSignature) {
      this.applyHotParams(this.activeLaneIndex, normalized);
      return;
    }

    const nextLaneIndex: 0 | 1 = this.activeLaneIndex === 0 ? 1 : 0;
    this.buildLane(nextLaneIndex, normalized);
    this.applyHotParams(nextLaneIndex, normalized);
    this.crossfade.setActiveLane(this.context, nextLaneIndex, STRUCTURAL_FADE_MS / 1000);

    const prevLaneIndex = this.activeLaneIndex;
    const prevLaneToken = this.laneTokens[prevLaneIndex];
    this.activeLaneIndex = nextLaneIndex;
    window.setTimeout(() => {
      if (this.laneTokens[prevLaneIndex] !== prevLaneToken) {
        return;
      }
      this.disposeLane(prevLaneIndex);
    }, DISPOSE_DELAY_MS);
  }

  setRenderOptions(nextOptions: FxRenderOptions): void {
    if (this.renderOptions.ecoMode === nextOptions.ecoMode) {
      return;
    }
    this.renderOptions = { ...nextOptions };
    this.setFxInstances(this.lastInstances);
  }

  dispose(): void {
    this.disposeLane(0);
    this.disposeLane(1);
    this.crossfade.disconnect();
  }

  private applyHotParams(laneIndex: 0 | 1, instances: FxInstance[]): void {
    const lane = this.lanes[laneIndex];
    const when = this.context.currentTime;
    for (const fx of instances) {
      if (!fx.enabled) {
        continue;
      }
      lane.byFxId.get(fx.id)?.setParams(fx.params, when);
    }
  }

  private buildLane(laneIndex: 0 | 1, instances: FxInstance[]): void {
    this.disposeLane(laneIndex);
    this.laneTokens[laneIndex] += 1;

    const lane = this.lanes[laneIndex];
    const enabledInstances = instances.filter((fx) => fx.enabled);
    const modules: FxModuleHandle[] = [];
    const byFxId = new Map<string, FxModuleHandle>();

    this.crossfade.laneInputs[laneIndex].disconnect();
    let cursor: AudioNode = this.crossfade.laneInputs[laneIndex];
    for (const fx of enabledInstances) {
      const module = createFxModule(this.context, fx, this.renderOptions);
      cursor.connect(module.input);
      cursor = module.output;
      modules.push(module);
      byFxId.set(fx.id, module);
    }
    cursor.connect(this.crossfade.laneOutputs[laneIndex]);

    lane.modules = modules;
    lane.byFxId = byFxId;
    lane.signature = toStructuralSignature(instances, this.renderOptions);
  }

  private disposeLane(laneIndex: 0 | 1): void {
    const lane = this.lanes[laneIndex];
    for (const module of lane.modules) {
      try {
        module.dispose();
      } catch {
        // Ignore teardown races during rapid rebuilds.
      }
    }
    lane.modules = [];
    lane.byFxId = new Map();
    lane.signature = "";
    try {
      this.crossfade.laneInputs[laneIndex].disconnect();
    } catch {
      // no-op
    }
  }
}
