<h1 align="center">TillerTouch</h1>

<p align="center">
  <a href="https://code.claude.com/docs/en/plugins"><img src="https://img.shields.io/badge/Claude%20Code-Plugin-D97757?style=for-the-badge&logoColor=white" alt="Claude Code plugin" height="36"></a>&nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue?style=for-the-badge&logo=gnu&logoColor=white" alt="License: AGPL-3.0" height="36"></a>
</p>

<br>

<p align="center">
A <b>second look</b> at your coding assistant's replies, for <a href="https://code.claude.com/docs/en/overview">Claude Code</a>.<br>
<br>
Before a turn ends, a small model reads the final reply. If the reply names a gap and leaves it open, asks you to
approve something it never showed you, or walks past a clearly better tool, TillerTouch sends it back once with a
one-line note and Claude adds what was missing. Everything else goes through untouched.<br>
<br>
The name comes from sailing: a light touch on the tiller is enough to bring the boat back on course.
</p>

<br>

<p align="center">
  <a href="https://buymeacoffee.com/junkerderprovinz"><img src="https://raw.githubusercontent.com/junkerderprovinz/junkerderprovinz/main/donate/buttons/button-buy-me-a-coffee-live.svg" alt="Buy me a coffee" width="160"></a>
  &nbsp;
  <a href="https://www.paypal.com/donate/?hosted_button_id=76FVV52TKXTUS"><img src="https://raw.githubusercontent.com/junkerderprovinz/junkerderprovinz/main/donate/buttons/button-paypal-live.svg" alt="PayPal" width="160"></a>
  &nbsp;
  <a href="https://junkerderprovinz.github.io/junkerderprovinz/"><img src="https://raw.githubusercontent.com/junkerderprovinz/junkerderprovinz/main/donate/buttons/button-crypto-live.svg" alt="Donate with crypto" width="160"></a>
</p>

<br>

## Table of Contents

