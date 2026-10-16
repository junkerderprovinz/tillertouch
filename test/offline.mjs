// Checks the command-hook script without any model: test/fake-cli.mjs stands in
// for codex, gemini and droid, and fixed hook inputs stand in for the tools.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { report, root } from "./lib.mjs";

const script = join(root, "scripts", "tillertouch.mjs");
const note = readFileSync(join(root, "hooks", "prompt-nudge.txt"), "utf8").trim();
const reply = "I added retry logic to the upload client. The timeout path is untested.";
const dir = mkdtempSync(join(tmpdir(), "tillertouch-offline-"));
const log = join(dir, "call.json");

const transcript = join(dir, "session.jsonl");
writeFileSync(transcript, [
  { type: "message", message: { role: "user", content: [{ type: "text", text: "Add retries to the upload client." }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Looking at the client first." }] } },
  { type: "message", message: { role: "assistant", content: [{ type: "text", text: reply }] } },
].map((entry) => JSON.stringify(entry)).join("\n"));

const inputs = {
  codex: { hook_event_name: "Stop", last_assistant_message: reply, stop_hook_active: false },
  gemini: { hook_event_name: "AfterAgent", prompt: "Add retries to the upload client.", prompt_response: reply, stop_hook_active: false },
  droid: { hook_event_name: "Stop", transcript_path: transcript, stop_hook_active: false },
};
const blocks = { codex: "block", gemini: "deny", droid: "block" };
const passes = { codex: "", gemini: "{}", droid: "" };
const models = { codex: "gpt-6-luna", gemini: "flash-lite", droid: "claude-haiku-5-5" };

function hook(args, input, env = {}) {
  rmSync(log, { force: true });
  const run = spawnSync(process.execPath, [script, ...args], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, TILLERTOUCH_CLI: join(root, "test", "fake-cli.mjs"), FAKE_LOG: log, ...env },
  });
  const call = existsSync(log) ? JSON.parse(readFileSync(log, "utf8")) : undefined;
  return { out: run.stdout, call };
}

export function offlineSuite() {
  for (const tool of Object.keys(inputs)) {
    const { out, call } = hook(["judge", tool], inputs[tool], { FAKE_MODE: "block" });
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      parsed = {};
    }
    report(parsed.decision === blocks[tool] && parsed.reason?.startsWith("TillerTouch (gap)"),
      `${tool}: a reply the judge rejects goes back`, [`printed: ${out || "nothing"}`]);
    report(call?.judge === "1" && call.args.includes(models[tool]) && call.prompt.includes(reply) && !call.prompt.includes("$ARGUMENTS"),
      `${tool}: the nested call gets the reply, the small model and the nesting guard`);

    for (const mode of ["pass", "fail", "garbage"]) {
      const result = hook(["judge", tool], inputs[tool], { FAKE_MODE: mode });
      report(result.out === passes[tool], `${tool}: a ${mode} answer lets the reply through`, [`printed: ${result.out || "nothing"}`]);
    }
    const slow = hook(["judge", tool], inputs[tool], { FAKE_MODE: "sleep", TILLERTOUCH_TIMEOUT: "1" });
    report(slow.out === passes[tool], `${tool}: a judge that times out lets the reply through`);

    const again = hook(["judge", tool], { ...inputs[tool], stop_hook_active: true }, { FAKE_MODE: "block" });
    report(!again.call && again.out === passes[tool], `${tool}: a reply sent back once is not judged again`);

    const inner = hook(["judge", tool], inputs[tool], { FAKE_MODE: "block", TILLERTOUCH_JUDGE: "1" });
    report(!inner.call && inner.out === passes[tool], `${tool}: the nested run does not judge itself`);

    const custom = hook(["judge", tool], inputs[tool], { TILLERTOUCH_MODEL: "some-other-model" });
    report(custom.call?.args.includes("some-other-model"), `${tool}: TILLERTOUCH_MODEL picks the model`);
  }

  const codexFlags = hook(["judge", "codex"], inputs.codex).call?.args.join(" ") ?? "";
  report(codexFlags.includes("--disable hooks") && codexFlags.includes("--sandbox read-only"),
    "codex: the nested run has hooks off and a read-only sandbox");
  const geminiFlags = hook(["judge", "gemini"], inputs.gemini).call?.args.join(" ") ?? "";
  report(geminiFlags.includes("-e none") && geminiFlags.includes("--approval-mode plan"),
    "gemini: the nested run loads no extensions and stays read-only");
  const dollars = "The cost went from $1 to $& per run, see $' above.";
  const dollarPrompt = hook(["judge", "codex"], { ...inputs.codex, last_assistant_message: dollars }).call?.prompt ?? "";
  report(dollarPrompt.includes(JSON.stringify(dollars).slice(1, -1)), "codex: dollar signs in a reply reach the judge unchanged");
  const droidPrompt = hook(["judge", "droid"], inputs.droid).call?.prompt ?? "";
  report(droidPrompt.includes(reply) && !droidPrompt.includes("Looking at the client first"),
    "droid: the reply comes from the last assistant line of the transcript");

  const text = hook(["nudge"], {}).out.trim();
  report(text === note, "nudge: prints the default note");
  const json = JSON.parse(hook(["nudge", "--json"], {}).out || "{}");
  report(json.hookSpecificOutput?.hookEventName === "BeforeAgent" && json.hookSpecificOutput.additionalContext === note,
    "nudge: --json wraps the note for Gemini CLI");
  report(hook(["nudge"], {}, { TILLERTOUCH_PROMPT_NUDGE: "false" }).out === "", "nudge: TILLERTOUCH_PROMPT_NUDGE=false switches it off");
  report(hook(["nudge"], {}, { TILLERTOUCH_PROMPT_NUDGE_TEXT: "Use the Makefile." }).out.trim() === "Use the Makefile.",
    "nudge: TILLERTOUCH_PROMPT_NUDGE_TEXT replaces the wording");
  report(hook(["nudge"], {}, { TILLERTOUCH_JUDGE: "1" }).out === "", "nudge: the nested run gets no note");

  const sync = spawnSync(process.execPath, [join(root, "scripts", "sync.mjs"), "--check"], { encoding: "utf8" });
  report(sync.status === 0, "sync: the packages and the Claude Code prompt match the shared files", [sync.stderr.trim()].filter(Boolean));

  const events = (path) => Object.keys(JSON.parse(readFileSync(join(root, path), "utf8")).hooks).sort().join(",");
  for (const path of ["hooks/hooks.json", "codex/hooks.json", "factory/hooks/hooks.json"]) {
    report(events(path) === "Stop,UserPromptSubmit", `${path}: only UserPromptSubmit and Stop`);
  }
  report(events("gemini/hooks/hooks.json") === "AfterAgent,BeforeAgent", "gemini/hooks/hooks.json: only BeforeAgent and AfterAgent");

  rmSync(dir, { recursive: true, force: true });
}
