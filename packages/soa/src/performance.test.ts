import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createAdapter, type EntityId } from "./adapter";
import {
  cloneMockData,
  createComplexMockData,
  type MockRecord,
  mockRecordSchema,
} from "./mockData";

type ScenarioMetrics<T> = {
  averageMs: number;
  minMs: number;
  maxMs: number;
  result: T;
};

type DatasetDigest = {
  length: number;
  activeCount: number;
  totalOrders: number;
  totalItems: number;
  tagChecksum: number;
  scoreChecksum: number;
  revenueChecksum: number;
};

type ReadDigest = {
  selected: number;
  idChecksum: number;
  scoreChecksum: number;
  totalChecksum: number;
  fragileCount: number;
  convertedCount: number;
};

type PointReadDigest = {
  id: string;
  score: number;
  retention0: number;
  orderTotal: number;
  fragile: boolean;
  converted: boolean;
};

type PointUpdateDigest = {
  score: number;
  tagsChecksum: number;
  retention0: number;
  orderTotal: number;
  converted: boolean;
};

const DATASET_OPTIONS = {
  size: 1200,
  seed: 20260312,
  maxOrders: 5,
  maxItemsPerOrder: 4,
  maxShipmentEvents: 4,
} as const;

const BENCHMARK_ITERATIONS = 5;
const POINT_READ_REPEATS = 5_000;
const POINT_UPDATE_REPEATS = 500;
const BATCH_READ_REPEATS = 20;
const BATCH_UPDATE_REPEATS = 10;
const BATCH_SAMPLE_SIZE = 256;
const BREAKDOWN_READ_REPEATS = 10_000;
const BREAKDOWN_WRITE_REPEATS = 1_000;

describe("adapter performance", () => {
  it("compares sequential initialization workloads", () => {
    const dataset = createComplexMockData(DATASET_OPTIONS);

    const initAdapter = benchmark(BENCHMARK_ITERATIONS, () =>
      runSequentialInitializeWithAdapter(dataset),
    );
    const initNative = benchmark(BENCHMARK_ITERATIONS, () =>
      runSequentialInitializeWithNative(dataset),
    );

    expect(initAdapter.result).toEqual(initNative.result);

    reportScenario("initialize-sequential", [
      toRow("initialize", "adapter", initAdapter),
      toRow("initialize", "native", initNative),
    ]);
  });

  it("compares point read workloads", () => {
    const dataset = createComplexMockData(DATASET_OPTIONS);

    const readAdapter = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runPointReadWithAdapter,
    );
    const readNative = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createNativeAccessContext(dataset),
      runPointReadWithNative,
    );

    expect(readAdapter.result).toEqual(readNative.result);

    reportScenario("read-point", [
      toRow("read-point", "adapter", readAdapter),
      toRow("read-point", "native", readNative),
    ]);
  });

  it("compares batch read workloads", () => {
    const dataset = createComplexMockData(DATASET_OPTIONS);

    const readAdapterEntity = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runReadScenarioWithAdapterEntities,
    );
    const readAdapterColumn = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runReadScenarioWithAdapterColumns,
    );
    const readAdapterPrepared = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runReadScenarioWithPreparedQuery,
    );
    const readNative = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createNativeAccessContext(dataset),
      runReadScenarioWithNative,
    );

    expect(readAdapterEntity.result).toEqual(readNative.result);
    expect(readAdapterColumn.result).toEqual(readNative.result);
    expect(readAdapterPrepared.result).toEqual(readNative.result);

    reportScenario("read-batch", [
      toRow("read-batch", "adapter-entity", readAdapterEntity),
      toRow("read-batch", "adapter-column", readAdapterColumn),
      toRow("read-batch", "adapter-prepared", readAdapterPrepared),
      toRow("read-batch", "native", readNative),
    ]);
  });

  it("compares point update workloads", () => {
    const dataset = createComplexMockData(DATASET_OPTIONS);

    const updateAdapter = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runPointUpdateWithAdapter,
    );
    const updateNative = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createNativeAccessContext(dataset),
      runPointUpdateWithNative,
    );

    expect(updateAdapter.result).toEqual(updateNative.result);

    reportScenario("update-point", [
      toRow("update-point", "adapter", updateAdapter),
      toRow("update-point", "native", updateNative),
    ]);
  });

  it("compares batch update workloads", () => {
    const dataset = createComplexMockData(DATASET_OPTIONS);

    const mutateAdapter = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runMutationScenarioWithAdapter,
    );
    const mutateNative = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createNativeAccessContext(dataset),
      runMutationScenarioWithNative,
    );

    expect(mutateAdapter.result).toEqual(mutateNative.result);

    reportScenario("update-batch", [
      toRow("update-batch", "adapter", mutateAdapter),
      toRow("update-batch", "native", mutateNative),
    ]);
  });

  it("profiles adapter hot paths", () => {
    const dataset = createComplexMockData(DATASET_OPTIONS);

    const rootGetFieldRead = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runRootScalarGetFieldReadBreakdown,
    );
    const rootPreparedRead = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runRootScalarPreparedReadBreakdown,
    );
    const nestedGetFieldRead = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runNestedScalarGetFieldReadBreakdown,
    );
    const nestedPreparedRead = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runNestedScalarPreparedReadBreakdown,
    );
    const rootArrayIds = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runRootArrayIdsBreakdown,
    );
    const nestedArrayIds = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runNestedArrayIdsBreakdown,
    );
    const rootSetFieldWrite = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runRootScalarSetFieldWriteBreakdown,
    );
    const rootPreparedWrite = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runRootScalarPreparedWriteBreakdown,
    );
    const nestedSetFieldWrite = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runNestedScalarSetFieldWriteBreakdown,
    );
    const nestedPreparedWrite = benchmarkWithSetup(
      BENCHMARK_ITERATIONS,
      () => createAdapterAccessContext(dataset),
      runNestedScalarPreparedWriteBreakdown,
    );

    expect(rootGetFieldRead.result).toBe(rootPreparedRead.result);
    expect(nestedGetFieldRead.result).toBe(nestedPreparedRead.result);
    expect(rootSetFieldWrite.result).toBe(rootPreparedWrite.result);
    expect(nestedSetFieldWrite.result).toBe(nestedPreparedWrite.result);

    reportScenario("adapter-hot-path", [
      toRow("breakdown-read", "root-getField", rootGetFieldRead),
      toRow("breakdown-read", "root-prepared", rootPreparedRead),
      toRow("breakdown-read", "nested-getField", nestedGetFieldRead),
      toRow("breakdown-read", "nested-prepared", nestedPreparedRead),
      toRow("breakdown-array", "root-ids", rootArrayIds),
      toRow("breakdown-array", "nested-ids", nestedArrayIds),
      toRow("breakdown-write", "root-setField", rootSetFieldWrite),
      toRow("breakdown-write", "root-prepared", rootPreparedWrite),
      toRow("breakdown-write", "nested-setField", nestedSetFieldWrite),
      toRow("breakdown-write", "nested-prepared", nestedPreparedWrite),
    ]);
  });
});

