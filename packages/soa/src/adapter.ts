import { z } from "zod";

type AnySchema = z.ZodTypeAny;

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type UnknownMap = Map<unknown, unknown>;
type UnknownSet = Set<unknown>;

export type PartialDeep<T> = T extends Primitive | Date | UnknownMap | UnknownSet
  ? T
  : T extends Array<infer TItem>
    ? Array<PartialDeep<TItem>>
    : T extends object
      ? { [K in keyof T]?: PartialDeep<T[K]> }
      : T;

export type Criteria<T> =
  | PartialDeep<T>
  | ((item: T, index: number, array: readonly T[]) => boolean);

export type ScalarLayout = {
  kind: "scalar";
  values: unknown[];
};

export type ObjectLayout = {
  kind: "object";
  fields: Record<string, LayoutNode>;
};

export type ArrayLayout = {
  kind: "array";
  lengths: number[];
  items: LayoutNode;
};

export type LayoutNode = ScalarLayout | ObjectLayout | ArrayLayout;
export type LayoutPathSegment = string | "[]" | "$";
export type EntityId = readonly number[];
export type PreparedArrayRange = {
  start: number;
  end: number;
  length: number;
};

export type PreparedScalarNode = {
  kind: "scalar";
  path: readonly LayoutPathSegment[];
  valueType: "number" | "boolean" | "unknown";
  readonly raw: ArrayLike<unknown>;
  readonly values: readonly unknown[];
  at(index: number): unknown;
  get(id: EntityId): unknown;
  set(id: EntityId, value: unknown): boolean;
};

export type PreparedObjectNode = {
  kind: "object";
  path: readonly LayoutPathSegment[];
  fields: Record<string, PreparedLayoutNode>;
};

export type PreparedArrayNode = {
  kind: "array";
  path: readonly LayoutPathSegment[];
  readonly lengths: readonly number[];
  readonly offsets: readonly number[];
  items: PreparedLayoutNode;
  range(index: number): PreparedArrayRange;
  rangeById(id: EntityId): PreparedArrayRange;
  ids(id: EntityId): readonly EntityId[];
};

export type PreparedLayoutNode =
  | PreparedScalarNode
  | PreparedObjectNode
  | PreparedArrayNode;

export type PreparedQuery<
  TFields extends Record<string, PreparedLayoutNode | undefined> = Record<
    string,
    PreparedLayoutNode | undefined
  >,
> = {
  readonly length: number;
  fields: TFields;
};

type ScalarStorageKind = "number" | "boolean" | "unknown";

type ArrayEntityState = {
  ids: number[];
  indexById: Map<number, number>;
  nextId: number;
};

interface ScalarColumnStorage {
  readonly kind: ScalarStorageKind;
  readonly length: number;
  at(index: number): unknown;
  set(index: number, value: unknown): void;
  insert(index: number, value: unknown): void;
  delete(start: number, count: number): void;
  toArray(): unknown[];
  raw(): ArrayLike<unknown>;
}

const scalarStorageSymbol = Symbol("scalarStorage");
const arrayStateSymbol = Symbol("arrayState");

type CompiledScalarNode = {
  kind: "scalar";
  schema: AnySchema;
  storageKind: ScalarStorageKind;
};

type CompiledObjectNode = {
  kind: "object";
  schema: AnySchema;
  fields: Record<string, CompiledLayoutNode>;
};

type CompiledArrayNode = {
  kind: "array";
  schema: AnySchema;
  item: CompiledLayoutNode;
};

type CompiledLayoutNode =
  | CompiledScalarNode
  | CompiledObjectNode
  | CompiledArrayNode;

export interface IAdapter<T> {
  idMap?: Map<number, string | number>;
  readonly itemSchema: AnySchema;
  readonly layout: LayoutNode;
  readonly length: number;
  ids(): readonly EntityId[];
  get(id: EntityId): T | undefined;
  getField(id: EntityId, path: readonly LayoutPathSegment[]): unknown;
  setField(id: EntityId, path: readonly LayoutPathSegment[], value: unknown): boolean;
  getFieldRange(
    id: EntityId,
    path: readonly LayoutPathSegment[],
  ): PreparedArrayRange | undefined;
  select(path: readonly LayoutPathSegment[]): LayoutNode | undefined;
  column(path: readonly LayoutPathSegment[]): readonly unknown[] | undefined;
  lengths(path: readonly LayoutPathSegment[]): readonly number[] | undefined;
  prepare(path: readonly LayoutPathSegment[]): PreparedLayoutNode | undefined;
  prepareQuery<TPaths extends Record<string, readonly LayoutPathSegment[]>>(
    paths: TPaths,
  ): PreparedQuery<{ [K in keyof TPaths]: PreparedLayoutNode | undefined }>;
  scan<
    TFields extends Record<string, PreparedLayoutNode | undefined>,
    TResult,
  >(
    query: PreparedQuery<TFields>,
    scanner: (id: EntityId, fields: TFields) => TResult | undefined,
  ): TResult[];
  create(initial?: PartialDeep<T> | T): T;
  append(...items: Array<PartialDeep<T> | T>): EntityId[];
  insertAt(index: number, ...items: Array<PartialDeep<T> | T>): EntityId[];
  update(
    id: EntityId,
    patch:
      | PartialDeep<T>
      | T
      | ((current: T, id: EntityId) => PartialDeep<T> | T),
  ): T | undefined;
  remove(id: EntityId): T | undefined;
  pushDefault(count?: number): EntityId[];
  toJSON(): T[];
}

