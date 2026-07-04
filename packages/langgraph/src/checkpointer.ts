import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { ModuleRef } from "@nestjs/core";
import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

import { requireOptionalModule, requirePeerOf } from "./optional-require";
import type { CheckpointerOptions } from "./interfaces";

/** npm names of the optional checkpoint saver packages. */
export const CHECKPOINT_PACKAGES = {
  postgres: "@langchain/langgraph-checkpoint-postgres",
  sqlite: "@langchain/langgraph-checkpoint-sqlite",
  mongodb: "@langchain/langgraph-checkpoint-mongodb",
  redis: "@langchain/langgraph-checkpoint-redis",
} as const;

/**
 * A constructed checkpointer plus an optional teardown for connections the
 * MODULE created (from a connectionString/url/path). Caller-provided
 * pool/client instances are never given a teardown — we do not own them.
 */
export interface BuiltCheckpointer {
  saver: BaseCheckpointSaver;
  teardown?: () => Promise<void>;
}

function isModuleNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";
}

/**
 * Lazily loads a checkpoint saver package, translating a missing install into
 * a clear, actionable bootstrap error naming the package and the exact command.
 */
function loadCheckpointPackage(pkg: string): any {
  try {
    return requireOptionalModule(pkg);
  } catch (err) {
    if (isModuleNotFound(err)) {
      throw new Error(
        `@harpua/langgraph: this checkpointer needs the optional peer '${pkg}', ` +
          `which is not installed. Install it in your app:\n\n  pnpm add ${pkg}\n`,
      );
    }
    throw err;
  }
}

function buildPostgres(
  cfg: Extract<CheckpointerOptions, { type: "postgres" }>,
): BuiltCheckpointer & { setup: Promise<void> } {
  const { PostgresSaver } = loadCheckpointPackage(CHECKPOINT_PACKAGES.postgres);
  const options = cfg.schema ? { schema: cfg.schema } : undefined;

  if ("pool" in cfg) {
    // Caller owns the pool: construct + setup schema, but never close it.
    const saver = new PostgresSaver(cfg.pool, undefined, options);
    return { saver, setup: saver.setup() };
  }

  // Module owns the pool created from the connection string.
  const saver = PostgresSaver.fromConnString(cfg.connectionString, options);
  return { saver, setup: saver.setup(), teardown: () => saver.end() };
}

function buildSqlite(
  cfg: Extract<CheckpointerOptions, { type: "sqlite" }>,
): BuiltCheckpointer {
  const { SqliteSaver } = loadCheckpointPackage(CHECKPOINT_PACKAGES.sqlite);
  // fromConnString opens the (module-owned) better-sqlite3 database. Schema
  // setup happens lazily inside the saver on first use.
  const saver = SqliteSaver.fromConnString(cfg.path);
  return {
    saver,
    teardown: async () => {
      saver.db.close();
    },
  };
}

function buildMongo(
  cfg: Extract<CheckpointerOptions, { type: "mongodb" }>,
): BuiltCheckpointer & { setup: Promise<unknown> } {
  const { MongoDBSaver } = loadCheckpointPackage(CHECKPOINT_PACKAGES.mongodb);
  const params: Record<string, unknown> = {
    dbName: cfg.dbName,
    checkpointCollectionName: cfg.checkpointCollectionName,
    checkpointWritesCollectionName: cfg.checkpointWritesCollectionName,
    ttl: cfg.ttl,
  };

  if ("client" in cfg) {
    // Caller owns the MongoClient: never closed by us.
    const saver = new MongoDBSaver({ ...params, client: cfg.client });
    return { saver, setup: saver.setup() };
  }

  // Module owns a client created from the url. MongoDBSaver has no fromUrl, so
  // we build a MongoClient with the `mongodb` driver shipped by the saver
  // package and close it on shutdown.
  const { MongoClient } = requirePeerOf(
    "mongodb",
    CHECKPOINT_PACKAGES.mongodb,
  ) as { MongoClient: new (url: string) => any };
  const client = new MongoClient(cfg.url);
  const saver = new MongoDBSaver({ ...params, client });
  const setup = client.connect().then(() => saver.setup());
  return { saver, setup, teardown: () => client.close() };
}

function buildRedis(
  cfg: Extract<CheckpointerOptions, { type: "redis" }>,
): BuiltCheckpointer | Promise<BuiltCheckpointer> {
  const { RedisSaver } = loadCheckpointPackage(CHECKPOINT_PACKAGES.redis);

  if ("client" in cfg) {
    // Caller owns the (already connected) node-redis client.
    const saver = new RedisSaver(cfg.client, cfg.ttl);
    return { saver };
  }

  // fromUrl creates + connects a module-owned client and builds its indexes.
  return RedisSaver.fromUrl(cfg.url, cfg.ttl).then(
    (saver: BaseCheckpointSaver & { end: () => Promise<void> }) => ({
      saver,
      teardown: () => saver.end(),
    }),
  );
}

/**
 * Resolves a {@link CheckpointerOptions} config into a saver instance,
 * performing any required async schema setup BEFORE returning (so it completes
 * before graphs compile) and reporting a teardown for module-owned connections.
 */
export async function buildCheckpointer(
  cfg: CheckpointerOptions,
  moduleRef: ModuleRef,
): Promise<BuiltCheckpointer> {
  if ("useExisting" in cfg) {
    return { saver: moduleRef.get(cfg.useExisting, { strict: false }) };
  }
  if ("useFactory" in cfg) {
    const deps = (cfg.inject ?? []).map((t) =>
      moduleRef.get(t, { strict: false }),
    );
    return { saver: await cfg.useFactory(...deps) };
  }

  switch (cfg.type) {
    case "memory":
      return { saver: new MemorySaver() };
    case "postgres": {
      const built = buildPostgres(cfg);
      await built.setup;
      return { saver: built.saver, teardown: built.teardown };
    }
    case "sqlite":
      return buildSqlite(cfg);
    case "mongodb": {
      const built = buildMongo(cfg);
      await built.setup;
      return { saver: built.saver, teardown: built.teardown };
    }
    case "redis":
      return buildRedis(cfg);
    default: {
      const exhaustive: never = cfg;
      throw new Error(
        `@harpua/langgraph: unknown checkpointer config ${JSON.stringify(
          exhaustive,
        )}`,
      );
    }
  }
}

/**
 * Holds the teardown for a module-owned checkpointer connection and closes it
 * on application shutdown. Connections passed in by the caller (pool/client)
 * are never registered here and thus never closed by the module.
 *
 * Note: Nest only invokes shutdown hooks on `app.close()`, which fires on
 * process signals only when `app.enableShutdownHooks()` has been called.
 */
@Injectable()
export class CheckpointerLifecycle implements OnApplicationShutdown {
  private teardownFn?: () => Promise<void>;

  register(fn: () => Promise<void>): void {
    this.teardownFn = fn;
  }

  async onApplicationShutdown(): Promise<void> {
    const fn = this.teardownFn;
    this.teardownFn = undefined;
    if (fn) await fn();
  }
}