function runSequentialInitializeWithAdapter(
  source: readonly MockRecord[],
): DatasetDigest {
  const adapter = createAdapter(mockRecordSchema);

  for (const record of source) {
    adapter.append(record);
  }

  return summarizeDataset(adapter.toJSON());
}

function runSequentialInitializeWithNative(
  source: readonly MockRecord[],
): DatasetDigest {
  const native: MockRecord[] = [];

  for (const record of source) {
    native.push(cloneMockData([record])[0]);
  }

  return summarizeDataset(native);
}

function createAdapterAccessContext(source: readonly MockRecord[]) {
  const adapter = createAdapter(mockRecordSchema, source);
  const entityIds = adapter.ids();
  const pointEntityId = entityIds[Math.floor(entityIds.length / 2)];
  const batchEntityIds = pickSampleEntityIds(entityIds, BATCH_SAMPLE_SIZE);
  const orders = requirePreparedArray(adapter.prepare(["orders"]), "orders");
  const orderItems = requirePreparedArray(adapter.prepare(["orders", "$", "items"]), "orders.$.items");
  const retention = requirePreparedArray(adapter.prepare(["analytics", "retention"]), "analytics.retention");
  const funnels = requirePreparedArray(adapter.prepare(["analytics", "funnels"]), "analytics.funnels");
  const pointOrderId = pointEntityId ? orders.ids(pointEntityId)[0] : undefined;
  const pointItemId = pointOrderId ? orderItems.ids(pointOrderId)[0] : undefined;
  const pointRetentionId = pointEntityId ? retention.ids(pointEntityId)[0] : undefined;
  const pointFunnelId = pointEntityId ? funnels.ids(pointEntityId)[0] : undefined;

  return {
    adapter,
    entityIds,
    pointEntityId,
    pointOrderId,
    pointItemId,
    pointRetentionId,
    pointFunnelId,
    batchEntityIds,
    idValues: requirePreparedScalar<string>(adapter.prepare(["id"]), "id"),
    scores: requirePreparedScalar<number>(adapter.prepare(["profile", "score"]), "profile.score"),
    retention,
    retentionValues: requirePreparedScalar<number>(adapter.prepare(["analytics", "retention", "$"]), "analytics.retention.$"),
    orders,
    orderTotals: requirePreparedScalar<number>(adapter.prepare(["orders", "$", "total"]), "orders.$.total"),
    orderItems,
    fragileValues: requirePreparedScalar<boolean>(adapter.prepare(["orders", "$", "items", "$", "attributes", "fragile"]), "orders.$.items.$.attributes.fragile"),
    funnels,
    funnelConverted: requirePreparedScalar<boolean>(adapter.prepare(["analytics", "funnels", "$", "converted"]), "analytics.funnels.$.converted"),
    query: adapter.prepareQuery({
      idValues: ["id"],
      scores: ["profile", "score"],
      retention: ["analytics", "retention"],
      retentionValues: ["analytics", "retention", "$"] ,
      orders: ["orders"],
      orderTotals: ["orders", "$", "total"],
      orderItems: ["orders", "$", "items"],
      fragile: ["orders", "$", "items", "$", "attributes", "fragile"],
      funnels: ["analytics", "funnels"],
      funnelConverted: ["analytics", "funnels", "$", "converted"],
    }),
  };
}

