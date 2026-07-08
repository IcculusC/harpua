import { isPrivateAddress } from "../web-research/private-address";

/** Read a URL's hostname the way fetch_url does, so tests mirror runtime input. */
const host = (url: string): string => new URL(url).hostname;

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local, and unspecified IPv4", () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://127.5.5.5/",
      "http://10.0.0.1/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://169.254.169.254/", // cloud metadata
      "http://0.0.0.0/",
    ]) {
      expect(isPrivateAddress(host(url))).toBe(true);
    }
  });

  it("flags loopback and local-scope IPv6 (incl. IPv4-mapped)", () => {
    for (const url of [
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[fd00::1]/",
      "http://[::ffff:127.0.0.1]/",
    ]) {
      expect(isPrivateAddress(host(url))).toBe(true);
    }
  });

  it("flags localhost and conventional local hostname suffixes", () => {
    for (const url of [
      "http://localhost/",
      "http://LOCALHOST:8080/",
      "http://redis.internal/",
      "http://db.local/",
    ]) {
      expect(isPrivateAddress(host(url))).toBe(true);
    }
  });

  it("catches IPv4 obfuscation because the URL parser canonicalizes it first", () => {
    // WHATWG URL normalizes hex/octal/dword IPv4 to dotted-quad.
    expect(host("http://0x7f.0.0.1/")).toBe("127.0.0.1");
    expect(host("http://2130706433/")).toBe("127.0.0.1");
    expect(isPrivateAddress(host("http://2130706433/"))).toBe(true);
  });

  it("allows ordinary public hosts and public IPs", () => {
    for (const url of [
      "http://example.com/",
      "https://ti.com/lm317",
      "http://8.8.8.8/",
      "http://172.32.0.1/", // just outside the 172.16/12 private block
      "http://[2606:4700:4700::1111]/", // public IPv6
    ]) {
      expect(isPrivateAddress(host(url))).toBe(false);
    }
  });
});
