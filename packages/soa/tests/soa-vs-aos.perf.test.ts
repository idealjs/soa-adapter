import { describe, expect, test } from "vitest";

const ENTITY_COUNT = 100_000;
const STEPS = 120;
const DT = 0.016;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function runAoSWorkload(count: number, steps: number): number {
  const particles: Particle[] = new Array(count);
  for (let i = 0; i < count; i++) {
    particles[i] = {
      x: i % 1024,
      y: (i * 3) % 1024,
      vx: (i % 31) * 0.01,
      vy: (i % 17) * 0.01,
    };
  }

  let energy = 0;
  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      energy += p.x * 0.0001 + p.y * 0.0001;
    }
  }

  return energy;
}

function runSoAWorkload(count: number, steps: number): number {
  const x: number[] = [];
  const y: number[] = [];
  const vx: number[] = [];
  const vy: number[] = [];

  for (let i = 0; i < count; i++) {
    x[i] = i % 1024;
    y[i] = (i * 3) % 1024;
    vx[i] = (i % 31) * 0.01;
    vy[i] = (i % 17) * 0.01;
  }

  let energy = 0;
  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < count; i++) {
      x[i] += vx[i] * DT;
      y[i] += vy[i] * DT;
      energy += x[i] * 0.0001 + y[i] * 0.0001;
    }
  }

  return energy;
}

describe("SoA vs Array-of-Structs performance", () => {
  test("runs equivalent workloads and logs timing", () => {
    const aosStart = performance.now();
    const aosResult = runAoSWorkload(ENTITY_COUNT, STEPS);
    const aosDuration = performance.now() - aosStart;

    const soaStart = performance.now();
    const soaResult = runSoAWorkload(ENTITY_COUNT, STEPS);
    const soaDuration = performance.now() - soaStart;

    expect(Math.abs(soaResult - aosResult)).toBeLessThan(1e-6);

    const ratio = aosDuration / soaDuration;
    const winner = ratio > 1 ? "SoA" : "AoS";

    console.table([
      { implementation: "Array-of-Structs", durationMs: Number(aosDuration.toFixed(2)) },
      { implementation: "SoA", durationMs: Number(soaDuration.toFixed(2)) },
    ]);
    console.log(`[perf] winner=${winner} speedup=${Math.max(ratio, 1 / ratio).toFixed(2)}x`);
  });
});