class SoAAdapter<TValue> implements IAdapter<TValue> {
  idMap?: Map<number, string | number>;
  readonly itemSchema: AnySchema;
  readonly itemPlan: CompiledLayoutNode;
  readonly pathIndex: ReadonlyMap<string, CompiledLayoutNode>;
  layout: LayoutNode;
  length = 0;
  private layoutRevision = 0;
  private readonly preparedCache = new Map<string, PreparedLayoutNode>();
  private readonly entityIds: number[] = [];
  private readonly rowIndexById = new Map<number, number>();
  private nextEntityId = 1;

  constructor(
    schema: AnySchema,
    initialData: ReadonlyArray<PartialDeep<TValue> | TValue> = [],
  ) {
    this.itemSchema = normalizeItemSchema(schema);
    this.itemPlan = compileLayout(this.itemSchema);
    this.pathIndex = createPathIndex(this.itemPlan);
    this.layout = createLayout(this.itemPlan);

    if (initialData.length > 0) {
      this.insertNormalized(0, initialData.map((item) => this.create(item)));
    }
  }

  create(initial?: PartialDeep<TValue> | TValue): TValue {
    const seeded = mergeWithPlan(this.itemPlan, undefined, initial);
    return this.itemSchema.parse(seeded) as TValue;
  }

  append(...items: Array<PartialDeep<TValue> | TValue>): EntityId[] {
    if (items.length === 0) {
      return [];
    }

    return this.insertNormalized(
      this.length,
      items.map((item) => this.create(item)),
    );
  }

  insertAt(
    index: number,
    ...items: Array<PartialDeep<TValue> | TValue>
  ): EntityId[] {
    if (items.length === 0) {
      return [];
    }

    return this.insertNormalized(
      normalizeInsertIndex(index, this.length),
      items.map((item) => this.create(item)),
    );
  }

  ids(): readonly EntityId[] {
    return this.entityIds.map((id) => [id]);
  }

  get(id: EntityId): TValue | undefined {
    const normalizedIndex = getRootRowIndex(this.rowIndexById, id);

    if (normalizedIndex === undefined) {
      return undefined;
    }

    return readValue(this.itemPlan, this.layout, normalizedIndex) as TValue;
  }

  getField(id: EntityId, path: readonly LayoutPathSegment[]): unknown {
    const plan = this.pathIndex.get(toPathKey(path));
    const target = resolveEntityTarget(this.layout, this.rowIndexById, id, path);

    if (!plan || !target) {
      return undefined;
    }

    return readValue(plan, target.layout, target.index);
  }

  setField(
    id: EntityId,
    path: readonly LayoutPathSegment[],
    value: unknown,
  ): boolean {
    const plan = this.pathIndex.get(toPathKey(path));
    const target = resolveEntityTarget(this.layout, this.rowIndexById, id, path);

    if (!plan || !target) {
      return false;
    }

    const current = readValue(plan, target.layout, target.index);
    const normalized = plan.schema.parse(mergeWithPlan(plan, current, value));

    assignValue(plan, target.layout, target.index, normalized);
    this.touchLayout();
    return true;
  }

  getFieldRange(
    id: EntityId,
    path: readonly LayoutPathSegment[],
  ): PreparedArrayRange | undefined {
    const prepared = this.prepare(path);

    if (!prepared || prepared.kind !== "array") {
      return undefined;
    }

    return prepared.rangeById(id);
  }

  select(path: readonly LayoutPathSegment[]): LayoutNode | undefined {
    return selectLayoutNode(this.layout, path);
  }

  column(path: readonly LayoutPathSegment[]): readonly unknown[] | undefined {
    const node = this.select(path);
    return node?.kind === "scalar" ? getScalarValues(node) : undefined;
  }

  lengths(path: readonly LayoutPathSegment[]): readonly number[] | undefined {
    const node = this.select(path);
    return node?.kind === "array" ? node.lengths : undefined;
  }

  prepare(path: readonly LayoutPathSegment[]): PreparedLayoutNode | undefined {
    const key = toPathKey(path);
    const cached = this.preparedCache.get(key);

    if (cached) {
      return cached;
    }

    if (!this.pathIndex.has(key)) {
      return undefined;
    }

    const current = this.select(path);

    if (!current) {
      return undefined;
    }

    const prepared = createPreparedNode(
      path,
      current,
      () => this.layout,
      () => this.layoutRevision,
      (id) => this.rowIndexById.get(id),
      () => this.touchLayout(),
    );

    this.preparedCache.set(key, prepared);
    return prepared;
  }

