#!/usr/bin/env node
// login.mjs: sign in once by hand, save the session, review signed-in pages with it.
//
//   node login.mjs <url> [--out .review/state.json]
//   node review.mjs <url> --storage .review/state.json
//
// Opens a visible browser at the URL. Sign in as you normally would, then close the window: the cookies and
// local storage are saved as a Playwright storage state. Keep the file out of git (it is a live session).

import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { parseArgs, toUrl, loadChromium } from "./lib.mjs";

const { opt, target } = parseArgs(["--out"]);
if (!target) { console.error("usage: login.mjs <url> [--out .review/state.json]"); process.exit(2); }
const file = resolve(opt("--out", ".review/state.json"));
mkdirSync(dirname(file), { recursive: true });
const { chromium } = loadChromium();
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ viewport: null });
const page = await ctx.newPage();
await page.goto(toUrl(target));
console.log("Sign in in the browser window, then close it. The session is saved when the window closes.");
let saved = false;
const save = async () => { if (saved) return; saved = true; await ctx.storageState({ path: file }).catch(() => {}); };
// Save often while it's open (closing the last window can end the context before a final save).
const timer = setInterval(() => ctx.storageState({ path: file }).catch(() => {}), 2000);
await new Promise((r) => { page.on("close", r); browser.on("disconnected", r); });
clearInterval(timer);
await save();
await browser.close().catch(() => {});
console.log(`→ ${file} (pass it as --storage ${file}; never commit it)`);
