// Runs the TillerTouch checks.
//
//   node test/run.mjs                  offline checks, then a live run for every tool on the path
//   node test/run.mjs offline          only the offline checks, no model involved
//   node test/run.mjs claude gap       only Claude Code, only the gap sample
//   node test/run.mjs codex gemini     the live judge through these CLIs
//
// Live runs use your own login for each tool. Qwen Code runs the same prompt hook
// as Claude Code, so the claude suite covers its judgment.

import { claudeSuite } from "./claude.mjs";
import { judgeSuite } from "./judges.mjs";
import { failed, onPath, samples } from "./lib.mjs";
import { offlineSuite } from "./offline.mjs";

const live = { claude: process.env.CLAUDE_BIN || "claude", codex: "codex", gemini: "gemini", droid: "droid" };
const args = process.argv.slice(2);
const named = args.filter((arg) => arg === "offline" || arg in live);
const sampleNames = args.filter((arg) => !named.includes(arg));
const chosen = sampleNames.length ? samples.filter((s) => sampleNames.includes(s.name)) : samples;

if (!named.length || named.includes("offline")) offlineSuite();

for (const [suite, bin] of Object.entries(live)) {
  if (named.length && !named.includes(suite)) continue;
  if (!onPath(bin)) {
    console.log(`skip  ${suite}: ${bin} is not on the path`);
    continue;
  }
  if (suite === "claude") claudeSuite(chosen, !sampleNames.length);
  else judgeSuite(suite, chosen);
}

console.log(failed() ? `\n${failed()} check(s) failed` : "\nall checks passed");
process.exitCode = failed() ? 1 : 0;