  prepareQuery<TPaths extends Record<string, readonly LayoutPathSegment[]>>(
    paths: TPaths,
  ): PreparedQuery<{ [K in keyof TPaths]: PreparedLayoutNode | undefined }> {
    const adapter = this;
    const fields = Object.fromEntries(
      Object.entries(paths).map(([key, path]) => [key, this.prepare(path)]),
    ) as { [K in keyof TPaths]: PreparedLayoutNode | undefined };

    return {
      get length() {
        return adapter.length;
      },
      fields,
    };
  }

  scan<
    TFields extends Record<string, PreparedLayoutNode | undefined>,
    TResult,
  >(
    query: PreparedQuery<TFields>,
    scanner: (id: EntityId, fields: TFields) => TResult | undefined,
  ): TResult[] {
    const results: TResult[] = [];

    for (const id of this.entityIds) {
      const value = scanner([id], query.fields);

      if (value !== undefined) {
        results.push(value);
      }
    }

    return results;
  }

  update(
    id: EntityId,
    patch:
      | PartialDeep<TValue>
      | TValue
      | ((current: TValue, id: EntityId) => PartialDeep<TValue> | TValue),
  ): TValue | undefined {
    const normalizedIndex = getRootRowIndex(this.rowIndexById, id);

    if (normalizedIndex === undefined) {
      return undefined;
    }

    const current = this.get(id);

    if (current === undefined) {
      return undefined;
    }

    const nextValue =
      isUpdater<TValue>(patch)
        ? patch(cloneValue(current), id)
        : patch;

    const normalized = this.itemSchema.parse(
      mergeWithPlan(this.itemPlan, current, nextValue),
    ) as TValue;

    this.assignAt(normalizedIndex, normalized);
    return normalized;
  }

  remove(id: EntityId): TValue | undefined {
    const normalizedIndex = getRootRowIndex(this.rowIndexById, id);

    if (normalizedIndex === undefined) {
      return undefined;
    }

    const removed = this.get(id);

    if (removed === undefined) {
      return undefined;
    }

    deleteRange(this.itemPlan, this.layout, normalizedIndex, 1);
    this.rowIndexById.delete(id[0]);
    this.entityIds.splice(normalizedIndex, 1);
    this.length -= 1;
    this.reindexFrom(normalizedIndex);
    this.touchLayout();
    return removed;
  }

  pushDefault(count = 1): EntityId[] {
    const additions = Array.from({ length: Math.max(0, count) }, () =>
      this.create(),
    );

    return this.insertNormalized(this.length, additions);
  }

  toJSON(): TValue[] {
    return Array.from({ length: this.length }, (_, index) =>
      cloneValue(readValue(this.itemPlan, this.layout, index) as TValue),
    );
  }

  private assignAt(index: number, value: TValue): void {
    assignValue(this.itemPlan, this.layout, index, value);
    this.touchLayout();
  }

  private insertNormalized(index: number, items: readonly TValue[]): EntityId[] {
    const ids = items.map(() => this.nextEntityId++);

    for (const [offset, item] of items.entries()) {
      insertValue(this.itemPlan, this.layout, index + offset, item);
      this.entityIds.splice(index + offset, 0, ids[offset]);
    }

    this.length += items.length;
    this.reindexFrom(index);

    if (items.length > 0) {
      this.touchLayout();
    }

    return ids.map((id) => [id]);
  }

  private touchLayout(): void {
    this.layoutRevision += 1;
  }

  private reindexFrom(start: number): void {
    for (let index = start; index < this.entityIds.length; index += 1) {
      this.rowIndexById.set(this.entityIds[index], index);
    }
  }
}

export function createAdapter<TItemSchema extends AnySchema>(
  schema: z.ZodArray<TItemSchema>,
  initialData?: ReadonlyArray<
    PartialDeep<z.infer<TItemSchema>> | z.infer<TItemSchema>
  >,
): IAdapter<z.infer<TItemSchema>>;
export function createAdapter<TSchema extends AnySchema>(
  schema: TSchema,
  initialData?: ReadonlyArray<PartialDeep<z.infer<TSchema>> | z.infer<TSchema>>,
): IAdapter<z.infer<TSchema>>;
export function createAdapter(
  schema: AnySchema,
  initialData: readonly unknown[] = [],
): IAdapter<unknown> {
  return new SoAAdapter(schema, initialData);
}

function toPathKey(path: readonly LayoutPathSegment[]): string {
  return path.map((segment) => segment === "$" ? "[]" : segment).join("\u0001");
}

