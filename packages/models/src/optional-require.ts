/**
 * Lazily loads an optional peer dependency by name at runtime. The LangChain
 * integration packages (`@langchain/openrouter`, `@langchain/ollama`,
 * `@langchain/openai`) are declared as OPTIONAL peer dependencies of
 * `@harpua/models`, so they are only present when the consumer actually
 * installs the arm they picked. Kept in its own tiny module so tests can spy on
 * it to simulate a package not being installed.
 *
 * This seam is intentionally copied (not imported from `@harpua/langgraph`):
 * `@harpua/models` is graph-agnostic and carries no dependency on that package.
 */
export function requireOptionalModule(pkg: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(pkg);
}
