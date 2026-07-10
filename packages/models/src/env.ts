import { z } from "zod";
import { ModelProviderSchema } from "./interfaces";
import type { ModelDefaults } from "./interfaces";

/** The canonical (prefix-stripped) env variable names this package reads. */
const ENV_KEYS = [
  "MODEL_PROVIDER",
  "OPENROUTER_MODEL",
  "OPENROUTER_SESSION_ID",
  "OPENROUTER_API_KEY",
  "OLLAMA_MODEL",
  "OLLAMA_BASE_URL",
  "OPENAI_COMPATIBLE_MODEL",
  "OPENAI_COMPATIBLE_BASE_URL",
  "OPENAI_COMPATIBLE_API_KEY",
] as const;

/**
 * Reads the prefixed environment variables for a registration into canonical
 * (prefix-stripped) keys. The default model uses an empty prefix
 * (`MODEL_PROVIDER`); a named model "fast" uses `FAST_` (`FAST_MODEL_PROVIDER`).
 */
export function readRawEnv(
  prefix: string,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = env[`${prefix}${key}`];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Builds the zod schema validating a registration's (prefix-stripped) env. It
 * closes over the registration's `defaults` so `superRefine` can treat a
 * `defaults.model`/`defaults.baseUrl` as satisfying an otherwise-required
 * variable — enforcing precedence env > defaults > error at boot with a message
 * that names the real (prefixed) variable.
 */
export function buildEnvSchema(prefix: string, defaults?: ModelDefaults) {
  const p = (key: string): string => `${prefix}${key}`;
  const providerDefault = defaults?.provider ?? "mock";

  return z
    .object({
      MODEL_PROVIDER: ModelProviderSchema.default(providerDefault),
      OPENROUTER_MODEL: z.string().min(1).optional(),
      OPENROUTER_API_KEY: z.string().min(1).optional(),
      OPENROUTER_SESSION_ID: z.string().min(1).optional(),
      OLLAMA_MODEL: z.string().min(1).optional(),
      OLLAMA_BASE_URL: z.string().url().optional(),
      OPENAI_COMPATIBLE_MODEL: z.string().min(1).optional(),
      OPENAI_COMPATIBLE_BASE_URL: z.string().url().optional(),
      OPENAI_COMPATIBLE_API_KEY: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((env, ctx) => {
      const requireVar = (
        key: keyof typeof env,
        arm: string,
        defaulted: boolean,
        defaultsPath: string,
      ): void => {
        if (!env[key] && !defaulted) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message:
              `${p(key)} is required when ${p("MODEL_PROVIDER")}=${arm} ` +
              `(or set ${defaultsPath} for this registration)`,
          });
        }
      };

      switch (env.MODEL_PROVIDER) {
        case "openrouter":
          requireVar(
            "OPENROUTER_MODEL",
            "openrouter",
            !!defaults?.openrouter?.model,
            "defaults.openrouter.model",
          );
          break;
        case "ollama":
          requireVar(
            "OLLAMA_MODEL",
            "ollama",
            !!defaults?.ollama?.model,
            "defaults.ollama.model",
          );
          break;
        case "openai-compatible":
          requireVar(
            "OPENAI_COMPATIBLE_MODEL",
            "openai-compatible",
            !!defaults?.openaiCompatible?.model,
            "defaults.openaiCompatible.model",
          );
          requireVar(
            "OPENAI_COMPATIBLE_BASE_URL",
            "openai-compatible",
            !!defaults?.openaiCompatible?.baseUrl,
            "defaults.openaiCompatible.baseUrl",
          );
          break;
        // "mock" needs nothing.
      }
    });
}

export type ParsedModelEnv = z.infer<ReturnType<typeof buildEnvSchema>>;