function runRootScalarGetFieldReadBreakdown(
  context: ReturnType<typeof createAdapterAccessContext>,
): number {
  const { adapter, pointEntityId } = context;

  if (!pointEntityId) {
    return 0;
  }

  let checksum = 0;

  for (let index = 0; index < BREAKDOWN_READ_REPEATS; index += 1) {
    checksum = round4(checksum + (((adapter.getField(pointEntityId, ["profile", "score"]) as number | undefined) ?? 0)));
  }

  return checksum;
}

function runRootScalarPreparedReadBreakdown(
  context: ReturnType<typeof createAdapterAccessContext>,
): number {
  const { pointEntityId, scores } = context;

  if (!pointEntityId) {
    return 0;
  }

  let checksum = 0;

  for (let index = 0; index < BREAKDOWN_READ_REPEATS; index += 1) {
    checksum = round4(checksum + (((scores.get(pointEntityId) as number | undefined) ?? 0)));
  }

  return checksum;
}

function runNestedScalarGetFieldReadBreakdown(
  context: ReturnType<typeof createAdapterAccessContext>,
): number {
  const { adapter, pointItemId } = context;

  if (!pointItemId) {
    return 0;
  }

  let checksum = 0;

  for (let index = 0; index < BREAKDOWN_READ_REPEATS; index += 1) {
    checksum += adapter.getField(pointItemId, ["orders", "$", "items", "$", "attributes", "fragile"]) ? 1 : 0;
  }

  return checksum;
}

function runNestedScalarPreparedReadBreakdown(
  context: ReturnType<typeof createAdapterAccessContext>,
): number {
  const { pointItemId, fragileValues } = context;

  if (!pointItemId) {
    return 0;
  }

  let checksum = 0;

  for (let index = 0; index < BREAKDOWN_READ_REPEATS; index += 1) {
    checksum += fragileValues.get(pointItemId) ? 1 : 0;
  }

  return checksum;
}

function runRootArrayIdsBreakdown(
  context: ReturnType<typeof createAdapterAccessContext>,
): number {
  const { pointEntityId, orders } = context;

  if (!pointEntityId) {
    return 0;
  }

  let checksum = 0;

  for (let index = 0; index < BREAKDOWN_READ_REPEATS; index += 1) {
    checksum += orders.ids(pointEntityId).length;
  }

  return checksum;
}

function runNestedArrayIdsBreakdown(
  context: ReturnType<typeof createAdapterAccessContext>,
): number {
  const { pointOrderId, orderItems } = context;

  if (!pointOrderId) {
    return 0;
  }

  let checksum = 0;

  for (let index = 0; index < BREAKDOWN_READ_REPEATS; index += 1) {
    checksum += orderItems.ids(pointOrderId).length;
  }

  return checksum;
}

function runRootScalarSetFieldWriteBreakdown(
  context: ReturnType<typeof createAdapterAccessContext>,
): number {
  const { adapter, pointEntityId } = context;

  if (!pointEntityId) {
    return 0;
  }

  for (let index = 0; index < BREAKDOWN_WRITE_REPEATS; index += 1) {
    adapter.setField(pointEntityId, ["profile", "score"], round2(index * 0.01));
  }

  return (adapter.getField(pointEntityId, ["profile", "score"]) as number | undefined) ?? 0;
}

function runRootScalarPreparedWriteBreakdown(
  context: ReturnType<typeof createAdapterAccessContext>,
): number {
  const { pointEntityId, scores } = context;

  if (!pointEntityId) {
    return 0;
  }

  for (let index = 0; index < BREAKDOWN_WRITE_REPEATS; index += 1) {
    scores.set(pointEntityId, round2(index * 0.01));
  }

  return (scores.get(pointEntityId) as number | undefined) ?? 0;
}

function runNestedScalarSetFieldWriteBreakdown(
  context: ReturnType<typeof createAdapterAccessContext>,
): number {
  const { adapter, pointFunnelId } = context;

  if (!pointFunnelId) {
    return 0;
  }

  for (let index = 0; index < BREAKDOWN_WRITE_REPEATS; index += 1) {
    adapter.setField(pointFunnelId, ["analytics", "funnels", "$", "converted"], index % 2 === 0);
  }

  return adapter.getField(pointFunnelId, ["analytics", "funnels", "$", "converted"]) ? 1 : 0;
}