function getRootRowIndex(
  rowIndexById: ReadonlyMap<number, number>,
  id: EntityId,
): number | undefined {
  if (id.length !== 1) {
    return undefined;
  }

  return rowIndexById.get(id[0]);
}

function createScalarLayout(plan: CompiledScalarNode): ScalarLayout {
  const storage = createScalarStorage(plan.storageKind);
  const layout = { kind: "scalar" } as ScalarLayout;

  Object.defineProperty(layout, "values", {
    enumerable: true,
    configurable: true,
    get() {
      return storage.toArray();
    },
  });
  Object.defineProperty(layout, scalarStorageSymbol, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: storage,
  });

  return layout;
}

function createScalarStorage(kind: ScalarStorageKind): ScalarColumnStorage {
  if (kind === "number") {
    return new NumberColumnStorage();
  }

  if (kind === "boolean") {
    return new BooleanColumnStorage();
  }

  return new ArrayColumnStorage();
}

function getScalarStorage(
  layout: LayoutNode | undefined,
): ScalarColumnStorage | undefined {
  if (!layout || layout.kind !== "scalar") {
    return undefined;
  }

  return (layout as ScalarLayout & { [scalarStorageSymbol]?: ScalarColumnStorage })[
    scalarStorageSymbol
  ];
}

function getScalarValues(layout: ScalarLayout): unknown[] {
  return getScalarStorage(layout)?.toArray() ?? [];
}

function normalizeItemSchema<TSchema extends AnySchema>(schema: TSchema): AnySchema {
  const unwrapped = unwrapSchema(schema);
  return unwrapped instanceof z.ZodArray
    ? (unwrapped.element as unknown as AnySchema)
    : unwrapped;
}

function compileLayout(schema: AnySchema): CompiledLayoutNode {
  const normalizedSchema = unwrapSchema(schema);

  if (normalizedSchema instanceof z.ZodArray) {
    return {
      kind: "array",
      schema: normalizedSchema,
      item: compileLayout(normalizedSchema.element as unknown as AnySchema),
    };
  }

  if (normalizedSchema instanceof z.ZodObject) {
    return {
      kind: "object",
      schema: normalizedSchema,
      fields: Object.fromEntries(
        Object.entries(normalizedSchema.shape).map(([key, childSchema]) => [
          key,
          compileLayout(childSchema),
        ]),
      ),
    };
  }

  return {
    kind: "scalar",
    schema: normalizedSchema,
    storageKind: inferScalarStorageKind(normalizedSchema),
  };
}

function inferScalarStorageKind(schema: AnySchema): ScalarStorageKind {
  if (schema instanceof z.ZodNumber) {
    return "number";
  }

  if (schema instanceof z.ZodBoolean) {
    return "boolean";
  }

  return "unknown";
}

function createPathIndex(plan: CompiledLayoutNode): Map<string, CompiledLayoutNode> {
  const index = new Map<string, CompiledLayoutNode>();

  const visit = (
    current: CompiledLayoutNode,
    path: readonly LayoutPathSegment[],
  ): void => {
    index.set(toPathKey(path), current);

    if (current.kind === "object") {
      for (const [key, child] of Object.entries(current.fields)) {
        visit(child, [...path, key]);
      }
      return;
    }

    if (current.kind === "array") {
      visit(current.item, [...path, "[]"]);
    }
  };

  visit(plan, []);
  return index;
}

function unwrapSchema(schema: AnySchema): AnySchema {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrapSchema(schema.unwrap() as unknown as AnySchema);
  }

  if (schema instanceof z.ZodDefault) {
    return unwrapSchema((schema as unknown as { _def: { innerType: AnySchema } })._def.innerType);
  }

  if (schema instanceof z.ZodLazy) {
    return unwrapSchema(
      (schema as unknown as { _def: { getter: () => AnySchema } })._def.getter(),
    );
  }

  return schema;
}

function createLayout(plan: CompiledLayoutNode): LayoutNode {
  if (plan.kind === "array") {
    return createArrayLayout(plan.item);
  }

  if (plan.kind === "object") {
    const fields = Object.fromEntries(
      Object.entries(plan.fields).map(([key, childPlan]) => [
        key,
        createLayout(childPlan),
      ]),
    );

    return {
      kind: "object",
      fields,
    };
  }

  return createScalarLayout(plan);
}

function selectLayoutNode(
  layout: LayoutNode,
  path: readonly LayoutPathSegment[],
): LayoutNode | undefined {
  let current: LayoutNode | undefined = layout;

  for (const segment of path) {
    if (segment === "[]" || segment === "$") {
      if (current?.kind !== "array") {
        return undefined;
      }

      current = current.items;
      continue;
    }

    if (current?.kind !== "object") {
      return undefined;
    }

    current = current.fields[segment];
  }

  return current;
}

