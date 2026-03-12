import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createAdapter, type EntityId } from "./adapter";

describe("id-based API 类型测试", () => {
  it("append 应返回稳定 id 列表", () => {
    const adapter = createAdapter(z.number());
    const ids = adapter.append(1, 2, 3);

    expectTypeOf(ids).toEqualTypeOf<EntityId[]>();
  });

  it("get 应保持元素类型", () => {
    const adapter = createAdapter(z.number());
    const [id] = adapter.append(1);

    expectTypeOf(adapter.get(id)).toEqualTypeOf<number | undefined>();
  });

  it("getField 应返回字段值", () => {
    const adapter = createAdapter(z.object({ score: z.number() }));
    const [id] = adapter.append({ score: 1 });

    expectTypeOf(adapter.getField(id, ["score"])).toEqualTypeOf<unknown>();
  });
});

describe("SoA id-based runtime", () => {
  const userSchema = z.object({
    id: z.string(),
    profile: z.object({
      age: z.number(),
      tags: z.array(
        z.object({
          name: z.string(),
          score: z.number(),
        }),
      ),
    }),
  });

  it("应该基于 schema 初始化，并通过稳定 id 读取实体", () => {
    const adapter = createAdapter(userSchema);
    const [entityId] = adapter.append({
      id: "user-1",
      profile: {
        tags: [{ name: "vip" }],
      },
    });

    expect(adapter.ids()).toEqual([entityId]);
    expect(adapter.getField(entityId, ["id"])).toBe("user-1");
    expect(adapter.getField(entityId, ["profile", "age"])).toBe(0);
    expect(adapter.getField(entityId, ["profile", "tags"])).toEqual([
      { name: "vip", score: 0 },
    ]);

    expect(adapter.layout).toEqual({
      kind: "object",
      fields: {
        id: { kind: "scalar", values: ["user-1"] },
        profile: {
          kind: "object",
          fields: {
            age: { kind: "scalar", values: [0] },
            tags: {
              kind: "array",
              lengths: [1],
              items: {
                kind: "object",
                fields: {
                  name: { kind: "scalar", values: ["vip"] },
                  score: { kind: "scalar", values: [0] },
                },
              },
            },
          },
        },
      },
    });
  });

  it("应该提供直接访问列存的接口", () => {
    const adapter = createAdapter(userSchema, [
      {
        id: "user-1",
        profile: {
          tags: [{ name: "vip", score: 3 }],
        },
      },
      {
        id: "user-2",
        profile: {
          age: 18,
          tags: [
            { name: "new", score: 1 },
            { name: "trial", score: 2 },
          ],
        },
      },
    ]);

    expect(adapter.column(["id"])).toEqual(["user-1", "user-2"]);
    expect(adapter.column(["profile", "age"])).toEqual([0, 18]);
    expect(adapter.lengths(["profile", "tags"])).toEqual([1, 2]);
    expect(adapter.column(["profile", "tags", "[]", "name"])).toEqual([
      "vip",
      "new",
      "trial",
    ]);
  });

  it("应该支持 prepared query 和按 id 的字段访问", () => {
    const adapter = createAdapter(userSchema, [
      {
        id: "user-1",
        profile: {
          tags: [{ name: "vip", score: 3 }],
        },
      },
      {
        id: "user-2",
        profile: {
          age: 18,
          tags: [
            { name: "new", score: 1 },
            { name: "trial", score: 2 },
          ],
        },
      },
    ]);

    const [firstId, secondId] = adapter.ids();
    const query = adapter.prepareQuery({
      ids: ["id"],
      tags: ["profile", "tags"],
      tagNames: ["profile", "tags", "$", "name"],
    });
    const ids = expectPreparedScalar(query.fields.ids);
    const tags = expectPreparedArray(query.fields.tags);
    const tagNames = expectPreparedScalar(query.fields.tagNames);
    const secondTagIds = tags.ids(secondId);

    expect(ids.get(firstId)).toBe("user-1");
    expect(tags.rangeById(secondId)).toEqual({ start: 1, end: 3, length: 2 });
    expect(secondTagIds).toHaveLength(2);
    expect(secondTagIds.map((tagId) => tagNames.get(tagId))).toEqual(["new", "trial"]);
    expect(
      adapter.scan(query, (id, fields) => {
        const tagRange = expectPreparedArray(fields.tags).rangeById(id);
        return tagRange.length > 1 ? expectPreparedScalar(fields.ids).get(id) : undefined;
      }),
    ).toEqual(["user-2"]);
  });

  it("应该支持按 id 与字段 key 更新和删除", () => {
    const adapter = createAdapter(userSchema);
    const [firstId] = adapter.append({ id: "user-1" });
    const [secondId] = adapter.insertAt(1, { id: "user-2", profile: { age: 18 } });

    expect(adapter.getField(secondId, ["id"])).toBe("user-2");
    expect(adapter.getField(secondId, ["profile", "age"])).toBe(18);

    expect(adapter.setField(firstId, ["profile", "age"], 20)).toBe(true);
    expect(adapter.getField(firstId, ["profile", "age"])).toBe(20);
    expect(
      adapter.setField(firstId, ["profile", "tags"], [{ name: "fast-path" }]),
    ).toBe(true);
    expect(adapter.getField(firstId, ["profile", "tags"])).toEqual([
      { name: "fast-path", score: 0 },
    ]);

    expect(adapter.remove(firstId)).toEqual({
      id: "user-1",
      profile: {
        age: 20,
        tags: [{ name: "fast-path", score: 0 }],
      },
    });
    expect(adapter.ids()).toEqual([secondId]);
    expect(adapter.length).toBe(1);
  });

  it("应该支持按照 schema 追加默认值", () => {
    const adapter = createAdapter(userSchema);
    const [entityId] = adapter.pushDefault();

    expect(adapter.getField(entityId, ["id"])).toBe("");
    expect(adapter.getField(entityId, ["profile", "age"])).toBe(0);
    expect(adapter.getField(entityId, ["profile", "tags"])).toEqual([]);
  });

  it("应该支持通过层级 entityId 与 $ 路径直接定位嵌套数组元素", () => {
    const nestedSchema = z.object({
      values: z.array(
        z.object({
          subValues: z.array(
            z.object({
              otherValues: z.array(z.number()),
            }),
          ),
        }),
      ),
    });
    const adapter = createAdapter(nestedSchema, [
      {
        values: [
          {
            subValues: [
              { otherValues: [1, 2] },
              { otherValues: [3] },
            ],
          },
        ],
      },
    ]);
    const [rootId] = adapter.ids();
    const values = expectPreparedArray(adapter.prepare(["values"]));
    const subValues = expectPreparedArray(adapter.prepare(["values", "$", "subValues"]));
    const otherValues = expectPreparedArray(
      adapter.prepare(["values", "$", "subValues", "$", "otherValues"]),
    );
    const leafValues = expectPreparedScalar(
      adapter.prepare(["values", "$", "subValues", "$", "otherValues", "$"]),
    );

    const [valueId] = values.ids(rootId);
    const subValueIds = subValues.ids(valueId);
    const firstLeafIds = otherValues.ids(subValueIds[0]);
    const secondLeafIds = otherValues.ids(subValueIds[1]);

    expect(adapter.getField(firstLeafIds[0], ["values", "$", "subValues", "$", "otherValues", "$"])).toBe(1);
    expect(adapter.getField(firstLeafIds[1], ["values", "$", "subValues", "$", "otherValues", "$"])).toBe(2);
    expect(adapter.getField(secondLeafIds[0], ["values", "$", "subValues", "$", "otherValues", "$"])).toBe(3);
    expect(leafValues.get(firstLeafIds[1])).toBe(2);
  });
});

function expectPreparedScalar(node: unknown): {
  values: readonly unknown[];
  get(id: EntityId): unknown;
} {
  expect(node).toMatchObject({ kind: "scalar" });
  return node as {
    values: readonly unknown[];
    get(id: EntityId): unknown;
  };
}

function expectPreparedArray(node: unknown): {
  rangeById(id: EntityId): { start: number; end: number; length: number };
  ids(id: EntityId): readonly EntityId[];
} {
  expect(node).toMatchObject({ kind: "array" });
  return node as {
    rangeById(id: EntityId): { start: number; end: number; length: number };
    ids(id: EntityId): readonly EntityId[];
  };
}
