#!/usr/bin/env node
// A tiny server for the tests: the fixtures folder, plus routes the speed, crawl and session tests need.
//   /slow.js     a render-blocking script that takes 1.2 s
//   /hero.svg    a large image (the LCP element of perf-broken.html)
//   /private     "Signed in" only with the cookie sr=1
//   /robots.txt, /sitemap.xml, /share.png (a 600×600 PNG)   for seo-check's site checks
// SERVE_SITE=broken: a broken site for seo-check instead (robots.txt blocking a noindex page, a named group
// dropping the wildcard's rules, no Sitemap: line, a sitemap with relative / 404 / noindex <loc>s, and a
// catch-all that answers 200 for any path without an extension).
// Prints the port on its first line.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const broken = process.env.SERVE_SITE === "broken";
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const png = (w, h) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; const row = Buffer.alloc(1 + w * 3, 0x55); row[0] = 0; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]); };
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const site = `http://${req.headers.host}`;
  const text = (body, type = "text/plain") => { res.writeHead(200, { "content-type": type }); res.end(body); };
  if (path === "/robots.txt") return text(broken ? "User-agent: *\nDisallow: /seo-broken.html\n\nUser-agent: GPTBot\nAllow: /\n" : `User-agent: *\nAllow: /\nDisallow: /private\n\nSitemap: ${site}/sitemap.xml\n`);
  if (path === "/sitemap.xml") return text(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${(broken ? ["/clean.html", `${site}/gone.html`, `${site}/seo-broken.html`] : [`${site}/clean.html`, `${site}/app.html`]).map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`, "application/xml");
  if (path === "/share.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(png(600, 600)); }
  if (path === "/slow.js") return setTimeout(() => { res.writeHead(200, { "content-type": types[".js"] }); res.end("window.__slow = 1;"); }, 1200);
  if (path === "/hero.svg") { res.writeHead(200, { "content-type": types[".svg"] }); return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#3355aa"/>${"<circle cx='800' cy='450' r='300' fill='#fff' opacity='.1'/>".repeat(400)}</svg>`); }
  if (path === "/private") {
    const ok = /(^|;\s*)sr=1(;|$)/.test(req.headers.cookie || "");
    res.writeHead(ok ? 200 : 401, { "content-type": types[".html"] });
    return res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Private</title></head><body><main><h1>${ok ? "Signed in" : "Sign in"}</h1></main></body></html>`);
  }
  const file = join(dir, path === "/" ? "clean.html" : path.replace(/^\/+/, ""));
  if (broken && !extname(path) && path !== "/") return text("<!doctype html><html><head><title>App</title></head><body><div id=root></div></body></html>", types[".html"]);
  if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" }); res.end(readFileSync(file));
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