function createArrayLayout(itemPlan: CompiledLayoutNode): ArrayLayout {
  const state: ArrayEntityState = {
    ids: [],
    indexById: new Map<number, number>(),
    nextId: 1,
  };
  const layout: ArrayLayout = {
    kind: "array",
    lengths: [],
    items: createLayout(itemPlan),
  };

  Object.defineProperty(layout, arrayStateSymbol, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: state,
  });

  return layout;
}

function getArrayState(layout: LayoutNode | undefined): ArrayEntityState | undefined {
  if (!layout || layout.kind !== "array") {
    return undefined;
  }

  return (layout as ArrayLayout & { [arrayStateSymbol]?: ArrayEntityState })[
    arrayStateSymbol
  ];
}

function allocateArrayEntityIds(layout: ArrayLayout, count: number): number[] {
  const state = getArrayState(layout);

  if (!state || count <= 0) {
    return [];
  }

  return Array.from({ length: count }, () => state.nextId++);
}

function reindexArrayState(state: ArrayEntityState, start: number): void {
  for (let index = start; index < state.ids.length; index += 1) {
    state.indexById.set(state.ids[index], index);
  }
}

function insertArrayEntityIds(layout: ArrayLayout, index: number, ids: readonly number[]): void {
  const state = getArrayState(layout);

  if (!state || ids.length === 0) {
    return;
  }

  state.ids.splice(index, 0, ...ids);
  reindexArrayState(state, index);
}

function deleteArrayEntityIds(layout: ArrayLayout, start: number, count: number): void {
  const state = getArrayState(layout);

  if (!state || count <= 0) {
    return;
  }

  for (const id of state.ids.slice(start, start + count)) {
    state.indexById.delete(id);
  }

  state.ids.splice(start, count);
  reindexArrayState(state, start);
}

function getArrayChildIndex(
  layout: ArrayLayout,
  parentIndex: number,
  childId: number,
): number | undefined {
  const state = getArrayState(layout);

  if (!state) {
    return undefined;
  }

  const childIndex = state.indexById.get(childId);

  if (childIndex === undefined) {
    return undefined;
  }

  const range = getArrayRange(layout, parentIndex);
  return childIndex >= range.start && childIndex < range.end ? childIndex : undefined;
}

function getArrayChildIds(layout: ArrayLayout, parentIndex: number): readonly number[] {
  const state = getArrayState(layout);

  if (!state) {
    return [];
  }

  const range = getArrayRange(layout, parentIndex);
  return state.ids.slice(range.start, range.end);
}

function getArrayRange(layout: ArrayLayout, index: number): PreparedArrayRange {
  const start = getArrayOffset(layout.lengths, index);
  const length = layout.lengths[index] ?? 0;

  return {
    start,
    end: start + length,
    length,
  };
}

class ArrayColumnStorage implements ScalarColumnStorage {
  readonly kind = "unknown" as const;
  private readonly values: unknown[] = [];

  get length(): number {
    return this.values.length;
  }

  at(index: number): unknown {
    return cloneValue(this.values[index]);
  }

  set(index: number, value: unknown): void {
    this.values[index] = cloneValue(value);
  }

  insert(index: number, value: unknown): void {
    this.values.splice(index, 0, cloneValue(value));
  }

  delete(start: number, count: number): void {
    this.values.splice(start, count);
  }

  toArray(): unknown[] {
    return this.values.map((value) => cloneValue(value));
  }

  raw(): ArrayLike<unknown> {
    return this.values;
  }
}

class NumberColumnStorage implements ScalarColumnStorage {
  readonly kind = "number" as const;
  private buffer = new Float64Array(0);
  private size = 0;

  get length(): number {
    return this.size;
  }

  at(index: number): unknown {
    return this.buffer[index];
  }

  set(index: number, value: unknown): void {
    this.buffer[index] = typeof value === "number" ? value : Number(value ?? 0);
  }

  insert(index: number, value: unknown): void {
    this.ensureCapacity(this.size + 1);

    if (index < this.size) {
      this.buffer.copyWithin(index + 1, index, this.size);
    }

    this.set(index, value);
    this.size += 1;
  }

  delete(start: number, count: number): void {
    if (count <= 0) {
      return;
    }

    const deleteEnd = start + count;

    if (deleteEnd < this.size) {
      this.buffer.copyWithin(start, deleteEnd, this.size);
    }

    this.size = Math.max(0, this.size - count);
  }

  toArray(): unknown[] {
    return Array.from(this.buffer.subarray(0, this.size));
  }

  raw(): ArrayLike<unknown> {
    return this.buffer.subarray(0, this.size);
  }

  private ensureCapacity(minCapacity: number): void {
    if (this.buffer.length >= minCapacity) {
      return;
    }

    const nextCapacity = Math.max(minCapacity, this.buffer.length === 0 ? 8 : this.buffer.length * 2);
    const nextBuffer = new Float64Array(nextCapacity);
    nextBuffer.set(this.buffer.subarray(0, this.size));
    this.buffer = nextBuffer;
  }
}

