#!/usr/bin/env node
// Sets the NEXUS version everywhere it is recorded, so the release pipeline's
// consistency check passes:
//   Cargo.toml ([workspace.package] version), Cargo.lock (workspace crates),
//   apps/desktop/package.json, apps/desktop/package-lock.json,
//   apps/desktop/src-tauri/tauri.conf.json
//
// Usage (from the repository root):  node scripts/bump-version.mjs 0.1.1
// Versions must be MAJOR.MINOR.PATCH and newer than the current one.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const next = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error("usage: node scripts/bump-version.mjs MAJOR.MINOR.PATCH   (e.g. 0.1.1)");
  process.exit(1);
}

const conf = "apps/desktop/src-tauri/tauri.conf.json";
const current = JSON.parse(readFileSync(conf, "utf8")).version;
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
if (cmp(next, current) <= 0) {
  console.error(`${next} is not newer than the current version ${current}.`);
  process.exit(1);
}

const replaceOnce = (file, pattern, replacement) => {
  const text = readFileSync(file, "utf8");
  if (!pattern.test(text)) throw new Error(`version not found in ${file}`);
  writeFileSync(file, text.replace(pattern, replacement));
};

// JSON files: only the top-level "version" keys, keeping formatting.
replaceOnce(conf, /("productName": "NEXUS",\s*"version": ")[^"]+(")/, `$1${next}$2`);
replaceOnce("apps/desktop/package.json", /^(\s{2}"version": ")[^"]+(")/m, `$1${next}$2`);
const lock = "apps/desktop/package-lock.json";
const lockJson = JSON.parse(readFileSync(lock, "utf8"));
lockJson.version = next;
lockJson.packages[""].version = next;
writeFileSync(lock, JSON.stringify(lockJson, null, 2) + "\n");
replaceOnce("Cargo.toml", /(\[workspace\.package\]\s*\nversion = ")[^"]+(")/, `$1${next}$2`);

// Refresh Cargo.lock entries of the workspace crates only (no dependency changes).
execFileSync("cargo", ["update", "--workspace", "--offline"], { stdio: "inherit" });
console.log(`NEXUS version ${current} -> ${next}. Next: commit, push, then publish GitHub Release v${next} with release notes (see docs/releasing.md).`);
