// Hook entry point for the tools whose hooks run commands: Claude Code, Codex CLI,
// Gemini CLI and Factory Droid.
//
//   node tillertouch.mjs nudge [--json]   context note for the prompt hook
//   node tillertouch.mjs judge <tool>      Stop check, tool is claude, codex, gemini or droid;
//                                          for claude it also checks each tool call
//
// The judge asks the tool's own CLI, in a nested headless run, whether the reply
// or the call can stand. Anything that goes wrong lets it through.
//
// TILLERTOUCH_MODE=demand runs the judge only for a prompt that contains the word TT.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  claude: {
    bin: "claude",
    model: "opus",
    args: (model) => [
      "-p", "--model", model, "--setting-sources", "", "--tools", "",
      "--no-session-persistence", "--output-format", "json",
    ],
    answer: (stdout) => JSON.parse(stdout).result,
    block: (reason) => ({ decision: "block", reason }),
    blockCall: (reason) => ({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
    pass: "",
  },
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

function sessionFile(input, name) {
  const id = String(input.session_id ?? "none").replace(/[^\w-]/g, "_");
  return join(tmpdir(), `tillertouch-${id}-${name}`);
}

// The prompt hook runs before every turn, so it is where the judge learns whether
// this turn asked for it.
function rememberPrompt(input) {
  const prompt = String(input.prompt ?? "");
  const asked = /(^|[^A-Za-z0-9])TT([^A-Za-z0-9]|$)/.test(prompt);
  try {
    writeFileSync(sessionFile(input, "prompt.json"), JSON.stringify({ prompt, asked }));
  } catch (error) {
    debug(`could not remember the prompt: ${error.message}`);
  }
}

function recalled(input) {
  try {
    return JSON.parse(readFileSync(sessionFile(input, "prompt.json"), "utf8"));
  } catch {
    return {};
  }
}

function nudge(json) {
  const input = readStdin();
  if (!nested) rememberPrompt(input);
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

// Runs the tool's own CLI headless on the prompt and returns its verdict. A run
// that cannot answer is no reason to hold anything back, so it returns nothing.
function ask(tool, prompt) {
  const dir = mkdtempSync(join(tmpdir(), "tillertouch-judge-"));
  try {
    writeFileSync(join(dir, "prompt.txt"), prompt);
    writeFileSync(join(dir, "schema.json"), JSON.stringify(verdictSchema));
    const model = option("MODEL") || tool.model;
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
    return verdict;
  } catch (error) {
    debug(`judge failed, letting it through: ${error.message}`);
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function judgePrompt(file, replacement) {
  return [
    "Judge the text below only. Do not run tools or read files.",
    readFileSync(join(hooksDir, file), "utf8").replace("$ARGUMENTS", () => replacement),
  ].join("\n\n");
}

const longestCall = 6000;

// A call that was sent back once goes through the second time, so an assistant
// that has a reason for it is not stuck in a loop.
function checkCall(tool, input) {
  if (!tool.blockCall) return tool.pass;
  const call = JSON.stringify({ tool_name: input.tool_name, tool_input: input.tool_input }).slice(0, longestCall);
  const seen = sessionFile(input, `sent-back-${createHash("sha1").update(call).digest("hex")}`);
  if (existsSync(seen)) {
    debug("call already sent back once");
    return tool.pass;
  }
  const verdict = ask(tool, judgePrompt("tool-prompt.txt", call));
  if (!verdict || verdict.ok || !verdict.reason) return tool.pass;
  writeFileSync(seen, "");
  return JSON.stringify(tool.blockCall(verdict.reason));
}

function judge(name) {
  const tool = tools[name];
  const input = readStdin();
  if (!tool || nested || input.stop_hook_active) {
    debug(tool ? "skipped, nested run or already sent back" : `unknown tool ${name}`);
    process.stdout.write(tool?.pass ?? "");
    return;
  }
  const remembered = recalled(input);
  if (option("MODE") === "demand" && !remembered.asked) {
    debug("demand mode and no TT in this prompt");
    process.stdout.write(tool.pass);
    return;
  }
  if (input.hook_event_name === "PreToolUse") {
    process.stdout.write(checkCall(tool, input));
    return;
  }
  const reply = input.last_assistant_message ?? input.prompt_response ?? lastReplyFromTranscript(input.transcript_path);
  if (!reply.trim()) {
    debug("no reply in the hook input");
    process.stdout.write(tool.pass);
    return;
  }

  const hookInput = { last_assistant_message: reply, stop_hook_active: false };
  const userPrompt = input.prompt ?? remembered.prompt;
  if (userPrompt) hookInput.user_prompt = userPrompt;
  const verdict = ask(tool, judgePrompt("judge-prompt.txt", JSON.stringify(hookInput)));
  if (verdict && !verdict.ok && verdict.reason) {
    process.stdout.write(JSON.stringify(tool.block(verdict.reason)));
    return;
  }
  process.stdout.write(tool.pass);
}

const [mode, arg] = process.argv.slice(2);
if (mode === "nudge") nudge(arg === "--json");
else if (mode === "judge") judge(arg);
