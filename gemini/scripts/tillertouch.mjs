// Hook entry point for the tools whose hooks can only run commands: Codex CLI,
// Gemini CLI and Factory Droid. Claude Code and Qwen Code use hooks/hooks.json.
//
//   node tillertouch.mjs nudge [--json]   context note for the prompt hook
//   node tillertouch.mjs judge <tool>      Stop check, tool is codex, gemini or droid
//
// The judge asks the tool's own CLI, in a nested headless run, whether the reply
// can stand. Anything that goes wrong lets the reply through.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hooksDir = join(here, "..", "hooks");
const nested = process.env.TILLERTOUCH_JUDGE === "1";

// A failed judge looks exactly like a passed reply, so TILLERTOUCH_DEBUG=1 says
// on stderr which one it was.
function debug(message) {
  if (process.env.TILLERTOUCH_DEBUG) process.stderr.write(`tillertouch: ${message}\n`);
}

const verdictSchema = {
  type: "object",
  properties: { ok: { type: "boolean" }, reason: { type: "string" } },
  required: ["ok", "reason"],
  additionalProperties: false,
};

// Each tool: its default small model, how to call it headless, how to read the
// answer, and what its Stop hook prints to send a reply back.
const tools = {
  codex: {
    bin: "codex",
    model: "gpt-6-luna",
    args: (model, dir) => [
      "exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
      "--disable", "hooks", "-c", "model_reasoning_effort=low", "-m", model,
      "--output-schema", join(dir, "schema.json"), "-o", join(dir, "answer.txt"), "-",
    ],
    answer: (_, dir) => readFileSync(join(dir, "answer.txt"), "utf8"),
    block: (reason) => ({ decision: "block", reason }),
    pass: "",
  },
  gemini: {
    bin: "gemini",
    model: "flash-lite",
    // The nested run works in an empty temporary folder, which Gemini CLI would
    // otherwise refuse as untrusted.
    args: (model) => [
      "-m", model, "-e", "none", "--approval-mode", "plan", "--skip-trust", "-o", "json",
      "-p", "Answer with the JSON object only.",
    ],
    answer: (stdout) => JSON.parse(stdout).response,
    block: (reason) => ({ decision: "deny", reason }),
    pass: "{}",
  },
  droid: {
    bin: "droid",
    model: "claude-haiku-5-5",
    args: (model, dir) => ["exec", "-m", model, "-o", "json", "-f", join(dir, "prompt.txt")],
    answer: (stdout) => JSON.parse(stdout).result,
    block: (reason) => ({ decision: "block", reason }),
    pass: "",
  },
};

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function option(name) {
  return process.env[`TILLERTOUCH_${name}`] ?? process.env[`CLAUDE_PLUGIN_OPTION_${name}`];
}

function nudge(json) {
  readStdin();
  if (nested || ["false", "0"].includes(option("PROMPT_NUDGE"))) {
    if (json) process.stdout.write("{}");
    return;
  }
  const text = option("PROMPT_NUDGE_TEXT") || readFileSync(join(hooksDir, "prompt-nudge.txt"), "utf8").trim();
  process.stdout.write(json
    ? JSON.stringify({ hookSpecificOutput: { hookEventName: "BeforeAgent", additionalContext: text } })
    : `${text}\n`);
}

// Droid hands over only the transcript, a JSONL file whose exact shape is not
// documented, so this takes the text of the last line that looks like an
// assistant message.
function lastReplyFromTranscript(path) {
  let lines;
  try {
    lines = readFileSync(path, "utf8").split("\n");
  } catch {
    return "";
  }
  let reply = "";
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message ?? entry;
    if (message.role !== "assistant" && entry.type !== "assistant") continue;
    const content = message.content;
    const text = typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.filter((part) => part?.type === "text").map((part) => part.text).join("\n")
        : "";
    if (text.trim()) reply = text;
  }
  return reply;
}

function verdictFrom(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return undefined;
  const verdict = JSON.parse(text.slice(start, end + 1));
  return typeof verdict.ok === "boolean" ? verdict : undefined;
}

// On Windows the npm installs of these CLIs are .cmd shims, which only start
// through a shell, so there the call goes to cmd.exe as one quoted line.
function run(bin, args, options) {
  const cli = process.env.TILLERTOUCH_CLI;
  if (cli) [bin, args] = [process.execPath, [cli, ...args]];
  if (process.platform !== "win32" || cli) return spawnSync(bin, args, options);
  const line = [bin, ...args].map((arg) => `"${arg}"`).join(" ");
  return spawnSync(line, { ...options, shell: true });
}

function judge(name) {
  const tool = tools[name];
  const input = readStdin();
  if (!tool || nested || input.stop_hook_active) {
    debug(tool ? "skipped, nested run or already sent back" : `unknown tool ${name}`);
    process.stdout.write(tool?.pass ?? "");
    return;
  }
  const reply = input.last_assistant_message ?? input.prompt_response ?? lastReplyFromTranscript(input.transcript_path);
  if (!reply.trim()) {
    debug("no reply in the hook input");
    process.stdout.write(tool.pass);
    return;
  }

  const hookInput = { last_assistant_message: reply, stop_hook_active: false };
  if (input.prompt) hookInput.user_prompt = input.prompt;
  const prompt = [
    "Judge the text below only. Do not run tools or read files.",
    readFileSync(join(hooksDir, "judge-prompt.txt"), "utf8").replace("$ARGUMENTS", () => JSON.stringify(hookInput)),
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "tillertouch-judge-"));
  try {
    writeFileSync(join(dir, "prompt.txt"), prompt);
    writeFileSync(join(dir, "schema.json"), JSON.stringify(verdictSchema));
    const model = process.env.TILLERTOUCH_MODEL || tool.model;
    const seconds = Number(process.env.TILLERTOUCH_TIMEOUT) || 90;
    const result = run(tool.bin, tool.args(model, dir), {
      cwd: dir,
      input: prompt,
      encoding: "utf8",
      timeout: seconds * 1000,
      env: { ...process.env, TILLERTOUCH_JUDGE: "1" },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${tool.bin} exited with ${result.status}: ${result.stderr.trim()}`);
    const verdict = verdictFrom(tool.answer(result.stdout, dir));
    if (!verdict) throw new Error("the answer held no verdict");
    debug(`verdict ${JSON.stringify(verdict)}`);
    if (!verdict.ok && verdict.reason) {
      process.stdout.write(JSON.stringify(tool.block(verdict.reason)));
      return;
    }
  } catch (error) {
    // A judge that cannot answer is no reason to hold the reply back.
    debug(`judge failed, letting the reply through: ${error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.stdout.write(tool.pass);
}

const [mode, arg] = process.argv.slice(2);
if (mode === "nudge") nudge(arg === "--json");
else if (mode === "judge") judge(arg);
