import { z } from "zod";

export interface FieldRequirement {
  type: string;
}

export interface FieldSchema {
  path: string[];
  requirements: FieldRequirement;
}

export const flattenSchema = (
  schema: z.core.$ZodType,
  currentPath: string[] = [],
): FieldSchema[] => {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    let fields: FieldSchema[] = [];
    for (const key in shape) {
      fields = [...fields, ...flattenSchema(shape[key], [...currentPath, key])];
    }
    return fields;
  }

  if (schema instanceof z.ZodArray) {
    return flattenSchema(schema.element, [...currentPath, "$"]);
  }

  let type = "unknown";
  if (schema instanceof z.ZodString) {
    type = "string";
  } else if (schema instanceof z.ZodNumber) {
    type = "number";
  } else if (schema instanceof z.ZodBoolean) {
    type = "boolean";
  }

  return [
    {
      path: currentPath,
      requirements: { type },
    },
  ];
};
