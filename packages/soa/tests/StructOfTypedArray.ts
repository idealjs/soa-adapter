import type { LogisticsEvent } from "./ArrayOfStruct";

export interface StructOfTypedArrayState {
  rpm: Uint32Array;
  fuelMilliLiters: Uint32Array;
  weightKg: Uint32Array;
  distanceMeters: Uint32Array;
  trafficDelaySeconds: Uint32Array;
}

export function createStructOfTypedArrayState(
  events: LogisticsEvent[],
): StructOfTypedArrayState {
  const rpm = new Uint32Array(events.length);
  const fuelMilliLiters = new Uint32Array(events.length);
  const weightKg = new Uint32Array(events.length);
  const distanceMeters = new Uint32Array(events.length);
  const trafficDelaySeconds = new Uint32Array(events.length);

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

export function runStructOfTypedArrayLoop(
  state: StructOfTypedArrayState,
  iterations: number,
): number {
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
