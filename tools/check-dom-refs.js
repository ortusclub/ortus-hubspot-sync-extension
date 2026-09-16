#!/usr/bin/env node
// Every element popup.js reaches for must exist in popup.html. Deleting a
// button from the markup without deleting its JS reference throws at load and
// takes the whole side panel down, which is silent until someone opens it.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const js = fs.readFileSync(path.join(root, "popup.js"), "utf8");

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
// setNavDiag creates this one on the fly when it is absent.
ids.add("navDiag");

const refs = [...js.matchAll(/\$\("([^"]+)"\)/g), ...js.matchAll(/getElementById\("([^"]+)"\)/g)]
  .map(m => m[1]);
const missing = [...new Set(refs)].filter(id => !ids.has(id));

if (missing.length) {
  console.error("Missing from popup.html: " + missing.join(", "));
  process.exit(1);
}
console.log(`PASS  ${new Set(refs).size} element references, all present in popup.html`);
