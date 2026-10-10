/**
 * Cabeceras de seguridad (ADR-081). nginx sustituye las `add_header` del nivel superior cuando un `location` define las
 * suyas (p. ej. Cache-Control), así que cada location debe incluir el fichero de cabeceras o se queda sin ellas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Bloques `location … { … }` de un fichero nginx (sin anidamiento, que estos ficheros no usan). */
const locations = (conf: string) => [...conf.matchAll(/location\s+[^{]+\{([^}]*)\}/g)].map((m) => m[0]);

describe.each([
  ["dashboard", "dashboard/nginx/default.conf.template", "dashboard/nginx/security-headers.conf", "dashboard/Dockerfile"],
  ["docs", "docs-site/nginx/default.conf", "docs-site/nginx/security-headers.conf", "docs-site/Dockerfile"],
])("%s nginx", (_name, confPath, snippetPath, dockerfile) => {
  it("includes the security headers in every location", () => {
    const blocks = locations(read(confPath));
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.filter((b) => !b.includes("include /etc/nginx/snippets/security-headers.conf;"))).toEqual([]);
  });

  it("ships the snippet in the image", () => {
    expect(read(dockerfile)).toContain("/etc/nginx/snippets/security-headers.conf");
  });

  it("sends the headers on error responses too, forbids framing and sniffing, and allows no plugins", () => {
    const snippet = read(snippetPath);
    for (const header of ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) {
      expect(snippet).toMatch(new RegExp(`add_header ${header} ".+" always;`));
    }
    expect(snippet).toContain("frame-ancestors 'none'");
    expect(snippet).toContain("object-src 'none'");
    expect(snippet).toContain("X-Content-Type-Options \"nosniff\"");
  });
});

describe("dashboard policy", () => {
  const csp = read("dashboard/nginx/security-headers.conf");
  it("allows no script from anywhere but the app itself", () => {
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).not.toMatch(/https?:\/\//);
  });
  it("does not restrict form-action, because the OIDC login is a form POST that is redirected to the identity provider", () => {
    expect(csp).not.toContain("form-action");
  });
});

describe("API", () => {
  it("adds the headers to every /api response", async () => {
    const rules = await nextConfig.headers!();
    const api = rules.find((r) => r.source === "/api/:path*")!;
    const keys = api.headers.map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Content-Security-Policy"]));
  });
});
