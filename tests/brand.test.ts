import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const walk = (d: URL): URL[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : [new URL(e.name, d)]);

test("BrandMark reuses the exact artwork of the working favicon", () => {
  const fav = read("public/favicon.svg");
  const mark = read("src/components/BrandMark.tsx");
  for (const piece of ['viewBox="0 0 64 64"', 'fill="#0F1A2B"', 'stroke="#F2AE72"', 'fill="#2F6E62"', "M25 39 L39 25", "M40 16.5 L43 20.5 L49.5 12.5"]) {
    assert.ok(fav.includes(piece.replace(/fill="none" /, "")) || fav.includes(piece), `favicon lacks ${piece}`);
    assert.ok(mark.includes(piece), `BrandMark lacks ${piece}`);
  }
  assert.ok(mark.includes('aria-label="PostAtlas"'));
});
test("no page renders an empty coloured square in place of the logo", () => {
  for (const f of walk(new URL("../src/", import.meta.url)).filter((x) => /\.tsx$/.test(x.pathname))) {
    assert.ok(!/<span[^>]*rounded-md[^>]*(bg-ink|bg-paper)[^>]*inline-block/s.test(readFileSync(f, "utf8")), `${f.pathname} still has a placeholder box`);
  }
});
test("header, footer, dashboard shell and auth pages use BrandMark; favicon links remain", () => {
  for (const p of ["src/components/SiteHeader.tsx", "src/components/SiteFooter.tsx", "src/components/AppShell.tsx", "src/app/login/page.tsx", "src/app/signup/page.tsx", "src/app/reset-password/page.tsx", "src/app/update-password/page.tsx"]) assert.match(read(p), /<BrandMark/, p);
  const layout = read("src/app/layout.tsx");
  for (const h of ["/favicon.svg", "/favicon.ico", "/favicon-32.png", "/apple-touch-icon.png"]) assert.ok(layout.includes(h), h);
});
test("the dark footer/sidebar variant gets a visible ring", () => {
  assert.match(read("src/components/SiteFooter.tsx"), /<BrandMark[^>]*onDark/);
  assert.match(read("src/components/AppShell.tsx"), /<BrandMark[^>]*onDark=\{dark\}/);
});