function runNestedScalarPreparedWriteBreakdown(
  context: ReturnType<typeof createAdapterAccessContext>,
): number {
  const { pointFunnelId, funnelConverted } = context;

  if (!pointFunnelId) {
    return 0;
  }

  for (let index = 0; index < BREAKDOWN_WRITE_REPEATS; index += 1) {
    funnelConverted.set(pointFunnelId, index % 2 === 0);
  }

  return funnelConverted.get(pointFunnelId) ? 1 : 0;
}

function createNativeAccessContext(source: readonly MockRecord[]) {
  const records = cloneMockData(source);
  const pointRecord = records[Math.floor(records.length / 2)];
  const batchRecordIds = pickSampleIndexes(records.length, BATCH_SAMPLE_SIZE)
    .map((index) => records[index]?.id)
    .filter((id): id is string => Boolean(id));

  return {
    records,
    pointRecordId: pointRecord?.id ?? "",
    pointOrderId: pointRecord?.orders[0]?.orderId ?? "",
    pointItemSku: pointRecord?.orders[0]?.items[0]?.sku ?? "",
    pointFunnelStep: pointRecord?.analytics.funnels[0]?.step ?? "",
    batchRecordIds,
  };
}

function runPointReadWithAdapter(context: ReturnType<typeof createAdapterAccessContext>): PointReadDigest {
  const { adapter, pointEntityId, retention, retentionValues, orders, orderTotals, orderItems, fragileValues, funnels, funnelConverted } = context;

  if (!pointEntityId) {
    return emptyPointReadDigest();
  }

  let result = emptyPointReadDigest();

  for (let iteration = 0; iteration < POINT_READ_REPEATS; iteration += 1) {
    const retentionId = retention.ids(pointEntityId)[0];
    const orderId = orders.ids(pointEntityId)[0];
    const itemId = orderId ? orderItems.ids(orderId)[0] : undefined;
    const funnelId = funnels.ids(pointEntityId)[0];
    result = {
      id: (adapter.getField(pointEntityId, ["id"]) as string | undefined) ?? "",
      score: (adapter.getField(pointEntityId, ["profile", "score"]) as number | undefined) ?? 0,
      retention0: retentionId ? ((retentionValues.get(retentionId) as number | undefined) ?? 0) : 0,
      orderTotal: orderId ? ((orderTotals.get(orderId) as number | undefined) ?? 0) : 0,
      fragile: itemId ? Boolean(fragileValues.get(itemId)) : false,
      converted: funnelId ? Boolean(funnelConverted.get(funnelId)) : false,
    };
  }

  return result;
}

function runPointReadWithNative(context: ReturnType<typeof createNativeAccessContext>): PointReadDigest {
  let result = emptyPointReadDigest();

  for (let iteration = 0; iteration < POINT_READ_REPEATS; iteration += 1) {
    const record = context.records.find((entry) => entry.id === context.pointRecordId);

    if (!record) {
      return emptyPointReadDigest();
    }

    const order = record.orders.find((entry) => entry.orderId === context.pointOrderId);
    const item = order?.items.find((entry) => entry.sku === context.pointItemSku);
    const funnel = record.analytics.funnels.find((entry) => entry.step === context.pointFunnelStep);
    result = {
      id: record.id,
      score: record.profile.score,
      retention0: record.analytics.retention[0] ?? 0,
      orderTotal: order?.total ?? 0,
      fragile: item?.attributes.fragile ?? false,
      converted: funnel?.converted ?? false,
    };
  }

  return result;
}

function runPointUpdateWithAdapter(context: ReturnType<typeof createAdapterAccessContext>): PointUpdateDigest {
  const { adapter, pointEntityId, retention, retentionValues, orders, orderTotals, funnels, funnelConverted } = context;

  if (!pointEntityId) {
    return emptyPointUpdateDigest();
  }

  const retentionId = retention.ids(pointEntityId)[0];
  const orderId = orders.ids(pointEntityId)[0];
  const funnelId = funnels.ids(pointEntityId)[0];

  for (let iteration = 0; iteration < POINT_UPDATE_REPEATS; iteration += 1) {
    const score = (adapter.getField(pointEntityId, ["profile", "score"]) as number | undefined) ?? 0;
    adapter.setField(pointEntityId, ["profile", "score"], round2(score + 0.01));
    adapter.setField(pointEntityId, ["profile", "preferences", "tags"], ["point", `${iteration % 3}`]);

    if (retentionId) {
      adapter.setField(retentionId, ["analytics", "retention", "$"] , round4((((retentionValues.get(retentionId) as number | undefined) ?? 0) + 0.001)));
    }

    if (orderId) {
      adapter.setField(orderId, ["orders", "$", "total"], round2((((orderTotals.get(orderId) as number | undefined) ?? 0) + 0.02)));
    }

    if (funnelId) {
      adapter.setField(funnelId, ["analytics", "funnels", "$", "converted"], iteration % 2 === 0);
    }
  }

  const nextTags = (adapter.getField(pointEntityId, ["profile", "preferences", "tags"]) as string[] | undefined) ?? [];
  return {
    score: (adapter.getField(pointEntityId, ["profile", "score"]) as number | undefined) ?? 0,
    tagsChecksum: nextTags.join("|").length,
    retention0: retentionId ? ((retentionValues.get(retentionId) as number | undefined) ?? 0) : 0,
    orderTotal: orderId ? ((orderTotals.get(orderId) as number | undefined) ?? 0) : 0,
    converted: funnelId ? Boolean(funnelConverted.get(funnelId)) : false,
  };
}

