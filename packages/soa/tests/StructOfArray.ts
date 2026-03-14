import type { LogisticsEvent } from "./ArrayOfStruct";

export interface StructOfArrayState {
  rpm: number[];
  fuelMilliLiters: number[];
  weightKg: number[];
  distanceMeters: number[];
  trafficDelaySeconds: number[];
}

export function createStructOfArrayState(events: LogisticsEvent[]): StructOfArrayState {
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

export function runStructOfArrayLoop(state: StructOfArrayState, iterations: number): number {
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
