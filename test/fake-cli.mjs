// Stands in for codex, gemini and droid when test/run.mjs checks the judge
// script offline. FAKE_MODE picks the answer, FAKE_LOG records the call.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const after = (flag) => args[args.indexOf(flag) + 1];
const tool = args.includes("--output-schema") ? "codex" : args.includes("-e") ? "gemini" : "droid";
const prompt = tool === "droid" ? readFileSync(after("-f"), "utf8") : readFileSync(0, "utf8");

if (process.env.FAKE_LOG) {
  writeFileSync(process.env.FAKE_LOG, JSON.stringify({ tool, args, judge: process.env.TILLERTOUCH_JUDGE, prompt }));
}

const mode = process.env.FAKE_MODE || "pass";
if (mode === "fail") process.exit(1);
if (mode === "sleep") await new Promise((done) => setTimeout(done, 5000));

const verdict = mode === "block"
  ? { ok: false, reason: "TillerTouch (gap): name a test for the timeout path." }
  : { ok: true, reason: "Nothing to add." };
const text = mode === "garbage" ? "I would rather not say." : `\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\``;

if (tool === "codex") writeFileSync(after("-o"), text);
else if (tool === "gemini") process.stdout.write(JSON.stringify({ response: text }));
else process.stdout.write(JSON.stringify({ result: text }));
