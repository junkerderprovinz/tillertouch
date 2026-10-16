#!/bin/sh
# Claude Code exports each userConfig option as CLAUDE_PLUGIN_OPTION_<KEY>.

case "$CLAUDE_PLUGIN_OPTION_PROMPT_NUDGE" in
  false|0) exit 0 ;;
esac

if [ -n "$CLAUDE_PLUGIN_OPTION_PROMPT_NUDGE_TEXT" ]; then
  printf '%s\n' "$CLAUDE_PLUGIN_OPTION_PROMPT_NUDGE_TEXT"
else
  cat "$(dirname "$0")/prompt-nudge.txt"
fi
