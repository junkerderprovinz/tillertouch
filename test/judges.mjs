// Runs the samples through scripts/tillertouch.mjs with the real codex, gemini
// or droid on the path, so the nested call goes to the tool's own login and model.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { report, root } from "./lib.mjs";

const script = join(root, "scripts", "tillertouch.mjs");

function input(tool, reply, dir) {
  if (tool === "gemini") return { hook_event_name: "AfterAgent", prompt: "", prompt_response: reply, stop_hook_active: false };
  if (tool === "codex") return { hook_event_name: "Stop", last_assistant_message: reply, stop_hook_active: false };
  const transcript = join(dir, "session.jsonl");
  writeFileSync(transcript, JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: reply }] } }));
  return { hook_event_name: "Stop", transcript_path: transcript, stop_hook_active: false };
}

export function judgeSuite(tool, chosen) {
  const dir = mkdtempSync(join(tmpdir(), "tillertouch-live-"));
  for (const sample of chosen) {
    const run = spawnSync(process.execPath, [script, "judge", tool], {
      input: JSON.stringify(input(tool, sample.reply, dir)),
      encoding: "utf8",
      timeout: 180_000,
      env: { ...process.env, TILLERTOUCH_DEBUG: "1" },
    });
    let out = {};
    try {
      out = JSON.parse(run.stdout || "{}");
    } catch {
      out = {};
    }
    const failed = run.stderr.match(/judge failed.*$/m)?.[0];
    const got = out.reason ? "back" : failed ? "error" : "pass";
    const details = [`expected ${sample.expect}, got ${got}`];
    if (out.reason) details.push(`reason: ${out.reason}`);
    if (failed) details.push(failed);
    report(got === sample.expect, `${tool}: ${sample.name}`, details);
  }
  rmSync(dir, { recursive: true, force: true });
}
