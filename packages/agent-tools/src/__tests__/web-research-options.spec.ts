import {
  resolveWebSearchOptions,
  resolveFetchUrlOptions,
  resolveFetchPdfOptions,
  DEFAULT_MAX_RESULTS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_FETCH_PDF_MAX_RESPONSE_BYTES,
} from "../web-research/options";
import { errorMessage } from "../web-research/errors";

describe("web-research options", () => {
  it("applies web_search defaults with only baseUrl given", () => {
    const opts = resolveWebSearchOptions({ baseUrl: "http://localhost:8080" });
    expect(opts.baseUrl).toBe("http://localhost:8080");
    expect(opts.maxResults).toBe(DEFAULT_MAX_RESULTS);
    expect(opts.timeoutMs).toBe(DEFAULT_SEARCH_TIMEOUT_MS);
    expect(typeof opts.fetchFn).toBe("function");
  });

  it("rejects maxResults over the ceiling and unknown keys", () => {
    expect(() =>
      resolveWebSearchOptions({ baseUrl: "http://x", maxResults: 11 }),
    ).toThrow();
    expect(() =>
      resolveWebSearchOptions({ baseUrl: "http://x", nope: 1 } as never),
    ).toThrow();
  });

  it("applies fetch_url defaults and accepts saveDir as string or function", () => {
    const withString = resolveFetchUrlOptions({ saveDir: "/tmp/x" });
    expect(withString.timeoutMs).toBe(DEFAULT_FETCH_TIMEOUT_MS);
    expect(withString.maxResponseBytes).toBe(DEFAULT_MAX_RESPONSE_BYTES);
    expect(typeof withString.now).toBe("function");
    expect(withString.now()).toBeInstanceOf(Date);

    const resolver = () => "/tmp/y";
    const withFn = resolveFetchUrlOptions({ saveDir: resolver });
    expect(withFn.saveDir).toBe(resolver);
  });

  it("rejects a missing saveDir and non-function fetchFn", () => {
    expect(() => resolveFetchUrlOptions({} as never)).toThrow();
    expect(() =>
      resolveFetchUrlOptions({ saveDir: "/tmp/x", fetchFn: "nope" } as never),
    ).toThrow();
  });

  it("gives fetch_pdf its own larger default response-size cap than fetch_url", () => {
    const pdfOpts = resolveFetchPdfOptions({ saveDir: "/tmp/x" });
    expect(pdfOpts.maxResponseBytes).toBe(DEFAULT_FETCH_PDF_MAX_RESPONSE_BYTES);
    expect(DEFAULT_FETCH_PDF_MAX_RESPONSE_BYTES).toBeGreaterThan(
      DEFAULT_MAX_RESPONSE_BYTES,
    );

    // fetch_url's default is unaffected by fetch_pdf's larger cap.
    const urlOpts = resolveFetchUrlOptions({ saveDir: "/tmp/x" });
    expect(urlOpts.maxResponseBytes).toBe(DEFAULT_MAX_RESPONSE_BYTES);
  });
});

describe("errorMessage", () => {
  it("uses .message for Errors and String() otherwise", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});
