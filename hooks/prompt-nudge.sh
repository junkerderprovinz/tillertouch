#!/bin/sh
# Claude Code exports each userConfig option as CLAUDE_PLUGIN_OPTION_<KEY>. Qwen Code
# has no plugin options, so the TILLERTOUCH_ variables work there as well.

enabled="${TILLERTOUCH_PROMPT_NUDGE:-$CLAUDE_PLUGIN_OPTION_PROMPT_NUDGE}"
text="${TILLERTOUCH_PROMPT_NUDGE_TEXT:-$CLAUDE_PLUGIN_OPTION_PROMPT_NUDGE_TEXT}"

case "$enabled" in
  false|0) exit 0 ;;
esac

if [ -n "$text" ]; then
  printf '%s\n' "$text"
else
  cat "$(dirname "$0")/prompt-nudge.txt"
fi
