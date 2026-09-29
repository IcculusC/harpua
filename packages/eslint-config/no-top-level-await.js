const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/**
 * Bans top-level `await` (and top-level `for await`). A published ESM module
 * that awaits at module scope makes `require(esm)` fail with
 * ERR_REQUIRE_ASYNC_MODULE, locking out CommonJS consumers.
 * @type {import("eslint").Rule.RuleModule}
 */
const rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      topLevelAwait:
        "Top-level await breaks require(esm) for CommonJS consumers (ERR_REQUIRE_ASYNC_MODULE). Await inside a function instead.",
    },
  },
  create(context) {
    const check = (node) => {
      const inFunction = context.sourceCode
        .getAncestors(node)
        .some((a) => FUNCTION_TYPES.has(a.type));
      if (!inFunction) context.report({ node, messageId: "topLevelAwait" });
    };
    return {
      AwaitExpression: check,
      "ForOfStatement[await=true]": check,
    };
  },
};

export const noTopLevelAwait = { rules: { "no-top-level-await": rule } };

export default noTopLevelAwait;