function runPointUpdateWithNative(context: ReturnType<typeof createNativeAccessContext>): PointUpdateDigest {
  let record = context.records.find((entry) => entry.id === context.pointRecordId);

  if (!record) {
    return emptyPointUpdateDigest();
  }

  for (let iteration = 0; iteration < POINT_UPDATE_REPEATS; iteration += 1) {
    record = context.records.find((entry) => entry.id === context.pointRecordId);

    if (!record) {
      return emptyPointUpdateDigest();
    }

    record.profile.score = round2(record.profile.score + 0.01);
    record.profile.preferences.tags = ["point", `${iteration % 3}`];

    if (record.analytics.retention[0] !== undefined) {
      record.analytics.retention[0] = round4(record.analytics.retention[0] + 0.001);
    }

    const order = record.orders.find((entry) => entry.orderId === context.pointOrderId);

    if (order) {
      order.total = round2(order.total + 0.02);
    }

    const funnel = record.analytics.funnels.find((entry) => entry.step === context.pointFunnelStep);

    if (funnel) {
      funnel.converted = iteration % 2 === 0;
    }
  }

  record = context.records.find((entry) => entry.id === context.pointRecordId);

  if (!record) {
    return emptyPointUpdateDigest();
  }

  const finalOrder = record.orders.find((entry) => entry.orderId === context.pointOrderId);
  const finalFunnel = record.analytics.funnels.find((entry) => entry.step === context.pointFunnelStep);

  return {
    score: record.profile.score,
    tagsChecksum: record.profile.preferences.tags.join("|").length,
    retention0: record.analytics.retention[0] ?? 0,
    orderTotal: finalOrder?.total ?? 0,
    converted: finalFunnel?.converted ?? false,
  };
}

function runReadScenarioWithAdapterEntities(context: ReturnType<typeof createAdapterAccessContext>): ReadDigest {
  const { adapter, batchEntityIds, retention, retentionValues, orders, orderTotals, orderItems, fragileValues, funnels, funnelConverted } = context;
  let digest = emptyReadDigest();

  for (let repeat = 0; repeat < BATCH_READ_REPEATS; repeat += 1) {
    digest = emptyReadDigest();

    for (const entityId of batchEntityIds) {
      const retentionId = retention.ids(entityId)[0];
      const score = (adapter.getField(entityId, ["profile", "score"]) as number | undefined) ?? 0;
      let totalSpent = 0;
      let fragileCount = 0;
      let convertedCount = 0;

      for (const orderId of orders.ids(entityId)) {
        totalSpent += (orderTotals.get(orderId) as number | undefined) ?? 0;

        for (const itemId of orderItems.ids(orderId)) {
          fragileCount += fragileValues.get(itemId) ? 1 : 0;
        }
      }

      for (const funnelId of funnels.ids(entityId)) {
        convertedCount += funnelConverted.get(funnelId) ? 1 : 0;
      }

      digest.selected += 1;
      digest.idChecksum += ((adapter.getField(entityId, ["id"]) as string | undefined) ?? "").length;
      digest.scoreChecksum = round2(digest.scoreChecksum + score + (retentionId ? ((retentionValues.get(retentionId) as number | undefined) ?? 0) : 0));
      digest.totalChecksum = round2(digest.totalChecksum + totalSpent);
      digest.fragileCount += fragileCount;
      digest.convertedCount += convertedCount;
    }
  }

  return digest;
}

function runReadScenarioWithNative(context: ReturnType<typeof createNativeAccessContext>): ReadDigest {
  let digest = emptyReadDigest();

  for (let repeat = 0; repeat < BATCH_READ_REPEATS; repeat += 1) {
    digest = emptyReadDigest();

    for (const recordId of context.batchRecordIds) {
      const record = context.records.find((entry) => entry.id === recordId);
      if (!record) {
        continue;
      }

      digest.selected += 1;
      digest.idChecksum += record.id.length;
      digest.scoreChecksum = round2(digest.scoreChecksum + record.profile.score + (record.analytics.retention[0] ?? 0));
      digest.totalChecksum = round2(
        digest.totalChecksum + record.orders.reduce((sum, order) => sum + order.total, 0),
      );
      digest.fragileCount += record.orders.reduce(
        (sum, order) => sum + order.items.filter((item) => item.attributes.fragile).length,
        0,
      );
      digest.convertedCount += record.analytics.funnels.filter((step) => step.converted).length;
    }
  }

  return digest;
}

