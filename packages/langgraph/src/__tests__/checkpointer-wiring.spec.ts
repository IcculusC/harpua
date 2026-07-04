import type { ModuleRef } from "@nestjs/core";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { RedisSaver } from "@langchain/langgraph-checkpoint-redis";

import {
  buildCheckpointer,
  CheckpointerLifecycle,
} from "../checkpointer";
import * as optionalRequire from "../optional-require";
import type { CheckpointerOptions } from "../interfaces";

// moduleRef is only touched by the useExisting/useFactory branches.
const noModuleRef = {} as ModuleRef;

describe("buildCheckpointer: config -> saver wiring", () => {
  afterEach(() => jest.restoreAllMocks());

  describe("postgres", () => {
    it("uses fromConnString and owns/closes the created pool", async () => {
      const setup = jest
        .spyOn(PostgresSaver.prototype, "setup")
        .mockResolvedValue(undefined);
      const end = jest
        .spyOn(PostgresSaver.prototype, "end")
        .mockResolvedValue(undefined);

      const built = await buildCheckpointer(
        {
          type: "postgres",
          connectionString: "postgresql://u:p@localhost:5432/db",
          schema: "custom",
        },
        noModuleRef,
      );

      expect(built.saver).toBeInstanceOf(PostgresSaver);
      expect(setup).toHaveBeenCalledTimes(1);
      // Module created the connection -> it registers a teardown that closes it.
      expect(built.teardown).toBeDefined();
      await built.teardown!();
      expect(end).toHaveBeenCalledTimes(1);
    });

    it("accepts a caller-provided pool and never closes it", async () => {
      const setup = jest
        .spyOn(PostgresSaver.prototype, "setup")
        .mockResolvedValue(undefined);
      const pool = { end: jest.fn() };

      const built = await buildCheckpointer(
        { type: "postgres", pool },
        noModuleRef,
      );

      expect(built.saver).toBeInstanceOf(PostgresSaver);
      expect(setup).toHaveBeenCalledTimes(1);
      // Caller owns the pool -> no teardown, pool left open.
      expect(built.teardown).toBeUndefined();
      expect(pool.end).not.toHaveBeenCalled();
    });
  });

  describe("sqlite", () => {
    it("opens a module-owned db that is closed on teardown", async () => {
      const built = await buildCheckpointer(
        { type: "sqlite", path: ":memory:" },
        noModuleRef,
      );
      expect(built.saver).toBeInstanceOf(SqliteSaver);
      expect(built.teardown).toBeDefined();

      const close = jest.spyOn((built.saver as SqliteSaver).db, "close");
      await built.teardown!();
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe("mongodb", () => {
    it("wraps a caller-provided client, runs setup, and leaves it open", async () => {
      const setup = jest
        .spyOn(MongoDBSaver.prototype, "setup")
        .mockResolvedValue([]);
      // A real (unconnected) MongoClient — the saver constructor derives its db
      // handle from it. No connection is opened.
      const { MongoClient } = optionalRequire.requirePeerOf(
        "mongodb",
        "@langchain/langgraph-checkpoint-mongodb",
      ) as { MongoClient: new (url: string) => { close: () => Promise<void> } };
      const client = new MongoClient("mongodb://localhost:27017");
      const close = jest
        .spyOn(client, "close")
        .mockResolvedValue(undefined as never);

      const built = await buildCheckpointer(
        { type: "mongodb", client, dbName: "app" },
        noModuleRef,
      );

      expect(built.saver).toBeInstanceOf(MongoDBSaver);
      expect(setup).toHaveBeenCalledTimes(1);
      expect(built.teardown).toBeUndefined();
      expect(close).not.toHaveBeenCalled();
    });

    it("creates + closes its own client when given a url", async () => {
      // `mongodb` ships as a dependency of the checkpoint package, not of this
      // library, so reach it the same way the builder does.
      const { MongoClient } = optionalRequire.requirePeerOf(
        "mongodb",
        "@langchain/langgraph-checkpoint-mongodb",
      ) as { MongoClient: { prototype: Record<string, unknown> } };

      const setup = jest
        .spyOn(MongoDBSaver.prototype, "setup")
        .mockResolvedValue([]);
      const connect = jest
        .spyOn(MongoClient.prototype as { connect: () => unknown }, "connect")
        .mockResolvedValue(undefined as never);
      const close = jest
        .spyOn(MongoClient.prototype as { close: () => unknown }, "close")
        .mockResolvedValue(undefined as never);

      const built = await buildCheckpointer(
        { type: "mongodb", url: "mongodb://localhost:27017", dbName: "app" },
        noModuleRef,
      );

      expect(built.saver).toBeInstanceOf(MongoDBSaver);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(setup).toHaveBeenCalledTimes(1);
      expect(built.teardown).toBeDefined();
      await built.teardown!();
      expect(close).toHaveBeenCalledTimes(1);
    });
  });

  describe("redis", () => {
    it("wraps a caller-provided client and leaves it open", async () => {
      const client = { quit: jest.fn() };
      const built = await buildCheckpointer(
        { type: "redis", client },
        noModuleRef,
      );
      expect(built.saver).toBeInstanceOf(RedisSaver);
      expect(built.teardown).toBeUndefined();
    });

    it("uses fromUrl for the url form and owns/closes the client", async () => {
      const fakeSaver = { end: jest.fn().mockResolvedValue(undefined) };
      const fromUrl = jest
        .spyOn(RedisSaver, "fromUrl")
        .mockResolvedValue(fakeSaver as unknown as RedisSaver);

      const built = await buildCheckpointer(
        { type: "redis", url: "redis://localhost:6379" },
        noModuleRef,
      );

      expect(fromUrl).toHaveBeenCalledWith("redis://localhost:6379", undefined);
      expect(built.saver).toBe(fakeSaver);
      expect(built.teardown).toBeDefined();
      await built.teardown!();
      expect(fakeSaver.end).toHaveBeenCalledTimes(1);
    });
  });

  describe("missing optional package", () => {
    it("throws an actionable install error when the driver is not installed", async () => {
      jest
        .spyOn(optionalRequire, "requireOptionalModule")
        .mockImplementation(() => {
          const err = new Error(
            "Cannot find module '@langchain/langgraph-checkpoint-postgres'",
          ) as NodeJS.ErrnoException;
          err.code = "MODULE_NOT_FOUND";
          throw err;
        });

      await expect(
        buildCheckpointer(
          { type: "postgres", connectionString: "postgresql://x" },
          noModuleRef,
        ),
      ).rejects.toThrow(
        /optional peer '@langchain\/langgraph-checkpoint-postgres'.*not installed[\s\S]*pnpm add @langchain\/langgraph-checkpoint-postgres/,
      );
    });

    it("rethrows unrelated require errors unchanged", async () => {
      jest
        .spyOn(optionalRequire, "requireOptionalModule")
        .mockImplementation(() => {
          throw new Error("boom from inside the package");
        });

      await expect(
        buildCheckpointer({ type: "sqlite", path: ":memory:" }, noModuleRef),
      ).rejects.toThrow(/boom from inside the package/);
    });
  });

  describe("escape hatches still work", () => {
    it("useFactory builds a saver from injected deps", async () => {
      const sentinel = SqliteSaver.fromConnString(":memory:");
      const cfg: CheckpointerOptions = {
        useFactory: () => sentinel,
      };
      const built = await buildCheckpointer(cfg, noModuleRef);
      expect(built.saver).toBe(sentinel);
      expect(built.teardown).toBeUndefined();
    });
  });
});

describe("CheckpointerLifecycle", () => {
  it("closes a module-owned connection exactly once on shutdown", async () => {
    const lifecycle = new CheckpointerLifecycle();
    const teardown = jest.fn().mockResolvedValue(undefined);
    lifecycle.register(teardown);

    await lifecycle.onApplicationShutdown();
    await lifecycle.onApplicationShutdown();

    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when nothing was registered (caller-owned connection)", async () => {
    const lifecycle = new CheckpointerLifecycle();
    await expect(lifecycle.onApplicationShutdown()).resolves.toBeUndefined();
  });
});
