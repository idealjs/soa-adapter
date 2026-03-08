# SoA Adapter 设计文档

## 概述
本项目实现了一个用于管理实体数据的 **SoA (Structure of Arrays)** 存储适配器。其设计目标是高性能且由 Schema 驱动，严格使用 **Zod** 进行 Schema 定义和验证。

核心思想是将所有嵌套的数据结构扁平化为平面数组（列）。使用 flattenSchema 

## 设计原则
1.  **Schema 驱动**：存储结构完全源自 Zod Schema。
2.  **拒绝 `any`**：严格的类型安全；在实现细节中尽可能不使用 `any`。
3.  **整洁代码**：源代码中不保留注释。所有的设计细节和原理都维护在外部文档（即本文档）中。
4.  **格式化**：代码风格通过 `biome` 强制执行。


## 存储架构

### Store
主 `Store` 类管理：
*   `_arrays`：所有扁平化列 + 指针列的数组字典。
*   `_idMap` / `_indexMap`：实体 ID 与 SoA 索引之间的双向映射。

### 核心 Store API

#### `create(entity): EntityId`
写入单个实体，返回新实体 ID。

#### `createMany(entities): EntityId[]`
批量写入，返回 ID 列表。

#### `getById(id): Entity | undefined`
按 ID 获取实体快照。

#### `getManyByIds(ids): Entity[]`
按 ID 列表批量获取，保持输入顺序。

#### `updateById(id, patch): boolean`
按 ID 局部更新；不存在返回 `false`。

#### `replaceById(id, entity): boolean`
按 ID 全量替换；不存在返回 `false`。

#### `deleteById(id): boolean`
删除实体；不存在返回 `false`。

#### `has(id): boolean`
判断实体是否存在。

#### `size(): number`
返回当前实体数量。

#### `clear(): void`
清空存储（数组列、索引映射、ID 映射）。

---

### 查询与遍历 API

#### `find(predicate): Entity | undefined`
返回首个满足条件的实体。

#### `findIndex(predicate): number`
返回首个满足条件的 SoA 索引；无结果返回 `-1`。

#### `some(predicate): boolean`
是否存在至少一个满足条件的实体。

#### `every(predicate): boolean`
是否所有实体都满足条件。

#### `forEach(visitor): void`
按稳定顺序遍历所有实体。

## 函数式 API 设计

函数式 API 语义与 JavaScript 数组方法保持一致，但数据源来自 SoA 存储。

### `map(mapper): R[]`
将每个实体映射为新值，返回结果数组。

**语义约束**
- 不修改 Store。
- 输出长度恒等于 `size()`。
- 遍历顺序稳定（与内部索引一致）。

### `filter(predicate): Entity[]`
过滤实体并返回实体快照数组。

**语义约束**
- 不修改 Store。
- 返回值为新的数组对象。
- 仅包含满足条件的实体快照。

### `reduce(reducer, initialValue): R`
聚合所有实体并返回累计值。

**语义约束**
- 不修改 Store。
- 必须提供 `initialValue`（避免空集合歧义）。
- 遍历顺序稳定。