function runReadScenarioWithAdapterColumns(context: ReturnType<typeof createAdapterAccessContext>): ReadDigest {
  const { batchEntityIds, idValues, scores, retention, retentionValues, orders, orderTotals, orderItems, fragileValues, funnels, funnelConverted } = context;
  let digest = emptyReadDigest();

  for (let repeat = 0; repeat < BATCH_READ_REPEATS; repeat += 1) {
    digest = emptyReadDigest();

    for (const entityId of batchEntityIds) {
      const retentionId = retention.ids(entityId)[0];
      let totalSpent = 0;
      let fragileCount = 0;
      let convertedCount = 0;

      for (const orderId of orders.ids(entityId)) {
        totalSpent += (orderTotals.get(orderId) as number | undefined) ?? 0;

        for (const itemId of orderItems.ids(orderId)) {
          fragileCount += fragileValues.get(itemId) ? 1 : 0;
        }
      }

      for (const funnelId of funnels.ids(entityId)) {
        convertedCount += funnelConverted.get(funnelId) ? 1 : 0;
      }

      digest.selected += 1;
      digest.idChecksum += ((idValues.get(entityId) as string | undefined) ?? "").length;
      digest.scoreChecksum = round2(digest.scoreChecksum + (((scores.get(entityId) as number | undefined) ?? 0) + (retentionId ? ((retentionValues.get(retentionId) as number | undefined) ?? 0) : 0)));
      digest.totalChecksum = round2(digest.totalChecksum + totalSpent);
      digest.fragileCount += fragileCount;
      digest.convertedCount += convertedCount;
    }
  }

  return digest;
}

function runReadScenarioWithPreparedQuery(context: ReturnType<typeof createAdapterAccessContext>): ReadDigest {
  const batchEntityIds = context.batchEntityIds;
  const idValues = requirePreparedScalar<string>(context.query.fields.idValues, "id");
  const scores = requirePreparedScalar<number>(context.query.fields.scores, "profile.score");
  const retention = requirePreparedArray(context.query.fields.retention, "analytics.retention");
  const retentionValues = requirePreparedScalar<number>(context.query.fields.retentionValues, "analytics.retention.$");
  const orders = requirePreparedArray(context.query.fields.orders, "orders");
  const orderTotals = requirePreparedScalar<number>(context.query.fields.orderTotals, "orders.$.total");
  const orderItems = requirePreparedArray(context.query.fields.orderItems, "orders.$.items");
  const fragile = requirePreparedScalar<boolean>(context.query.fields.fragile, "orders.$.items.$.attributes.fragile");
  const funnels = requirePreparedArray(context.query.fields.funnels, "analytics.funnels");
  const funnelConverted = requirePreparedScalar<boolean>(context.query.fields.funnelConverted, "analytics.funnels.$.converted");
  let digest = emptyReadDigest();

  for (let repeat = 0; repeat < BATCH_READ_REPEATS; repeat += 1) {
    digest = emptyReadDigest();

    for (const entityId of batchEntityIds) {
      const retentionId = retention.ids(entityId)[0];
      let totalSpent = 0;
      let fragileCount = 0;
      let convertedCount = 0;

      for (const orderId of orders.ids(entityId)) {
        totalSpent += (orderTotals.get(orderId) as number | undefined) ?? 0;

        for (const itemId of orderItems.ids(orderId)) {
          fragileCount += fragile.get(itemId) ? 1 : 0;
        }
      }

      for (const funnelId of funnels.ids(entityId)) {
        convertedCount += funnelConverted.get(funnelId) ? 1 : 0;
      }

      digest.selected += 1;
      digest.idChecksum += ((idValues.get(entityId) as string | undefined) ?? "").length;
      digest.scoreChecksum = round2(digest.scoreChecksum + (((scores.get(entityId) as number | undefined) ?? 0) + (retentionId ? ((retentionValues.get(retentionId) as number | undefined) ?? 0) : 0)));
      digest.totalChecksum = round2(digest.totalChecksum + totalSpent);
      digest.fragileCount += fragileCount;
      digest.convertedCount += convertedCount;
    }
  }

  return digest;
}

