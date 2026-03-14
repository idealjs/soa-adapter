import { describe, expect, test } from "vitest";
import {
  createArrayOfStructState,
  runArrayOfStructLoop,
  type LogisticsEvent,
} from "./ArrayOfStruct";
import { createStructOfArrayState, runStructOfArrayLoop } from "./StructOfArray";
import {
  createStructOfTypedArrayState,
  runStructOfTypedArrayLoop,
} from "./StructOfTypedArray";

const DATA_SIZE = 131_072;
const ITERATIONS = 2_000_000;

interface BenchmarkResult {
  implementation: string;
  setupMs: number;
  loopMs: number;
  totalMs: number;
  checksum: number;
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

function benchmark<TState>(
  implementation: string,
  setup: () => TState,
  runLoop: (state: TState, iterations: number) => number,
): BenchmarkResult {
  const setupStartedAt = performance.now();
  const state = setup();
  const setupMs = performance.now() - setupStartedAt;

  const loopStartedAt = performance.now();
  const checksum = runLoop(state, ITERATIONS);
  const loopMs = performance.now() - loopStartedAt;

  return {
    implementation,
    setupMs,
    loopMs,
    totalMs: setupMs + loopMs,
    checksum,
  };
}

function report(results: [BenchmarkResult, BenchmarkResult, BenchmarkResult]): void {
  console.table(
    results.map((result) => ({
      implementation: result.implementation,
      setupMs: Number(result.setupMs.toFixed(2)),
      loopMs: Number(result.loopMs.toFixed(2)),
      totalMs: Number(result.totalMs.toFixed(2)),
      checksum: result.checksum,
    })),
  );
}

describe("performance comparisons", () => {
  test("shows three implementations in one table", () => {
    const events = createLogisticsEvents(DATA_SIZE);

    const aosResult = benchmark(
      "Array of Structs",
      () => createArrayOfStructState(events),
      runArrayOfStructLoop,
    );
    const soaArrayResult = benchmark(
      "Struct of Array",
      () => createStructOfArrayState(events),
      runStructOfArrayLoop,
    );
    const soaTypedArrayResult = benchmark(
      "Struct of TypedArray",
      () => createStructOfTypedArrayState(events),
      runStructOfTypedArrayLoop,
    );

    expect(soaArrayResult.checksum).toBe(aosResult.checksum);
    expect(soaTypedArrayResult.checksum).toBe(aosResult.checksum);

    report([aosResult, soaArrayResult, soaTypedArrayResult]);
  });
});
