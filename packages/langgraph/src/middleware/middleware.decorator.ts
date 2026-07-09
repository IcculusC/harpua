import { Injectable, type Type } from "@nestjs/common";
import { MIDDLEWARE_METADATA } from "../constants";

export type NodeRef = Type<any>;
export type MiddlewareEntry = Type<any> | { use: Type<any>; on: NodeRef };

/**
 * Marks a class as a LangGraph middleware. The class is expected to expose
 * middleware hook methods (e.g., `beforeModel`, `afterModel`). Also makes the
 * class injectable so it can be registered and resolved via the DI container.
 */
export function LangGraphMiddleware(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(MIDDLEWARE_METADATA, true, target);
    // Apply @Injectable so the middleware can be registered as a provider.
    Injectable()(target as unknown as Type<unknown>);
  };
}

/**
 * Checks if a class is decorated with @LangGraphMiddleware.
 */
export function isMiddlewareClass(target: unknown): target is Type<any> {
  return (
    typeof target === "function" &&
    Reflect.getMetadata(MIDDLEWARE_METADATA, target) === true
  );
}

/**
 * Normalizes a middleware entry (bare class or { use, on } form) into a
 * canonical { use, on? } object.
 */
export function normalizeMiddleware(
  entry: MiddlewareEntry,
): { use: Type<any>; on?: NodeRef } {
  return typeof entry === "function" ? { use: entry } : { use: entry.use, on: entry.on };
}