function runMutationScenarioWithAdapter(context: ReturnType<typeof createAdapterAccessContext>): DatasetDigest {
  const { adapter, batchEntityIds, retention, retentionValues, orders, orderTotals, funnels } = context;

  for (let repeat = 0; repeat < BATCH_UPDATE_REPEATS; repeat += 1) {
    for (const [index, id] of batchEntityIds.entries()) {
      const score = (adapter.getField(id, ["profile", "score"]) as number | undefined) ?? 0;
      const retentionId = retention.ids(id)[0];
      const orderId = orders.ids(id)[0];
      const funnelId = funnels.ids(id)[0];

      adapter.setField(id, ["profile", "score"], round2(score + (index % 7) * 0.01));
      adapter.setField(id, ["profile", "preferences", "tags"], ["batch", `${repeat}`, `${index % 5}`]);

      if (retentionId) {
        adapter.setField(retentionId, ["analytics", "retention", "$"] , round4((((retentionValues.get(retentionId) as number | undefined) ?? 0) + 0.001)));
      }

      if (orderId) {
        adapter.setField(orderId, ["orders", "$", "total"], round2((((orderTotals.get(orderId) as number | undefined) ?? 0) + 0.05)));
      }

      if (funnelId) {
        adapter.setField(funnelId, ["analytics", "funnels", "$", "converted"], index % 2 === 0);
      }
    }
  }

  return summarizeSelectedAdapterDataset(context);
}

function runMutationScenarioWithNative(context: ReturnType<typeof createNativeAccessContext>): DatasetDigest {
  for (let repeat = 0; repeat < BATCH_UPDATE_REPEATS; repeat += 1) {
    for (const [position, recordId] of context.batchRecordIds.entries()) {
      const record = context.records.find((entry) => entry.id === recordId);

      if (!record) {
        continue;
      }

      record.profile.score = round2(record.profile.score + (position % 7) * 0.01);
      record.profile.preferences.tags = ["batch", `${repeat}`, `${position % 5}`];

      if (record.analytics.retention[0] !== undefined) {
        record.analytics.retention[0] = round4(record.analytics.retention[0] + 0.001);
      }

      if (record.orders[0]) {
        record.orders[0].total = round2(record.orders[0].total + 0.05);
      }

      if (record.analytics.funnels[0]) {
        record.analytics.funnels[0].converted = position % 2 === 0;
      }
    }
  }

  return summarizeSelectedNativeDataset(context);
}

function summarizeSelectedAdapterDataset(context: ReturnType<typeof createAdapterAccessContext>): DatasetDigest {
  const { adapter, batchEntityIds, orders } = context;
  return batchEntityIds.reduce<DatasetDigest>((summary, id) => {
    const orderIds = orders.ids(id);
    const tags = (adapter.getField(id, ["profile", "preferences", "tags"]) as string[] | undefined) ?? [];
    let revenue = 0;
    let totalItems = 0;

    for (const orderId of orderIds) {
      revenue = round2(revenue + (((adapter.getField(orderId, ["orders", "$", "total"]) as number | undefined) ?? 0)));
      totalItems += context.orderItems.ids(orderId).length;
    }

    summary.length += 1;
    summary.activeCount += adapter.getField(id, ["active"]) ? 1 : 0;
    summary.totalOrders += orderIds.length;
    summary.totalItems += totalItems;
    summary.tagChecksum += tags.join("|").length;
    summary.scoreChecksum = round2(summary.scoreChecksum + (((adapter.getField(id, ["profile", "score"]) as number | undefined) ?? 0)));
    summary.revenueChecksum = round2(summary.revenueChecksum + revenue);
    return summary;
  }, createEmptyDatasetDigest());
}

function summarizeSelectedNativeDataset(context: ReturnType<typeof createNativeAccessContext>): DatasetDigest {
  return context.batchRecordIds.reduce<DatasetDigest>((summary, recordId) => {
    const record = context.records.find((entry) => entry.id === recordId);

    if (!record) {
      return summary;
    }

    summary.length += 1;
    summary.activeCount += record.active ? 1 : 0;
    summary.totalOrders += record.orders.length;
    summary.totalItems += record.orders.reduce((sum, order) => sum + order.items.length, 0);
    summary.tagChecksum += record.profile.preferences.tags.join("|").length;
    summary.scoreChecksum = round2(summary.scoreChecksum + record.profile.score);
    summary.revenueChecksum = round2(summary.revenueChecksum + record.orders.reduce((sum, order) => sum + order.total, 0));
    return summary;
  }, createEmptyDatasetDigest());
}

function summarizeDataset(data: readonly MockRecord[]): DatasetDigest {
  return data.reduce<DatasetDigest>(
    (summary, record) => {
      const orderCount = record.orders.length;
      const itemCount = record.orders.reduce(
        (sum, order) => sum + order.items.length,
        0,
      );
      const revenue = record.orders.reduce(
        (sum, order) => sum + order.total,
        0,
      );

      summary.length += 1;
      summary.activeCount += record.active ? 1 : 0;
      summary.totalOrders += orderCount;
      summary.totalItems += itemCount;
      summary.tagChecksum += record.profile.preferences.tags.join("|").length;
      summary.scoreChecksum = round2(
        summary.scoreChecksum + record.profile.score,
      );
      summary.revenueChecksum = round2(summary.revenueChecksum + revenue);
      return summary;
    },
    createEmptyDatasetDigest(),
  );
}

