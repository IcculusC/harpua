import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

/** The provider arms, in declaration order. `mock` is the zero-config default. */
export const MODEL_PROVIDERS = [
  "mock",
  "openrouter",
  "ollama",
  "openai-compatible",
] as const;

export const ModelProviderSchema = z.enum(MODEL_PROVIDERS);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

/**
 * Arm-scoped OpenRouter defaults. Model-ID and connection defaults are scoped
 * PER ARM on purpose: a `model` slug means something only to its own arm (a
 * `deepseek/…` id is meaningless to Ollama), and — critically — presetting a
 * model here never forces a client at boot. The arm is chosen by
 * `provider`/`MODEL_PROVIDER`; until it resolves to `openrouter`, these are
 * inert, so a role registered with an OpenRouter model default still boots on
 * the mock arm with zero env. `siteUrl`/`siteName`/`provider`/`models`/`sessionId` map onto
 * `ChatOpenRouter`'s attribution + routing fields; `provider` is a passthrough
 * object so this package needs no type dependency on the optional peer.
 */
export const OpenRouterDefaultsSchema = z
  .object({
    /** Preset model id, e.g. "deepseek/deepseek-v4-flash". Env overrides. */
    model: z.string().min(1).optional(),
    /** Preset API key. Env overrides; the lib also reads OPENROUTER_API_KEY. */
    apiKey: z.string().min(1).optional(),
    /** Attribution: your app URL (HTTP-Referer). */
    siteUrl: z.string().optional(),
    /** Groups related requests in OpenRouter's dashboard (session_id). */
    sessionId: z.string().optional(),
    /** Attribution: your app name (X-Title). */
    siteName: z.string().optional(),
    /** OpenRouter provider routing preferences (passed through verbatim). */
    provider: z.record(z.string(), z.unknown()).optional(),
    /** Fallback model list for OpenRouter routing. */
    models: z.array(z.string()).optional(),
  })
  .strict();
export type OpenRouterDefaults = z.infer<typeof OpenRouterDefaultsSchema>;

/** Arm-scoped Ollama defaults. Env overrides each. */
export const OllamaDefaultsSchema = z
  .object({
    model: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
  })
  .strict();
export type OllamaDefaults = z.infer<typeof OllamaDefaultsSchema>;

/** Arm-scoped openai-compatible defaults. Env overrides each. */
export const OpenAICompatibleDefaultsSchema = z
  .object({
    model: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional(),
  })
  .strict();
export type OpenAICompatibleDefaults = z.infer<
  typeof OpenAICompatibleDefaultsSchema
>;

/** A factory returning a ready-to-use `BaseChatModel` (used by the mock arm). */
export type MockModelFactory = () => BaseChatModel;

/**
 * Per-registration defaults. Env always wins over these (precedence:
 * env > defaults > error). Everything is optional; a bare `{}` means "read it
 * all from env". `provider`, `temperature`, and `mockModel` are cross-cutting;
 * model-ID and connection defaults live in the arm-scoped blocks so they stay
 * coherent per arm and never force a client at boot. `mockModel` replaces the
 * built-in mock when the resolved provider is `mock`. Note: `temperature` is
 * ignored by the `mock` arm (its echo is deterministic); it applies only to the
 * real arms.
 */
export const ModelDefaultsSchema = z
  .object({
    provider: ModelProviderSchema.optional(),
    temperature: z.number().optional(),
    mockModel: z
      .custom<MockModelFactory>((v) => typeof v === "function", {
        message: "mockModel must be a () => BaseChatModel factory function",
      })
      .optional(),
    openrouter: OpenRouterDefaultsSchema.optional(),
    ollama: OllamaDefaultsSchema.optional(),
    openaiCompatible: OpenAICompatibleDefaultsSchema.optional(),
  })
  .strict();
export type ModelDefaults = z.infer<typeof ModelDefaultsSchema>;

/** Options for {@link ChatModelModule.forRoot} (the DEFAULT model). */
export const ForRootOptionsSchema = z
  .object({
    defaults: ModelDefaultsSchema.optional(),
  })
  .strict();
export type ForRootOptions = z.infer<typeof ForRootOptionsSchema>;

/** A lowercase slug: starts with a letter, then letters/digits/hyphens. */
export const ModelNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "model name must be a lowercase slug matching /^[a-z][a-z0-9-]*$/ (e.g. \"fast\", \"smart\", \"my-model\")",
  );

/** Options for {@link ChatModelModule.register} (an additional named model). */
export const RegisterOptionsSchema = z
  .object({
    name: ModelNameSchema,
    defaults: ModelDefaultsSchema.optional(),
  })
  .strict();
export type RegisterOptions = z.infer<typeof RegisterOptionsSchema>;

/**
 * A fully-resolved registration handed to the model factory: the display name,
 * the SCREAMING_SNAKE env prefix (empty for the default model), and its
 * defaults.
 */
export interface Registration {
  name: string;
  envPrefix: string;
  defaults?: ModelDefaults;
}
