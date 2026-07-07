import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { MODEL_PACKAGES } from "./constants";
import { requireOptionalModule } from "./optional-require";
import { buildEnvSchema, readRawEnv } from "./env";
import { MockChatModel } from "./mock-chat-model";
import type { Registration } from "./interfaces";

/** A "module not found" require error, matched by its Node error code. */
const moduleNotFoundError = z.object({
  code: z.enum(["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"]),
});

/**
 * Lazily loads an optional integration package, translating a missing install
 * into a clear, actionable bootstrap error naming the package and the exact
 * command — mirroring `@harpua/langgraph`'s checkpointer loader.
 */
function loadModelPackage(pkg: string): any {
  try {
    return requireOptionalModule(pkg);
  } catch (err) {
    if (moduleNotFoundError.safeParse(err).success) {
      throw new Error(
        `@harpua/models: this provider needs the optional peer '${pkg}', ` +
          `which is not installed. Install it in your app:\n\n  pnpm add ${pkg}\n`,
      );
    }
    throw err;
  }
}

/**
 * Resolves a {@link Registration} into a concrete `BaseChatModel`, reading the
 * registration's (prefixed) environment, applying precedence env > defaults >
 * error, and lazily loading only the optional peer the chosen arm needs.
 *
 * Pure and offline for the `mock` arm; the real arms construct their client
 * without performing any network call.
 */
export function buildChatModel(
  reg: Registration,
  env: NodeJS.ProcessEnv = process.env,
): BaseChatModel {
  const parsed = buildEnvSchema(reg.envPrefix, reg.defaults).parse(
    readRawEnv(reg.envPrefix, env),
  );
  const d = reg.defaults ?? {};

  const temp = d.temperature;

  switch (parsed.MODEL_PROVIDER) {
    case "mock":
      return d.mockModel ? d.mockModel() : new MockChatModel(reg.name);

    case "openrouter": {
      const { ChatOpenRouter } = loadModelPackage(MODEL_PACKAGES.openrouter);
      const or = d.openrouter ?? {};
      // model guaranteed present by superRefine (env or arm-scoped default).
      const model = parsed.OPENROUTER_MODEL ?? or.model;
      const apiKey = parsed.OPENROUTER_API_KEY ?? or.apiKey;
      return new ChatOpenRouter({
        model,
        // The lib reads OPENROUTER_API_KEY itself; ours only overrides when set.
        ...(apiKey ? { apiKey } : {}),
        ...(temp !== undefined ? { temperature: temp } : {}),
        ...(or.siteUrl !== undefined ? { siteUrl: or.siteUrl } : {}),
        ...(or.siteName !== undefined ? { siteName: or.siteName } : {}),
        ...(or.provider !== undefined ? { provider: or.provider } : {}),
        ...(or.models !== undefined ? { models: or.models } : {}),
      });
    }

    case "ollama": {
      const { ChatOllama } = loadModelPackage(MODEL_PACKAGES.ollama);
      const ol = d.ollama ?? {};
      const model = parsed.OLLAMA_MODEL ?? ol.model;
      const baseUrl =
        parsed.OLLAMA_BASE_URL ?? ol.baseUrl ?? "http://localhost:11434";
      return new ChatOllama({
        model,
        baseUrl,
        ...(temp !== undefined ? { temperature: temp } : {}),
      });
    }

    case "openai-compatible": {
      const { ChatOpenAI } = loadModelPackage(MODEL_PACKAGES.openai);
      const oc = d.openaiCompatible ?? {};
      const model = parsed.OPENAI_COMPATIBLE_MODEL ?? oc.model;
      const baseURL = parsed.OPENAI_COMPATIBLE_BASE_URL ?? oc.baseUrl;
      return new ChatOpenAI({
        model,
        // Local/self-hosted servers often ignore the key; send a placeholder so
        // the client doesn't refuse to start when none is configured.
        apiKey: parsed.OPENAI_COMPATIBLE_API_KEY ?? oc.apiKey ?? "not-needed",
        ...(temp !== undefined ? { temperature: temp } : {}),
        configuration: { baseURL },
      });
    }

    default: {
      const exhaustive: never = parsed.MODEL_PROVIDER;
      throw new Error(
        `@harpua/models: unhandled MODEL_PROVIDER ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}
