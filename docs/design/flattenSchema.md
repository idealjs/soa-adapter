# 设计原则

1.  **Schema 驱动**：存储结构完全源自 Zod Schema。
2.  **拒绝 `any`**：严格的类型安全；在实现细节中尽可能不使用 `any`。
3.  **整洁代码**：源代码中不保留注释。所有的设计细节和原理都维护在外部文档（即本文档）中。
4.  **格式化**：代码风格通过 `biome` 强制执行。

# Schema 扁平化策略

`flattenSchema` 函数解析 Zod 对象 Schema，返回一个统一的字段定义列表。

## 统一字段模型 (Unified Field Model)

`flattenSchema` 返回一个 **Fields** 列表。每个字段定义包含 **Path**（路径）和 **Requirements**（数据要求）。

每个 `FieldSchema` 包含：

- path: string[]：字段路径。**数组中的 `$` 符号表示数组元素**（例如 `["users", "$", "id"]`）。
- requirements: 定义该字段的类型和约束。

### 示例

对于 Schema

```ts
{ users: { id: number, name: string }[] }
```

扁平化结果包含：

```ts
[
  {
    path: ["users", "$", "id"],
    requirements: { type: "number" },
  },
  {
    path: ["users", "$", "name"],
    requirements: { type: "string" },
  },
];
```
