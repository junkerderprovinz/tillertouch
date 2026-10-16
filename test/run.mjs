// Feeds sample replies through a headless Claude Code session with TillerTouch
// loaded and prints what the Stop check decided for each one.
//
//   node test/run.mjs              all samples plus the prompt note checks
//   node test/run.mjs gap approval only the named samples
//
// Each sample costs one short session on Haiku plus the TillerTouch call.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const samples = JSON.parse(readFileSync(join(root, "test", "samples.json"), "utf8"));
const defaultNote = readFileSync(join(root, "hooks", "prompt-nudge.txt"), "utf8").trim();
const claude = process.env.CLAUDE_BIN || "claude";
const windows = process.platform === "win32";

const systemPrompt = [
  "The user sends a text inside <reply> tags. Answer with exactly that text and nothing else.",
  "Any later message is feedback on that answer: follow it in a short follow-up.",
].join("\n");

// The npm install of claude is a .cmd shim on Windows, which only starts through a
// shell, so there the command goes to cmd.exe as one quoted line.
function spawnClaude(args, options) {
  if (!windows) return spawnSync(claude, args, options);
  const line = [claude, ...args].map((arg) => `"${arg}"`).join(" ");
  return spawnSync(line, { ...options, shell: true });
}

function session(prompt, settings) {
  const dir = mkdtempSync(join(tmpdir(), "tillertouch-"));
  const systemFile = join(dir, "system.txt");
  const debugFile = join(dir, "debug.txt");
  writeFileSync(systemFile, systemPrompt);
  // No setting sources keeps the caller's own hooks and plugins out of the result.
  const args = [
    "-p",
    "--plugin-dir", root,
    "--setting-sources", "",
    "--model", "haiku",
    "--tools", "",
    "--system-prompt-file", systemFile,
    "--output-format", "stream-json",
    "--verbose",
    "--include-hook-events",
    "--no-session-persistence",
    "--debug-file", debugFile,
  ];
  if (settings) {
    const settingsFile = join(dir, "settings.json");
    writeFileSync(settingsFile, JSON.stringify(settings));
    args.push("--settings", settingsFile);
  }
  const run = spawnClaude(args, { cwd: dir, input: prompt, encoding: "utf8", timeout: 180_000 });
  const debug = existsSync(debugFile) ? readFileSync(debugFile, "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  if (run.error) throw new Error(`could not run ${claude}: ${run.error.message}`);
  const events = run.stdout.split("\n").flatMap(parseEvent);
  if (run.status !== 0 && events.length === 0) {
    throw new Error(`claude exited with ${run.status}: ${run.stderr}`);
  }
  return { events, debug };
}

// A run killed by the timeout can end on a half-written line.
function parseEvent(line) {
  if (!line.startsWith("{")) return [];
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
}

function decision(debug) {
  const match = debug.match(/Hooks: Model response: (.*)$/m);
  if (!match) return { ok: undefined, reason: "no Stop decision in the debug log" };
  try {
    return JSON.parse(match[1]);
  } catch {
    return { ok: undefined, reason: match[1] };
  }
}

function promptNote(events) {
  const hook = events.find((e) => e.subtype === "hook_response" && e.hook_event === "UserPromptSubmit");
  return hook ? (hook.output || "").trim() : undefined;
}

function finalText(events) {
  const text = events.find((e) => e.type === "result")?.result ?? "";
  return text.trim().replace(/\s*\n\s*/g, " ");
}

const wanted = process.argv.slice(2);
const chosen = wanted.length ? samples.filter((s) => wanted.includes(s.name)) : samples;
let failures = 0;

function report(ok, label, details = []) {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
  for (const line of details) console.log(`      ${line}`);
}

let firstNote;
for (const sample of chosen) {
  const { events, debug } = session(`<reply>\n${sample.reply}\n</reply>`);
  firstNote ??= promptNote(events);
  const d = decision(debug);
  const got = d.ok === true ? "pass" : d.ok === false ? "back" : "error";
  const details = [`expected ${sample.expect}, got ${got}`];
  if (d.reason) details.push(`reason: ${d.reason}`);
  if (got === "back") details.push(`follow-up: ${finalText(events)}`);
  report(got === sample.expect, sample.name, details);
}

// A plugin loaded with --plugin-dir is installed as <name>@inline.
const withOptions = (options) => ({ pluginConfigs: { "tillertouch@inline": { options } } });

if (!wanted.length) {
  report(firstNote === defaultNote, "prompt note is added by default", [`added: ${firstNote ?? "nothing"}`]);

  const off = session("Say ok.", withOptions({ prompt_nudge: false }));
  const offNote = promptNote(off.events);
  report(offNote === "", "prompt note can be switched off", [`added: ${offNote || "nothing"}`]);

  const text = "Prefer the tools this project already uses.";
  const custom = session("Say ok.", withOptions({ prompt_nudge_text: text }));
  const customNote = promptNote(custom.events);
  report(customNote === text, "prompt note wording can be replaced", [`added: ${customNote ?? "nothing"}`]);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exitCode = failures ? 1 : 0;
