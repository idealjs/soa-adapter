export interface LogisticsEvent {
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

export interface ArrayOfStructState {
  snapshots: AosSnapshot[];
}

export function createArrayOfStructState(events: LogisticsEvent[]): ArrayOfStructState {
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

export function runArrayOfStructLoop(state: ArrayOfStructState, iterations: number): number {
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
