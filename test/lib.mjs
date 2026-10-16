import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const samples = JSON.parse(readFileSync(join(root, "test", "samples.json"), "utf8"));

let failures = 0;
export const failed = () => failures;

export function report(ok, label, details = []) {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  for (const line of details) console.log(`      ${line}`);
}

// npm installs these CLIs as .cmd shims on Windows, which only start through a
// shell, so there the command goes to cmd.exe as one quoted line.
export function spawnTool(bin, args, options = {}) {
  if (process.platform !== "win32") return spawnSync(bin, args, { encoding: "utf8", ...options });
  const line = [bin, ...args].map((arg) => `"${arg}"`).join(" ");
  return spawnSync(line, { encoding: "utf8", ...options, shell: true });
}

export function onPath(bin) {
  const run = spawnTool(bin, ["--version"], { timeout: 60_000 });
  return !run.error && run.status === 0;
}
