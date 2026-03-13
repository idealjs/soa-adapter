import { describe, expect, test } from "vitest";

const ITERATIONS = 2_000_000;
const SIZE = 131_072;

function runNumberArrayWorkload(size: number, iterations: number): number {
  const values = Array<number>(size);
  for (let i = 0; i < size; i++) {
    values[i] = i % 997;
  }

  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    const index = i & (size - 1);
    const next = (values[index] + (i % 7)) % 2048;
    values[index] = next;
    sum += next;
  }

  return sum;
}

function runTypedArrayWorkload(size: number, iterations: number): number {
  const values = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    values[i] = i % 997;
  }

  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    const index = i & (size - 1);
    const next = (values[index] + (i % 7)) % 2048;
    values[index] = next;
    sum += next;
  }

  return sum;
}

describe("TypedArray vs Array performance", () => {
  test("runs equivalent workloads and logs timing", () => {
    const arrayStart = performance.now();
    const arrayResult = runNumberArrayWorkload(SIZE, ITERATIONS);
    const arrayDuration = performance.now() - arrayStart;

    const typedStart = performance.now();
    const typedResult = runTypedArrayWorkload(SIZE, ITERATIONS);
    const typedDuration = performance.now() - typedStart;

    expect(typedResult).toBe(arrayResult);

    const ratio = arrayDuration / typedDuration;
    const winner = ratio > 1 ? "TypedArray" : "Array";

    console.table([
      { implementation: "Array", durationMs: Number(arrayDuration.toFixed(2)) },
      { implementation: "TypedArray", durationMs: Number(typedDuration.toFixed(2)) },
    ]);
    console.log(`[perf] winner=${winner} speedup=${Math.max(ratio, 1 / ratio).toFixed(2)}x`);
  });
});
