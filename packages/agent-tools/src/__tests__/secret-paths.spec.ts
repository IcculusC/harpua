import { DEFAULT_SECRET_PATTERNS, isSecretPath } from "../file-exploration/secret-paths";

/** Shorthand: does the default policy consider this root-relative path a secret? */
const secret = (rel: string): boolean => isSecretPath(rel, DEFAULT_SECRET_PATTERNS);

describe("isSecretPath (default policy)", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    "sub/.env",
    "deep/nested/dir/.env.local",
    ".ssh", // the dir itself — its filename listing is a secret too
    ".ssh/id_rsa",
    ".ssh/config",
    "home/.ssh/known_hosts",
    "x/.aws", // dir itself, nested
    ".aws/credentials",
    "x/.aws/config",
    ".gnupg/secring.gpg",
    ".kube/config",
    ".docker/config.json",
    ".netrc",
    ".pgpass",
    ".git-credentials",
    ".htpasswd",
    ".npmrc",
    "credentials",
    "credentials.json",
    "server.pem",
    "certs/private.key",
    "keystore.p12",
    "cert.pfx",
    "id_rsa",
    "id_ed25519",
    ".env.example", // acknowledged cost — .env* is intentionally broad
  ])("blocks %s", (rel) => {
    expect(secret(rel)).toBe(true);
  });

  it.each([
    "src/index.ts",
    "README.md",
    "package.json",
    ".github/workflows/ci.yml", // hidden dir, but NOT a secret — read_lines may open it
    ".vscode/settings.json",
    ".eslintrc.json",
    ".prettierrc",
    ".gitignore",
    "environment.ts", // must not false-match ".env"
    "prevent.md",
    "id_rsad", // must anchor: not exactly id_rsa
    "notes.key.txt", // .key is not the extension
    "src/keyboard.ts",
  ])("allows %s", (rel) => {
    expect(secret(rel)).toBe(false);
  });

  it("matches on the basename regardless of directory depth", () => {
    expect(secret("a/b/c/d/e/.env")).toBe(true);
    expect(secret("a/b/c/d/e/normal.ts")).toBe(false);
  });

  it("treats a backslash path the same as forward slashes (no separator dodge)", () => {
    expect(isSecretPath("sub\\.ssh\\id_rsa", DEFAULT_SECRET_PATTERNS)).toBe(true);
  });

  it("is case-insensitive on Windows-style casing of key material", () => {
    expect(secret("Server.PEM")).toBe(true);
    expect(secret("ID_RSA")).toBe(true);
  });

  it("an empty custom policy blocks nothing", () => {
    expect(isSecretPath(".env", [])).toBe(false);
    expect(isSecretPath(".ssh/id_rsa", [])).toBe(false);
  });
});