function benchmark<T>(iterations: number, task: () => T): ScenarioMetrics<T> {
  const durations: number[] = [];
  let result = task();

  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    result = task();
    durations.push(performance.now() - start);
  }

  return {
    averageMs: round2(
      durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
    ),
    minMs: round2(Math.min(...durations)),
    maxMs: round2(Math.max(...durations)),
    result,
  };
}

function benchmarkWithSetup<TContext, TResult>(
  iterations: number,
  setup: () => TContext,
  task: (context: TContext) => TResult,
): ScenarioMetrics<TResult> {
  const durations: number[] = [];
  let result = task(setup());

  for (let index = 0; index < iterations; index += 1) {
    const context = setup();
    const start = performance.now();
    result = task(context);
    durations.push(performance.now() - start);
  }

  return {
    averageMs: round2(
      durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
    ),
    minMs: round2(Math.min(...durations)),
    maxMs: round2(Math.max(...durations)),
    result,
  };
}

function createEmptyDatasetDigest(): DatasetDigest {
  return {
    length: 0,
    activeCount: 0,
    totalOrders: 0,
    totalItems: 0,
    tagChecksum: 0,
    scoreChecksum: 0,
    revenueChecksum: 0,
  };
}

function emptyReadDigest(): ReadDigest {
  return {
    selected: 0,
    idChecksum: 0,
    scoreChecksum: 0,
    totalChecksum: 0,
    fragileCount: 0,
    convertedCount: 0,
  };
}

function emptyPointReadDigest(): PointReadDigest {
  return {
    id: "",
    score: 0,
    retention0: 0,
    orderTotal: 0,
    fragile: false,
    converted: false,
  };
}

function emptyPointUpdateDigest(): PointUpdateDigest {
  return {
    score: 0,
    tagsChecksum: 0,
    retention0: 0,
    orderTotal: 0,
    converted: false,
  };
}

function pickSampleIndexes(length: number, sampleSize: number): number[] {
  if (length <= 0 || sampleSize <= 0) {
    return [];
  }

  const step = Math.max(1, Math.floor(length / Math.min(length, sampleSize)));
  const indexes: number[] = [];

  for (let index = 0; index < length && indexes.length < sampleSize; index += step) {
    indexes.push(index);
  }

  if (indexes[indexes.length - 1] !== length - 1 && indexes.length < sampleSize) {
    indexes.push(length - 1);
  }

  return indexes;
}

function pickSampleEntityIds(entityIds: readonly EntityId[], sampleSize: number): EntityId[] {
  return pickSampleIndexes(entityIds.length, sampleSize).map((index) => entityIds[index]).filter(Boolean) as EntityId[];
}

function toRow<T>(
  scenario: string,
  target: string,
  metrics: ScenarioMetrics<T>,
): Record<string, number | string> {
  return {
    scenario,
    target,
    averageMs: metrics.averageMs,
    minMs: metrics.minMs,
    maxMs: metrics.maxMs,
  };
}

function reportScenario(
  label: string,
  rows: Array<Record<string, number | string>>,
): void {
  console.info(`performance scenario: ${label}`);
  console.table(rows);
}

function requirePreparedScalar<T>(
  node:
    | {
        kind: string;
        values?: readonly unknown[];
        raw?: ArrayLike<unknown>;
        get?: (id: EntityId) => unknown;
        set?: (id: EntityId, value: unknown) => boolean;
      }
    | undefined,
  label: string,
): {
  values: readonly T[];
  raw: ArrayLike<T>;
  get(id: EntityId): T | undefined;
  set(id: EntityId, value: T): boolean;
} {
  if (
    !node ||
    node.kind !== "scalar" ||
    node.values === undefined ||
    node.raw === undefined ||
    node.get === undefined ||
    node.set === undefined
  ) {
    throw new Error(`missing prepared scalar column: ${label}`);
  }

  return node as {
    values: readonly T[];
    raw: ArrayLike<T>;
    get(id: EntityId): T | undefined;
    set(id: EntityId, value: T): boolean;
  };
}

function requirePreparedArray(
  node:
    | {
        kind: string;
        range?: (index: number) => { start: number; end: number; length: number };
        rangeById?: (id: EntityId) => { start: number; end: number; length: number };
        ids?: (id: EntityId) => readonly EntityId[];
      }
    | undefined,
  label: string,
): {
  range(index: number): { start: number; end: number; length: number };
  rangeById(id: EntityId): { start: number; end: number; length: number };
  ids(id: EntityId): readonly EntityId[];
} {
  if (
    !node ||
    node.kind !== "array" ||
    node.range === undefined ||
    node.rangeById === undefined ||
    node.ids === undefined
  ) {
    throw new Error(`missing prepared array column: ${label}`);
  }

  return node as {
    range(index: number): { start: number; end: number; length: number };
    rangeById(id: EntityId): { start: number; end: number; length: number };
    ids(id: EntityId): readonly EntityId[];
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