1. [What it does](#1-what-it-does)
2. [The three checks](#2-the-three-checks)
3. [Install](#3-install)
4. [Configuration](#4-configuration)
5. [Cost](#5-cost)
6. [Limits](#6-limits)
7. [Testing](#7-testing)
8. [How AI is used here](#8-how-ai-is-used-here)
9. [Support this project](#9-support-this-project)

<br>

## 1. What it does

TillerTouch adds two hooks to Claude Code.

On every prompt it adds a short note to the context: before taking the obvious route, check whether a better
method, a fitting tool, an installed skill, plugin or MCP server, or a helper that already exists in the project
would do the job better, and if so, say it first in a sentence or two. This part makes no model call of its own. A
second call on every prompt would add a wait and a bill, and only the main session knows which skills, plugins and
tools are installed, so the main session is the one that has to look.

When a turn ends, a [prompt hook](https://code.claude.com/docs/en/hooks#prompt-based-hooks) on the `Stop` event
reads the final reply and decides whether it can stand. If one of the three checks below fails, the reply goes back
to Claude with the reason, and Claude continues the same turn with a short follow-up. A reply that already went
back once in a turn always passes, so a single reply is never sent back twice.

<br>

## 2. The three checks

### A gap with no way to close it

The reply says something is untested, missing, never ran, unknown or not verified, and stops there. It passes as
soon as it names a test, a fix, or a plan with a recommendation, or says Claude does it now. It also passes when it
explains why the gap cannot be closed from here and tells you the next step.

> I added retry logic to the upload client. The timeout path is untested and I have not verified it against the real server.

Sent back with: *TillerTouch (gap): the reply says "The timeout path is untested" but gives no test or plan to
close it. Name a concrete way to test the timeout path.*

### Asking for approval without showing what to approve

The reply asks you to approve a text to post, a release, a commit or a change, but the text, the notes or the diff
are not in the same message.

> The release notes for 2.3.0 are ready. Shall I publish the release?

Sent back with: *TillerTouch (approval): the reply asks "Shall I publish the release?" but the release notes are
not shown. Include them before asking for the go.*

### A clearly better way it did not mention

The reply describes how the work was done, and a clearly better method, tool, skill or existing helper fits the
task, but the reply does not mention it. Matters of taste do not count.

> I went through all 63 Go files and fixed the indentation and spacing by hand so they match standard Go style.

Sent back with: *TillerTouch (better way): `gofmt -w .` does this in one command and is the obvious tool. Say so.*

The full prompt is in [`hooks/hooks.json`](hooks/hooks.json).

<br>

## 3. Install

The repository is its own plugin marketplace. In Claude Code:

```text
/plugin marketplace add junkerderprovinz/tillertouch
/plugin install tillertouch@tillertouch
```

Or from a shell:

```sh
claude plugin marketplace add junkerderprovinz/tillertouch
claude plugin install tillertouch@tillertouch
```

To try it without installing, clone the repository and start Claude Code with `claude --plugin-dir path/to/tillertouch`.
`/plugin` turns it off again.

<br>

## 4. Configuration

The prompt note has two options. Change them with `/plugin configure tillertouch@tillertouch`, or in `/config`,
where every enabled plugin lists its options. Until you set them, the defaults apply.

| Option | Default | What it does |
| :- | :- | :- |
| `prompt_nudge` | `true` | Adds the note to every prompt. Set it to `false` to keep only the check at the end of the turn. |
| `prompt_nudge_text` | empty | Replaces the wording of the note. Empty keeps the default from [`hooks/prompt-nudge.txt`](hooks/prompt-nudge.txt). |

Claude Code stores the answers under `pluginConfigs` in your user settings file:

```json
{
  "pluginConfigs": {
    "tillertouch@tillertouch": {
      "options": {
        "prompt_nudge": true,
        "prompt_nudge_text": "Before you start, check whether a tool this project already uses fits better."
      }
    }
  }
}
```

The check at the end of the turn has no switch of its own. Prompt hooks cannot read plugin options, and Claude Code
cannot turn off a single plugin hook, so `/plugin` is the way to pause it.

<br>

## 5. Cost

The note on each prompt costs no model call, only about 80 tokens of context.

The check at the end of the turn is **one small-model call per reply**. TillerTouch does not pick a model: Claude
Code uses the one it runs background work on, which is Haiku today. The call reads the conversation for context
along with the reply, so it grows with the session. In a short session one check came to about 1,200 input tokens,
well under a cent at list price. A reply that goes back adds one follow-up from your main model.

<br>

## 6. Limits

- Claude Code shows a reply while it is being written, so the check cannot hold it back. You see the reply first
  and the follow-up right after it, in the same turn.
- The check runs on a small model. It will miss some replies and send back a few it should have let through, which
  is why the prompt tells it to let a reply pass when in doubt.
- Only the main conversation is checked, not the reports of subagents.
- The prompt note runs in a POSIX shell. macOS and Linux always have one, and on Windows Claude Code runs hook
  commands in Git Bash. Without Git Bash the note is skipped, and the check at the end of the turn still runs.
- There is no hook after edits. One that looks at larger edits and suggests a missing test or a simpler way sounded
  useful, but a prompt hook on `PostToolUse` cannot be limited to large changes or switched off by a setting. It
  would cost a model call and a wait on every edit, small ones included, so I left it out.

<br>

## 7. Testing

[`test/run.mjs`](test/run.mjs) starts a headless Claude Code session per sample in
[`test/samples.json`](test/samples.json), with TillerTouch loaded and your own settings and hooks left out. The
session repeats the sample as its reply, the check runs on it, and the script prints the decision, the reason and
the follow-up. It also checks that the prompt note is added, can be switched off and can be reworded.

```sh
node test/run.mjs                  # every sample and the prompt note checks
node test/run.mjs gap approval     # only these samples
```

It needs Node.js and a logged-in `claude` on the path (`CLAUDE_BIN` points it elsewhere). Each sample is one short
session on Haiku plus the check, so a full run costs a few cents and takes about a minute.

<br>

## 8. How AI is used here

TillerTouch is built on a model: every check at the end of a turn is a call to one, made by Claude Code on your
account. That is the point of the plugin, and it is why the [cost](#5-cost) section exists.

The code and this README were also written with help from an AI assistant, the same way I work with an editor or a
compiler. I read and understand everything before it ships, and if something here is wrong, that is on me. If you
find something that is not right, open an issue and I will look at it.

<br>

## 9. Support this project

Bugs, ideas or feature requests? Please [open a GitHub issue](https://github.com/junkerderprovinz/tillertouch/issues).

A one-knight job: I build it, keep it running, work through the issues and add what people ask for. It is free,
with no accounts, no telemetry, no ads and no paid tier. If it has earned a place in your setup, toss a coin to
your knight with one of the buttons at the top.
