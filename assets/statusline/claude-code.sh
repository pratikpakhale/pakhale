#!/bin/bash
# Claude Code Status Line — minimal + info-dense
input=$(cat)

# Format integer with thousands separators (commas)
commafy() { echo "$1" | sed -e :a -e 's/\(.*[0-9]\)\([0-9]\{3\}\)/\1,\2/;ta'; }

# --- Extract fields ---
model_full=$(echo "$input" | jq -r '.model.display_name // empty')
# Extract only the model family (lowercase); fall back to first word of display name
model=$(echo "$model_full" | grep -oiE 'opus|sonnet|haiku|fable|mythos' | head -1 | tr '[:upper:]' '[:lower:]')
[ -z "$model" ] && model=$(echo "$model_full" | tr '[:upper:]' '[:lower:]' | awk '{print $1}')
thinking=$(echo "$input" | jq -r '.thinking.enabled // false')
effort=$(echo "$input" | jq -r '.effort.level // empty')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
project=$([ -n "$cwd" ] && basename "$cwd" || echo "")
pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
ctx_size=$(echo "$input" | jq -r '.context_window.context_window_size // 0')
tokens_k=$(echo "$input" | jq -r --argjson s "$ctx_size" --argjson p "$pct" '($s * $p / 100 / 1000) | floor')
five_h=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
seven_d=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')


# Git branch + diff stats
branch=""
diff_added=""
diff_removed=""
diff_files=""
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)

  # Detect base branch (run only when we have a branch name)
  if [ -n "$branch" ]; then
    base_ref=$(git -C "$cwd" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/||')
    if [ -z "$base_ref" ]; then
      for candidate in origin/release origin/main origin/master; do
        if git -C "$cwd" rev-parse --verify "$candidate" >/dev/null 2>&1; then
          base_ref="$candidate"
          break
        fi
      done
    fi

    # Compute diff stats only when we are NOT on the base branch itself
    if [ -n "$base_ref" ]; then
      base_short="${base_ref#origin/}"
      if [ "$branch" != "$base_short" ]; then
        shortstat=$(git -C "$cwd" diff --shortstat "${base_ref}...HEAD" 2>/dev/null)
        if [ -n "$shortstat" ]; then
          diff_files=$(echo "$shortstat" | grep -oE '[0-9]+ file' | grep -oE '[0-9]+')
          diff_added=$(echo "$shortstat" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+')
          diff_removed=$(echo "$shortstat" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+')
          [ -n "$diff_files" ]   && diff_files=$(commafy "$diff_files")
          [ -n "$diff_added" ]   && diff_added=$(commafy "$diff_added")
          [ -n "$diff_removed" ] && diff_removed=$(commafy "$diff_removed")
        fi
      fi
    fi
  fi
fi

# --- Colors ---
RST="\033[0m"
DIM="\033[2m"
CYAN="\033[36m"
BLUE="\033[34m"
MAG="\033[35m"
YEL="\033[33m"
RED="\033[31m"
GRN="\033[32m"

# Percentage text color
if [ "$pct" -lt 50 ]; then PCT_COLOR=$RST
elif [ "$pct" -lt 85 ]; then PCT_COLOR=$YEL
else PCT_COLOR=$RED; fi

# --- Single line ---
sep=" ${DIM}/${RST} "
model_label="${model}"
if [ "$thinking" = "true" ] || [ -n "$effort" ]; then
  think_tag="think"
  [ -n "$effort" ] && think_tag="${effort}"
  model_label="${model} ${DIM}${think_tag}${RST}"
fi
out="${CYAN}${model_label}${RST}"
[ -n "$project" ] && out="${out}${sep}${BLUE}${project}${RST}"
[ -n "$branch" ]  && out="${out}${sep}${MAG}⎇ ${branch}${RST}"
if [ -n "$diff_added" ] || [ -n "$diff_removed" ] || [ -n "$diff_files" ]; then
  diff_seg=""
  [ -n "$diff_added" ]   && diff_seg="${GRN}+${diff_added}${RST}"
  [ -n "$diff_removed" ] && diff_seg="${diff_seg:+${diff_seg} }${RED}-${diff_removed}${RST}"
  [ -n "$diff_files" ]   && diff_seg="${diff_seg:+${diff_seg} }${DIM}~${diff_files}f${RST}"
  [ -n "$diff_seg" ]     && out="${out} ${diff_seg}"
fi
out="${out}${sep}${PCT_COLOR}${pct}%${RST} ${DIM}($(commafy "$tokens_k")k)${RST}"
[ -n "$five_h" ] && out="${out}${sep}${DIM}5h:${RST}$(printf '%.0f' "$five_h")%"
[ -n "$seven_d" ] && out="${out} ${DIM}7d:${RST}$(printf '%.0f' "$seven_d")%"


printf "%b\n" "$out"
