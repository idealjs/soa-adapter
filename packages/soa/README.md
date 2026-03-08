# @idealjs/soa

A high-performance Entity Store using Structure of Arrays (SoA) principles with Zod schema validation.

## Features

- **SoA Architecture**: Uses parallel arrays for cache locality and performance.
- **Schema Flattening**: Automatically flattens nested Zod schemas into column arrays (e.g., `position.x` -> `position_x`).
- **O(1) Operations**: ID lookup via Map, and efficient Swap-and-Pop removal.
- **Batch Operations**: `createMany`, `updateMany`, `upsertMany`, `deleteMany`.
- **Runtime Validation**: Strictly enforced via [zod](https://github.com/colinhacks/zod).

## Installation

```bash
yarn add @idealjs/soa zod
```

## Usage

### 1. Define Zod Schema

Define your entity schema using Zod. This schema is used for both runtime validation and structural flattening.

```typescript
import { z } from 'zod';

const schema = z.object({
  position: z.object({
    x: z.number(),
    y: z.number()
  }),
  health: z.number().min(0).max(100)
});
```

### 2. Create Store

```typescript
import { Store } from '@idealjs/soa';

// Type inference works automatically
const store = new Store(schema);
```

### 3. CRUD & Batch Operations

```typescript
// Create (throws if invalid)
store.create('p1', { 
  position: { x: 10, y: 20 }, 
  health: 100 
});

// Update (Partial validation supported)
// Only validates the fields being updated against the schema
store.update('p1', { health: 90 });

// Upsert (Create or Update)
store.upsert('p1', { health: 80 });

// Delete
store.delete('p1');

// Batch Operations
store.createMany([ 
    { id: 'p2', data: { ... } }, 
    { id: 'p3', data: { ... } } 
]);

store.updateMany([ 
    { id: 'p1', data: { health: 50 } } 
]);
```

### 4. Direct Access

Access the underlying flattened arrays directly for performance-critical loops.

```typescript
const index = store.getIndex('p1');
// Arrays are flattened using underscore separator
const x = store.arrays.position_x[index];
```
