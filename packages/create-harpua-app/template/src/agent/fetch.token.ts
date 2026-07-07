import type { Provider } from "@nestjs/common";

/**
 * DI token for the HTTP fetch implementation the weather tool uses. Injecting
 * it (rather than calling `globalThis.fetch` directly) lets tests supply a fake
 * that returns canned Open-Meteo JSON, so the tool loop runs fully offline.
 */
export const WEATHER_FETCH = Symbol("WEATHER_FETCH");

/** The minimal response surface the weather tool needs from a fetch. */
export interface FetchResponse {
  json(): Promise<unknown>;
}

/** A fetch narrowed to what the weather tool calls. `globalThis.fetch` fits. */
export type FetchFn = (url: string) => Promise<FetchResponse>;

/** Default provider: the platform `fetch` (Node 18+ / 20+ ships it globally). */
export const fetchProvider: Provider = {
  provide: WEATHER_FETCH,
  useValue: ((url: string) => globalThis.fetch(url)) as FetchFn,
};
