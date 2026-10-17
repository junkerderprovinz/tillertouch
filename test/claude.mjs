// Feeds sample replies through a headless Claude Code session with TillerTouch
// loaded and reports what the Stop check decided for each one. Each sample costs
// one short session on Haiku plus the TillerTouch call.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { report, root, spawnTool } from "./lib.mjs";

const claude = process.env.CLAUDE_BIN || "claude";
const defaultNote = readFileSync(join(root, "hooks", "prompt-nudge.txt"), "utf8").trim();

const systemPrompt = [
  "The user sends a text inside <reply> tags. Answer with exactly that text and nothing else.",
  "Any later message is feedback on that answer: follow it in a short follow-up.",
].join("\n");

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
  const env = { ...process.env, TILLERTOUCH_MODE: "permanent", TILLERTOUCH_MODEL: "haiku", TILLERTOUCH_DEBUG: "1" };
  const run = spawnTool(claude, args, { cwd: dir, input: prompt, timeout: 180_000, env });
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

function decision(events) {
  const stop = events.filter((e) => e.subtype === "hook_response" && e.hook_event === "Stop");
  const text = stop.map((e) => `${e.stderr ?? ""}\n${e.output ?? ""}`).join("\n");
  const match = text.match(/verdict (\{.*\})/);
  if (!match) return { ok: undefined, reason: "no Stop decision in the hook output" };
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

// A plugin loaded with --plugin-dir is installed as <name>@inline.
const withOptions = (options) => ({ pluginConfigs: { "tillertouch@inline": { options } } });

export function claudeSuite(chosen, noteChecks) {
  let firstNote;
  for (const sample of chosen) {
    const { events } = session(`<reply>\n${sample.reply}\n</reply>`);
    firstNote ??= promptNote(events);
    const d = decision(events);
    const got = d.ok === true ? "pass" : d.ok === false ? "back" : "error";
    const details = [`expected ${sample.expect}, got ${got}`];
    if (d.reason) details.push(`reason: ${d.reason}`);
    if (got === "back") details.push(`follow-up: ${finalText(events)}`);
    report(got === sample.expect, `claude: ${sample.name}`, details);
  }
  if (!noteChecks) return;

  firstNote ??= promptNote(session("Say ok.").events);
  report(firstNote === defaultNote, "claude: prompt note is added by default", [`added: ${firstNote ?? "nothing"}`]);

  const off = session("Say ok.", withOptions({ prompt_nudge: false }));
  const offNote = promptNote(off.events);
  report(offNote === "", "claude: prompt note can be switched off", [`added: ${offNote || "nothing"}`]);

  const text = "Prefer the tools this project already uses.";
  const custom = session("Say ok.", withOptions({ prompt_nudge_text: text }));
  const customNote = promptNote(custom.events);
  report(customNote === text, "claude: prompt note wording can be replaced", [`added: ${customNote ?? "nothing"}`]);
}
