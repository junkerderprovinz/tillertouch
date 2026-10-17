// Copies the shared files into the packages that install as their own directory
// (Gemini CLI and Factory Droid copy only that directory).
//
//   node scripts/sync.mjs           write the copies
//   node scripts/sync.mjs --check   exit 1 when a copy is out of date

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = ["scripts/tillertouch.mjs", "hooks/judge-prompt.txt", "hooks/tool-prompt.txt", "hooks/prompt-nudge.txt"];
const packages = ["gemini", "factory"];
const check = process.argv.includes("--check");

const read = (path) => readFileSync(join(root, path), "utf8");
const wanted = new Map();
for (const pkg of packages) {
  for (const file of shared) wanted.set(`${pkg}/${file}`, read(file));
}

const stale = [];
for (const [path, content] of wanted) {
  let current;
  try {
    current = read(path);
  } catch {
    current = undefined;
  }
  if (current === content) continue;
  stale.push(path);
  if (!check) writeFileSync(join(root, path), content);
}

if (check && stale.length) {
  console.error(`out of date, run node scripts/sync.mjs: ${stale.join(", ")}`);
  process.exitCode = 1;
} else if (!check) {
  console.log(stale.length ? `updated ${stale.join(", ")}` : "everything up to date");
}
