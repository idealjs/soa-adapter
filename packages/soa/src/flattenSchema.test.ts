import { describe, expect, it } from "vitest";
import { z } from "zod";
import { flattenSchema } from "./flattenSchema";

describe("flattenSchema", () => {
  it("should flatten a simple object", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = flattenSchema(schema);

    expect(result).toEqual([
      { path: ["name"], requirements: { type: "string", maxLength: null } },
      { path: ["age"], requirements: { type: "number" } },
    ]);
  });

  it("should flatten nested objects", () => {
    const schema = z.object({
      user: z.object({
        details: z.object({
          isActive: z.boolean(),
        }),
      }),
    });

    const result = flattenSchema(schema);

    expect(result).toEqual([
      {
        path: ["user", "details", "isActive"],
        requirements: { type: "boolean" },
      },
    ]);
  });

  it("should flatten array of objects with $ symbol", () => {
    const schema = z.object({
      users: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
        }),
      ),
    });

    const result = flattenSchema(schema);

    expect(result).toEqual([
      {
        path: ["users", "$", "id"],
        requirements: { type: "number" },
      },
      {
        path: ["users", "$", "name"],
        requirements: { type: "string", maxLength: null },
      },
    ]);
  });

  it("should flatten array of primitives", () => {
    const schema = z.object({
      tags: z.array(z.string()),
    });

    const result = flattenSchema(schema);

    expect(result).toEqual([
      {
        path: ["tags", "$"],
        requirements: { type: "string", maxLength: null },
      },
    ]);
  });

  it("should flatten complex nested arrays", () => {
    const schema = z.object({
      departments: z.array(
        z.object({
          name: z.string(),
          employees: z.array(
            z.object({
              id: z.number(),
              skills: z.array(z.string()),
            }),
          ),
        }),
      ),
    });

    const result = flattenSchema(schema);

    expect(result).toEqual([
      {
        path: ["departments", "$", "name"],
        requirements: { type: "string", maxLength: null },
      },
      {
        path: ["departments", "$", "employees", "$", "id"],
        requirements: { type: "number" },
      },
      {
        path: ["departments", "$", "employees", "$", "skills", "$"],
        requirements: { type: "string", maxLength: null },
      },
    ]);
  });

  it("should include maxLength requirement for string schema", () => {
    const schema = z.object({
      title: z.string().max(10),
      description: z.string().max(100),
      code: z.string().length(8),
    });

    const result = flattenSchema(schema);

    expect(result).toEqual([
      {
        path: ["title"],
        requirements: { type: "string", maxLength: 10 },
      },
      {
        path: ["description"],
        requirements: { type: "string", maxLength: 100 },
      },
      {
        path: ["code"],
        requirements: { type: "string", maxLength: 8 },
      },
    ]);
  });

  it("should flatten array as root", () => {
    const schema = z.array(
      z.object({
        id: z.number(),
        name: z.string(),
      }),
    );

    const result = flattenSchema(schema);

    expect(result).toEqual([
      {
        path: ["$", "id"],
        requirements: { type: "number" },
      },
      {
        path: ["$", "name"],
        requirements: { type: "string", maxLength: null },
      },
    ]);
  });
});
