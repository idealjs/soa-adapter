# @idealjs/soa

一个面向实体坐标访问的 schema-driven SoA 适配器。

## 设计目标

- 使用 zod schema 作为数据布局和默认值初始化的唯一指导。
- 以列存 SoA 结构作为真实存储。
- 为顶层实体和每一层数组元素分配稳定的 entityId 片段。
- 通过 `entityId + schema key` 直接定位到列存中的目标位置。

## 基本用法

```ts
import { z } from "zod";
import { createAdapter } from "@idealjs/soa";

const userAdapter = createAdapter(
	z.object({
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
	}),
);

const [userId] = userAdapter.append({
	id: "user-1",
	profile: {
		tags: [{ name: "vip" }],
	},
});

console.log(userAdapter.getField(userId, ["id"]));
// "user-1"

const tags = userAdapter.prepare(["profile", "tags"]);

if (tags?.kind === "array") {
	const [tagId] = tags.ids(userId);
	console.log(
		userAdapter.getField(tagId, ["profile", "tags", "$", "name"]),
	);
	// "vip"
}

console.log(userAdapter.get(userId));
// {
//   id: "user-1",
//   profile: {
//     age: 0,
//     tags: [{ name: "vip", score: 0 }],
//   },
// }

console.log(userAdapter.layout);
// {
//   kind: "object",
//   fields: {
//     id: { kind: "scalar", values: ["user-1"] },
//     profile: {
//       kind: "object",
//       fields: {
//         age: { kind: "scalar", values: [0] },
//         tags: {
//           kind: "array",
//           lengths: [1],
//           items: {
//             kind: "object",
//             fields: {
//               name: { kind: "scalar", values: ["vip"] },
//               score: { kind: "scalar", values: [0] },
//             },
//           },
//         },
//       },
//     },
//   },
// }
```

## 提供的能力

- 稳定顶层实体 id：`ids()`、`append()`、`insertAt()`、`pushDefault()` 返回 `EntityId[]`。
- 稳定嵌套数组实体 id：`prepare(arrayPath).ids(parentEntityId)` 返回下一层 `EntityId[]`。
- 字段级访问：`getField(entityId, path)`、`setField(entityId, path, value)`。
- 数组范围访问：`getFieldRange(entityId, path)`、`prepare(arrayPath).rangeById(entityId)`。
- schema 初始化：缺失字段会按 schema 结构补齐，嵌套数组会按元素 schema 递归初始化。
- 列式布局：`adapter.layout` 既是对外可见的布局描述，也是内部真实存储。
- 高性能查询准备：`prepare(path)`、`prepareQuery(paths)` 会绑定列存节点；路径中的 `$` 表示消费一层 `entityId` 片段。
- 无行物化遍历：`scan(query, scanner)` 可基于 prepared query 扫描顶层实体。

## 说明

- `createAdapter(z.array(itemSchema))` 和 `createAdapter(itemSchema)` 都会返回面向元素的 SoA 适配器。
- 顶层 `EntityId` 形如 `[101]`；嵌套数组元素 `EntityId` 形如 `[101, 7, 3]`。
- 路径中的普通字符串表示对象字段，`$` 表示进入当前数组层的某个稳定元素。例如：`["values", "$", "subValues", "$", "otherValues", "$"]`。
- 对高频读写路径，优先先 `prepare(path)`，再通过 `PreparedScalarNode.get(entityId)`、`PreparedScalarNode.set(entityId, value)`、`PreparedArrayNode.ids(entityId)` 访问。
