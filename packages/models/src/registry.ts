import { ModelNameSchema } from "./interfaces";

/**
 * Process-wide bookkeeping for {@link ChatModelModule}. It records that the
 * default model has been registered (so a second `forRoot()` in the same process
 * is caught) and enforces that registration names are unique.
 *
 * The "register before forRoot" ordering invariant is NOT enforced here anymore:
 * each `register()`ed provider injects the `CHAT_MODEL_MODULE_OPTIONS` token that
 * only `forRoot()` provides, so registering without a root fails Nest's DI
 * resolution with a precise, token-naming error at bootstrap.
 *
 * The static module methods run while Nest evaluates the `imports` array during
 * bootstrap, so throwing here (duplicate name / double forRoot) fails app
 * construction with a precise message. State persists for the life of the
 * process; {@link resetChatModelRegistry} clears it for test isolation.
 */
const state = {
  rootRegistered: false,
  names: new Set<string>(),
};

/**
 * Marks the default model registered and seeds the name set with `"default"`.
 * Throws if `forRoot()` has already run in this process — an app configures the
 * default model exactly once.
 */
export function registerRoot(): void {
  if (state.rootRegistered) {
    throw new Error(
      `@harpua/models: ChatModelModule.forRoot() was called more than once. ` +
        `An app configures the default chat model exactly once. If you are ` +
        `booting multiple apps in one process (e.g. across tests), call ` +
        `resetChatModelRegistry() between boots to reset the registry.`,
    );
  }
  state.rootRegistered = true;
  state.names = new Set<string>(["default"]);
}

/**
 * Validates and records a named registration. Throws if the name is a duplicate
 * or is not a valid lowercase slug. Returns the validated name. Whether
 * `forRoot()` has run is enforced downstream by Nest DI, not here.
 */
export function registerName(rawName: string): string {
  const name = ModelNameSchema.parse(rawName);

  if (state.names.has(name)) {
    throw new Error(
      `@harpua/models: duplicate chat model registration "${name}". ` +
        `Each ChatModelModule.register({ name }) must use a unique name` +
        `${name === "default" ? ' ("default" is reserved for forRoot).' : "."}`,
    );
  }

  state.names.add(name);
  return name;
}

/**
 * The SCREAMING_SNAKE env prefix for a named model: `"fast"` → `"FAST_"`,
 * `"my-model"` → `"MY_MODEL_"`. The default model uses an empty prefix.
 */
export function envPrefixOf(name: string): string {
  return `${name.toUpperCase().replace(/-/g, "_")}_`;
}

/**
 * Resets all process-wide chat-model bookkeeping so a fresh `forRoot()` can run.
 * Exists for test isolation: a process that boots more than one app (e.g. an
 * e2e suite spinning up several NestJS modules) must call this between boots,
 * because a second `forRoot()` otherwise throws.
 */
export function resetChatModelRegistry(): void {
  state.rootRegistered = false;
  state.names = new Set<string>();
}