class BooleanColumnStorage implements ScalarColumnStorage {
  readonly kind = "boolean" as const;
  private buffer = new Uint8Array(0);
  private size = 0;

  get length(): number {
    return this.size;
  }

  at(index: number): unknown {
    return this.buffer[index] === 1;
  }

  set(index: number, value: unknown): void {
    this.buffer[index] = value ? 1 : 0;
  }

  insert(index: number, value: unknown): void {
    this.ensureCapacity(this.size + 1);

    if (index < this.size) {
      this.buffer.copyWithin(index + 1, index, this.size);
    }

    this.set(index, value);
    this.size += 1;
  }

  delete(start: number, count: number): void {
    if (count <= 0) {
      return;
    }

    const deleteEnd = start + count;

    if (deleteEnd < this.size) {
      this.buffer.copyWithin(start, deleteEnd, this.size);
    }

    this.size = Math.max(0, this.size - count);
  }

  toArray(): unknown[] {
    return Array.from(this.buffer.subarray(0, this.size), (value) => value === 1);
  }

  raw(): ArrayLike<unknown> {
    return this.buffer.subarray(0, this.size);
  }

  private ensureCapacity(minCapacity: number): void {
    if (this.buffer.length >= minCapacity) {
      return;
    }

    const nextCapacity = Math.max(minCapacity, this.buffer.length === 0 ? 8 : this.buffer.length * 2);
    const nextBuffer = new Uint8Array(nextCapacity);
    nextBuffer.set(this.buffer.subarray(0, this.size));
    this.buffer = nextBuffer;
  }
}

function createPreparedNode(
  path: readonly LayoutPathSegment[],
  current: LayoutNode,
  getLayout: () => LayoutNode,
  getRevision: () => number,
  indexOfId: (id: number) => number | undefined,
  onMutate: () => void,
): PreparedLayoutNode {
  const resolveNode = createPreparedResolver(path, getLayout, getRevision);

  if (current.kind === "scalar") {
    return {
      kind: "scalar",
      path,
      valueType: getScalarStorage(resolveNode())?.kind ?? "unknown",
      get raw() {
        return getScalarStorage(resolveNode())?.raw() ?? [];
      },
      get values() {
        const node = resolveNode();
        return node?.kind === "scalar" ? getScalarValues(node) : [];
      },
      at(index: number) {
        return getScalarStorage(resolveNode())?.at(index);
      },
      get(id: EntityId) {
        const target = resolveEntityTarget(getLayout(), indexOfId, id, path);
        return target?.layout.kind === "scalar"
          ? getScalarStorage(target.layout)?.at(target.index)
          : undefined;
      },
      set(id: EntityId, value: unknown) {
        const target = resolveEntityTarget(getLayout(), indexOfId, id, path);

        if (!target || target.layout.kind !== "scalar") {
          return false;
        }

        getScalarStorage(target.layout)?.set(target.index, value);
        onMutate();
        return true;
      },
    };
  }

  if (current.kind === "object") {
    return {
      kind: "object",
      path,
      fields: Object.fromEntries(
        Object.entries(current.fields).map(([key, child]) => [
          key,
          createPreparedNode([...path, key], child, getLayout, getRevision, indexOfId, onMutate),
        ]),
      ),
    };
  }

  return createPreparedArrayNode(path, current, getLayout, getRevision, indexOfId, onMutate);
}

function createPreparedArrayNode(
  path: readonly LayoutPathSegment[],
  current: ArrayLayout,
  getLayout: () => LayoutNode,
  getRevision: () => number,
  indexOfId: (id: number) => number | undefined,
  onMutate: () => void,
): PreparedArrayNode {
  const resolveNode = createPreparedResolver(path, getLayout, getRevision);
  let offsetRevision = -1;
  let cachedOffsets: readonly number[] = [];

  const getNode = (): ArrayLayout | undefined => {
    const node = resolveNode();
    return node?.kind === "array" ? node : undefined;
  };

  const getOffsets = (): readonly number[] => {
    const node = getNode();

    if (!node) {
      return [];
    }

    const revision = getRevision();

    if (offsetRevision !== revision) {
      cachedOffsets = createOffsets(node.lengths);
      offsetRevision = revision;
    }

    return cachedOffsets;
  };

  return {
    kind: "array",
    path,
    get lengths() {
      return getNode()?.lengths ?? [];
    },
    get offsets() {
      return getOffsets();
    },
    items: createPreparedNode([...path, "[]"], current.items, getLayout, getRevision, indexOfId, onMutate),
    range(index: number): PreparedArrayRange {
      const node = getNode();
      return node ? getArrayRange(node, index) : { start: 0, end: 0, length: 0 };
    },
    rangeById(id: EntityId): PreparedArrayRange {
      const target = resolveEntityTarget(getLayout(), indexOfId, id, path);

      if (!target || target.layout.kind !== "array") {
        return { start: 0, end: 0, length: 0 };
      }

      return getArrayRange(target.layout, target.index);
    },
    ids(id: EntityId): readonly EntityId[] {
      const target = resolveEntityTarget(getLayout(), indexOfId, id, path);

      if (!target || target.layout.kind !== "array") {
        return [];
      }

      return getArrayChildIds(target.layout, target.index).map((childId) => [...id, childId]);
    },
  };
}

