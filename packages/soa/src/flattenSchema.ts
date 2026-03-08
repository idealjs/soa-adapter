import { z } from "zod";

export interface FieldRequirement {
  type: string;
  maxLength?: number | null;
}

export interface FieldSchema {
  path: string[];
  requirements: FieldRequirement;
}

export const flattenSchema = (
  rootSchema: z.core.$ZodType,
  initialPath: string[] = [],
): FieldSchema[] => {
  const results: FieldSchema[] = [];
  const stack: { schema: z.core.$ZodType; path: string[] }[] = [
    { schema: rootSchema, path: initialPath },
  ];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) {
      continue;
    }
    const { schema, path } = item;

    if (schema instanceof z.ZodObject) {
      const shape = schema.shape;
      const keys = Object.keys(shape).reverse();
      for (const key of keys) {
        stack.push({ schema: shape[key], path: [...path, key] });
      }
      continue;
    }

    if (schema instanceof z.ZodArray) {
      stack.push({ schema: schema.element, path: [...path, "$"] });
      continue;
    }

    let type = "unknown";
    let maxLength: number | undefined | null;

    if (schema instanceof z.ZodString) {
      type = "string";
      maxLength = schema.maxLength;
    } else if (schema instanceof z.ZodNumber) {
      type = "number";
    } else if (schema instanceof z.ZodBoolean) {
      type = "boolean";
    }

    results.push({
      path,
      requirements: { type, maxLength },
    });
  }

  return results;
};
