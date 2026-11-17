#!/usr/bin/env node
// A tiny server for the tests: the fixtures folder, plus routes the speed, crawl and session tests need.
//   /slow.js     a render-blocking script that takes 1.2 s
//   /hero.svg    a large image (the LCP element of perf-broken.html)
//   /private     "Signed in" only with the cookie sr=1
// Prints the port on its first line.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/slow.js") return setTimeout(() => { res.writeHead(200, { "content-type": types[".js"] }); res.end("window.__slow = 1;"); }, 1200);
  if (path === "/hero.svg") { res.writeHead(200, { "content-type": types[".svg"] }); return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#3355aa"/>${"<circle cx='800' cy='450' r='300' fill='#fff' opacity='.1'/>".repeat(400)}</svg>`); }
  if (path === "/private") {
    const ok = /(^|;\s*)sr=1(;|$)/.test(req.headers.cookie || "");
    res.writeHead(ok ? 200 : 401, { "content-type": types[".html"] });
    return res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Private</title></head><body><main><h1>${ok ? "Signed in" : "Sign in"}</h1></main></body></html>`);
  }
  const file = join(dir, path === "/" ? "clean.html" : path.replace(/^\/+/, ""));
  if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" }); res.end(readFileSync(file));
});
server.listen(0, "127.0.0.1", () => console.log(server.address().port));