function createPreparedResolver(
  path: readonly LayoutPathSegment[],
  getLayout: () => LayoutNode,
  getRevision: () => number,
): () => LayoutNode | undefined {
  let cachedRevision = -1;
  let cachedNode: LayoutNode | undefined;

  return () => {
    const revision = getRevision();

    if (cachedRevision !== revision) {
      cachedNode = selectLayoutNode(getLayout(), path);
      cachedRevision = revision;
    }

    return cachedNode;
  };
}

function readValue(plan: CompiledLayoutNode, layout: LayoutNode, index: number): unknown {
  if (plan.kind === "array" && layout.kind === "array") {
    const start = getArrayOffset(layout.lengths, index);
    const length = layout.lengths[index] ?? 0;

    return Array.from({ length }, (_, offset) =>
      readValue(plan.item, layout.items, start + offset),
    );
  }

  if (plan.kind === "object" && layout.kind === "object") {
    return Object.fromEntries(
      Object.entries(plan.fields).map(([key, childPlan]) => [
        key,
        readValue(childPlan, layout.fields[key], index),
      ]),
    );
  }

  if (layout.kind === "scalar") {
    return cloneValue(getScalarStorage(layout)?.at(index));
  }

  return undefined;
}

function insertValue(
  plan: CompiledLayoutNode,
  layout: LayoutNode,
  index: number,
  value: unknown,
): void {
  if (plan.kind === "array" && layout.kind === "array") {
    const arrayValue = Array.isArray(value) ? value : [];
    const start = getArrayOffset(layout.lengths, index);
    const itemIds = allocateArrayEntityIds(layout, arrayValue.length);

    layout.lengths.splice(index, 0, arrayValue.length);
    insertArrayEntityIds(layout, start, itemIds);

    for (const [offset, item] of arrayValue.entries()) {
      insertValue(plan.item, layout.items, start + offset, item);
    }

    return;
  }

  if (plan.kind === "object" && layout.kind === "object") {
    const record = isRecord(value) ? value : {};

    for (const [key, childPlan] of Object.entries(plan.fields)) {
      insertValue(childPlan, layout.fields[key], index, record[key]);
    }

    return;
  }

  if (layout.kind === "scalar") {
    getScalarStorage(layout)?.insert(index, value);
  }
}

function assignValue(
  plan: CompiledLayoutNode,
  layout: LayoutNode,
  index: number,
  value: unknown,
): void {
  if (plan.kind === "array" && layout.kind === "array") {
    const arrayValue = Array.isArray(value) ? value : [];
    const start = getArrayOffset(layout.lengths, index);
    const currentLength = layout.lengths[index] ?? 0;

    deleteRange(plan.item, layout.items, start, currentLength);
    layout.lengths[index] = arrayValue.length;

    for (const [offset, item] of arrayValue.entries()) {
      insertValue(plan.item, layout.items, start + offset, item);
    }

    return;
  }

  if (plan.kind === "object" && layout.kind === "object") {
    const record = isRecord(value) ? value : {};

    for (const [key, childPlan] of Object.entries(plan.fields)) {
      assignValue(childPlan, layout.fields[key], index, record[key]);
    }

    return;
  }

  if (layout.kind === "scalar") {
    getScalarStorage(layout)?.set(index, value);
  }
}

function deleteRange(
  plan: CompiledLayoutNode,
  layout: LayoutNode,
  start: number,
  count: number,
): void {
  if (count <= 0) {
    return;
  }

  if (plan.kind === "array" && layout.kind === "array") {
    const nestedStart = getArrayOffset(layout.lengths, start);
    const removedLengths = layout.lengths.slice(start, start + count);
    const nestedCount = removedLengths.reduce(
      (total, length) => total + length,
      0,
    );

    layout.lengths.splice(start, count);
    deleteRange(plan.item, layout.items, nestedStart, nestedCount);
    deleteArrayEntityIds(layout, nestedStart, nestedCount);
    return;
  }

  if (plan.kind === "object" && layout.kind === "object") {
    for (const [key, childPlan] of Object.entries(plan.fields)) {
      deleteRange(childPlan, layout.fields[key], start, count);
    }

    return;
  }

  if (layout.kind === "scalar") {
    getScalarStorage(layout)?.delete(start, count);
  }
}

function getArrayOffset(lengths: readonly number[], index: number): number {
  let offset = 0;

  for (let cursor = 0; cursor < index; cursor += 1) {
    offset += lengths[cursor] ?? 0;
  }

  return offset;
}

