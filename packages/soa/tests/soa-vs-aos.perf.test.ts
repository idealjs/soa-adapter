import { describe, expect, test } from "vitest";

const DATA_SIZE = 131_072;
const ITERATIONS = 2_000_000;

interface LogisticsEvent {
  trip: {
    vehicle: {
      engine: {
        rpm: number;
        fuelMilliLiters: number;
      };
      payload: {
        weightKg: number;
      };
    };
    route: {
      distanceMeters: number;
      trafficDelaySeconds: number;
    };
  };
}

interface AosSnapshot {
  trip: {
    vehicle: {
      engine: {
        rpm: number;
        fuelMilliLiters: number;
      };
      payload: {
        weightKg: number;
      };
    };
    route: {
      distanceMeters: number;
      trafficDelaySeconds: number;
    };
  };
}

interface BenchmarkResult {
  implementation: string;
  setupMs: number;
  loopMs: number;
  totalMs: number;
  checksum: number;
}

interface AosState {
  snapshots: AosSnapshot[];
}

interface SoaState {
  rpm: number[];
  fuelMilliLiters: number[];
  weightKg: number[];
  distanceMeters: number[];
  trafficDelaySeconds: number[];
}

function createLogisticsEvents(size: number): LogisticsEvent[] {
  const events = new Array<LogisticsEvent>(size);
  for (let i = 0; i < size; i++) {
    events[i] = {
      trip: {
        vehicle: {
          engine: {
            rpm: 750 + (i % 2_500),
            fuelMilliLiters: 120 + (i % 300),
          },
          payload: {
            weightKg: 100 + (i % 1_200),
          },
        },
        route: {
          distanceMeters: 8_000 + (i % 35_000),
          trafficDelaySeconds: i % 420,
        },
      },
    };
  }

  return events;
}

function createAoSState(events: LogisticsEvent[]): AosState {
  const snapshots = new Array<AosSnapshot>(events.length);
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    snapshots[i] = {
      trip: {
        vehicle: {
          engine: {
            rpm: event.trip.vehicle.engine.rpm,
            fuelMilliLiters: event.trip.vehicle.engine.fuelMilliLiters,
          },
          payload: {
            weightKg: event.trip.vehicle.payload.weightKg,
          },
        },
        route: {
          distanceMeters: event.trip.route.distanceMeters,
          trafficDelaySeconds: event.trip.route.trafficDelaySeconds,
        },
      },
    };
  }

  return { snapshots };
}

function runAoSLoop(state: AosState, iterations: number): number {
  let checksum = 0;
  for (let i = 0; i < iterations; i++) {
    const index = i & (state.snapshots.length - 1);
    const snapshot = state.snapshots[index];

    snapshot.trip.vehicle.engine.rpm = (snapshot.trip.vehicle.engine.rpm + (i % 13)) % 8_000;
    snapshot.trip.vehicle.engine.fuelMilliLiters =
      (snapshot.trip.vehicle.engine.fuelMilliLiters + (i % 11)) % 2_000;
    snapshot.trip.route.distanceMeters =
      (snapshot.trip.route.distanceMeters + snapshot.trip.vehicle.engine.rpm) % 80_000;

    checksum +=
      snapshot.trip.vehicle.engine.rpm +
      snapshot.trip.vehicle.engine.fuelMilliLiters +
      snapshot.trip.vehicle.payload.weightKg +
      Math.trunc(snapshot.trip.route.distanceMeters / 100) +
      snapshot.trip.route.trafficDelaySeconds;
  }

  return checksum;
}

function createSoAState(events: LogisticsEvent[]): SoaState {
  const rpm = new Array<number>(events.length);
  const fuelMilliLiters = new Array<number>(events.length);
  const weightKg = new Array<number>(events.length);
  const distanceMeters = new Array<number>(events.length);
  const trafficDelaySeconds = new Array<number>(events.length);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    rpm[i] = event.trip.vehicle.engine.rpm;
    fuelMilliLiters[i] = event.trip.vehicle.engine.fuelMilliLiters;
    weightKg[i] = event.trip.vehicle.payload.weightKg;
    distanceMeters[i] = event.trip.route.distanceMeters;
    trafficDelaySeconds[i] = event.trip.route.trafficDelaySeconds;
  }

  return { rpm, fuelMilliLiters, weightKg, distanceMeters, trafficDelaySeconds };
}

function runSoALoop(state: SoaState, iterations: number): number {
  let checksum = 0;
  for (let i = 0; i < iterations; i++) {
    const index = i & (state.rpm.length - 1);

    state.rpm[index] = (state.rpm[index] + (i % 13)) % 8_000;
    state.fuelMilliLiters[index] = (state.fuelMilliLiters[index] + (i % 11)) % 2_000;
    state.distanceMeters[index] = (state.distanceMeters[index] + state.rpm[index]) % 80_000;

    checksum +=
      state.rpm[index] +
      state.fuelMilliLiters[index] +
      state.weightKg[index] +
      Math.trunc(state.distanceMeters[index] / 100) +
      state.trafficDelaySeconds[index];
  }

  return checksum;
}

function benchmark<TState>(
  implementation: string,
  setup: () => TState,
  runLoop: (state: TState) => number,
): BenchmarkResult {
  const setupStartedAt = performance.now();
  const state = setup();
  const setupMs = performance.now() - setupStartedAt;

  const loopStartedAt = performance.now();
  const checksum = runLoop(state);
  const loopMs = performance.now() - loopStartedAt;

  return {
    implementation,
    setupMs,
    loopMs,
    totalMs: setupMs + loopMs,
    checksum,
  };
}

function report(results: [BenchmarkResult, BenchmarkResult]): void {
  const [left, right] = results;
  const leftIsFaster = left.totalMs <= right.totalMs;
  const winner = leftIsFaster ? left : right;
  const loser = leftIsFaster ? right : left;

  console.table(
    results.map((result) => ({
      implementation: result.implementation,
      setupMs: Number(result.setupMs.toFixed(2)),
      loopMs: Number(result.loopMs.toFixed(2)),
      totalMs: Number(result.totalMs.toFixed(2)),
      checksum: result.checksum,
    })),
  );
  console.log(
    `[perf] winner=${winner.implementation} speedup=${(loser.totalMs / winner.totalMs).toFixed(2)}x`,
  );
}

describe("SoA vs Array-of-Structs performance", () => {
  test("runs equivalent workloads with realistic nested logistics data", () => {
    const events = createLogisticsEvents(DATA_SIZE);

    const aosResult = benchmark(
      "Array of Structs",
      () => createAoSState(events),
      (state) => runAoSLoop(state, ITERATIONS),
    );
    const soaResult = benchmark(
      "Struct of Array",
      () => createSoAState(events),
      (state) => runSoALoop(state, ITERATIONS),
    );

    expect(soaResult.checksum).toBe(aosResult.checksum);
    report([aosResult, soaResult]);
  });
});
