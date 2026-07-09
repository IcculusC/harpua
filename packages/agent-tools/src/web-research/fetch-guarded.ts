import { errorMessage } from "./errors";
import { isPrivateAddress } from "./private-address";
import type { FetchFn, FetchResponseLike } from "./options";

/** The guard/read caps and injected fetch shared by `fetch_url` and `fetch_pdf`. */
export interface FetchGuardOptions {
  allowPrivate: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchFn: FetchFn;
}

/**
 * Outcome of {@link fetchGuarded}. On success the body is still unread — the
 * caller pulls text or bytes via {@link readTextCapped} / {@link readBytesCapped}
 * so `fetch_url` and `fetch_pdf` share every URL/SSRF/declared-size check
 * without either duplicating it.
 */
export type FetchGuardedResult =
  | { ok: false; error: string }
  | { ok: true; finalUrl: URL; contentType: string; response: FetchResponseLike };

/**
 * The shared fetch-and-guard core. In order: parse the URL; require http(s);
 * refuse private/loopback hosts (unless `allowPrivate`); fetch under a timeout;
 * require a 2xx; re-check the post-redirect host so a public URL can't 302 past
 * the guard; and refuse an oversize declared `content-length`. Never throws —
 * every failure comes back as `{ ok: false, error }` prefixed with `toolName`.
 */
export async function fetchGuarded(
  toolName: string,
  input: string,
  opts: FetchGuardOptions,
): Promise<FetchGuardedResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: `${toolName}: "${input}" is not a valid URL.` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      error: `${toolName}: only http(s) URLs are supported (got "${url.protocol}").`,
    };
  }
  if (!opts.allowPrivate && isPrivateAddress(url.hostname)) {
    return {
      ok: false,
      error:
        `${toolName}: refusing to fetch the private/loopback address ` +
        `"${url.hostname}" — set allowPrivate: true if this is intentional.`,
    };
  }

  let response: FetchResponseLike;
  try {
    response = await opts.fetchFn(url.toString(), {
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    return { ok: false, error: `${toolName}: request failed (${errorMessage(err)}).` };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: `${toolName}: ${url.toString()} returned HTTP ${response.status}.`,
    };
  }

  // Redirects are followed by the underlying fetch; re-check where we actually
  // landed so a public URL can't 302 past the private-address guard, and so
  // provenance records the real source.
  let finalUrl = url;
  if (response.url) {
    try {
      finalUrl = new URL(response.url);
    } catch {
      finalUrl = url;
    }
  }
  if (
    !opts.allowPrivate &&
    finalUrl.hostname !== url.hostname &&
    isPrivateAddress(finalUrl.hostname)
  ) {
    return {
      ok: false,
      error:
        `${toolName}: ${url.toString()} redirected to the private/loopback ` +
        `address "${finalUrl.hostname}" — refused (set allowPrivate: true ` +
        `if this is intentional).`,
    };
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

  // Prefer the declared size so an oversize body is refused before it is read.
  // When the server omits content-length (e.g. chunked responses) the
  // per-payload check below is the fallback — note it buffers the whole body
  // first, so it bounds what we SAVE, not peak memory.
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > opts.maxResponseBytes) {
    return {
      ok: false,
      error:
        `${toolName}: response is ${declared} bytes, over the ` +
        `${opts.maxResponseBytes}-byte limit.`,
    };
  }

  return { ok: true, finalUrl, contentType, response };
}

/** Read the body as text and enforce the actual byte cap. `fetch_url` uses this. */
export async function readTextCapped(
  toolName: string,
  response: FetchResponseLike,
  maxResponseBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let body: string;
  try {
    body = await response.text();
  } catch (err) {
    return {
      ok: false,
      error: `${toolName}: could not read the response body (${errorMessage(err)}).`,
    };
  }
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > maxResponseBytes) {
    return {
      ok: false,
      error:
        `${toolName}: response is ${bytes} bytes, over the ` +
        `${maxResponseBytes}-byte limit.`,
    };
  }
  return { ok: true, text: body };
}

/** Read the body as raw bytes and enforce the actual byte cap. `fetch_pdf` uses this. */
export async function readBytesCapped(
  toolName: string,
  response: FetchResponseLike,
  maxResponseBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  if (typeof response.arrayBuffer !== "function") {
    return {
      ok: false,
      error: `${toolName}: this response cannot provide raw bytes to read.`,
    };
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (err) {
    return {
      ok: false,
      error: `${toolName}: could not read the response body (${errorMessage(err)}).`,
    };
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > maxResponseBytes) {
    return {
      ok: false,
      error:
        `${toolName}: response is ${bytes.byteLength} bytes, over the ` +
        `${maxResponseBytes}-byte limit.`,
    };
  }
  return { ok: true, bytes };
}
