import * as z from "zod/mini";
import executeDescription from "../prompts/execute-description.md" with { type: "text" };
import { toolParameters } from "../tool-schema";

export const ExecuteParameters = z.object({
  label: z.optional(z.string()),
  code: z.string(),
  timeoutSeconds: z.optional(z.number().check(z.minimum(0.1))),
  outputByteLimit: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(Number.MAX_SAFE_INTEGER))),
});

/** The registered tool and setup probes share this asset-free declaration. */
export function executeDeclaration() {
  return {
    name: "execute",
    description: executeDescription.trimEnd(),
    parameters: toolParameters(ExecuteParameters),
  };
}