function createOffsets(lengths: readonly number[]): number[] {
  const offsets = new Array<number>(lengths.length);
  let offset = 0;

  for (let index = 0; index < lengths.length; index += 1) {
    offsets[index] = offset;
    offset += lengths[index] ?? 0;
  }

  return offsets;
}

function resolveEntityTarget(
  rootLayout: LayoutNode,
  indexOfId: ReadonlyMap<number, number> | ((id: number) => number | undefined),
  id: EntityId,
  path: readonly LayoutPathSegment[],
): { layout: LayoutNode; index: number } | undefined {
  if (id.length === 0) {
    return undefined;
  }

  const resolveRootIndex = typeof indexOfId === "function"
    ? indexOfId
    : (value: number) => indexOfId.get(value);
  let current: LayoutNode | undefined = rootLayout;
  let currentIndex = resolveRootIndex(id[0]);
  let depth = 1;

  if (currentIndex === undefined) {
    return undefined;
  }

  for (const segment of path) {
    if (segment === "[]" || segment === "$") {
      if (current?.kind !== "array" || depth >= id.length) {
        return undefined;
      }

      const nextIndex = getArrayChildIndex(current, currentIndex, id[depth]);

      if (nextIndex === undefined) {
        return undefined;
      }

      current = current.items;
      currentIndex = nextIndex;
      depth += 1;
      continue;
    }

    if (current?.kind !== "object") {
      return undefined;
    }

    current = current.fields[segment];
  }

  if (!current || depth !== id.length) {
    return undefined;
  }

  return {
    layout: current,
    index: currentIndex,
  };
}

function mergeWithPlan(
  plan: CompiledLayoutNode,
  baseValue: unknown,
  patchValue: unknown,
): unknown {
  if (patchValue === undefined) {
    if (baseValue !== undefined) {
      return cloneValue(baseValue);
    }

    return createDefaultValue(plan);
  }

  if (plan.kind === "array") {
    if (!Array.isArray(patchValue)) {
      return [];
    }

    const baseArray = Array.isArray(baseValue) ? baseValue : [];
    return patchValue.map((item, index) =>
      mergeWithPlan(plan.item, baseArray[index], item),
    );
  }

  if (plan.kind === "object") {
    const baseRecord = isRecord(baseValue) ? { ...baseValue } : {};
    const patchRecord = isRecord(patchValue) ? patchValue : {};
    const result: Record<string, unknown> = {
      ...baseRecord,
      ...patchRecord,
    };

    for (const [key, childPlan] of Object.entries(plan.fields)) {
      result[key] = mergeWithPlan(childPlan, baseRecord[key], Object.hasOwn(patchRecord, key)
        ? patchRecord[key]
        : undefined);
    }

    return result;
  }

  return cloneValue(patchValue);
}

function createDefaultValue(plan: CompiledLayoutNode): unknown {
  const parsed = plan.schema.safeParse(undefined);

  if (parsed.success) {
    return cloneValue(parsed.data);
  }

  if (plan.kind === "array") {
    return [];
  }

  if (plan.kind === "object") {
    return Object.fromEntries(
      Object.entries(plan.fields).map(([key, childPlan]) => [
        key,
        createDefaultValue(childPlan),
      ]),
    );
  }

  if (plan.schema instanceof z.ZodString) {
    return "";
  }

  if (plan.schema instanceof z.ZodNumber) {
    return 0;
  }

  if (plan.schema instanceof z.ZodBoolean) {
    return false;
  }

  if (plan.schema instanceof z.ZodBigInt) {
    return BigInt(0);
  }

  if (plan.schema instanceof z.ZodDate) {
    return new Date(0);
  }

  if (plan.schema instanceof z.ZodLiteral) {
    const definition = plan.schema as unknown as {
      _def: { values?: Iterable<unknown>; value?: unknown };
    };

    if (definition._def.value !== undefined) {
      return cloneValue(definition._def.value);
    }

    if (definition._def.values) {
      const iterator = definition._def.values[Symbol.iterator]();
      const first = iterator.next();
      return first.done ? undefined : cloneValue(first.value);
    }
  }

  if (plan.schema instanceof z.ZodEnum) {
    return plan.schema.options[0];
  }

  if (plan.schema instanceof z.ZodUnion) {
    return createDefaultValue(compileLayout(plan.schema.options[0] as unknown as AnySchema));
  }

  return undefined;
}

function isUpdater<T>(
  value: unknown,
): value is (current: T, id: EntityId) => PartialDeep<T> | T {
  return typeof value === "function";
}

function normalizeInsertIndex(index: number, length: number): number {
  if (index < 0) {
    return Math.max(length + index, 0);
  }

  return Math.min(index, length);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (value instanceof Map) {
    return new Map(
      Array.from(value.entries(), ([key, entry]) => [key, cloneValue(entry)]),
    ) as T;
  }

  if (value instanceof Set) {
    return new Set(Array.from(value.values(), (entry) => cloneValue(entry))) as T;
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    ) as T;
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
