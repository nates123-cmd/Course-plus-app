#!/bin/bash
# Route Apple Reminders captures into the Course+ endpoint, from the Mac.
#
# Say "Hey Siri, add eggs to Capture" from a raised wrist. A minute later it is
# on the Stock shopping list.
#
# Why the Mac and not the Beelink: when Reminders was "upgraded" (iOS 13 era)
# Apple moved it into a private store that only Apple's own apps can read, and
# dropped CalDAV. A Linux box cannot see the modern lists at all - the ones it
# can still reach over CalDAV show up with a warning marker in the name and are
# legacy stubs. AppleScript talks to the real store, so this has to run here.
#
# Deliberately no Python: Homebrew venvs on this machine break on pyexpat, and
# anything under ~/Documents gets evicted by iCloud. bash + osascript + curl
# have no install step and nothing to rot.
#
# Companion to the iOS Shortcuts automation, which does the same job from the
# phone. Both are safe to run together: completing the reminder is what removes
# it from the queue, so whoever gets there first wins and the other finds
# nothing. This one is the frequent backstop for when iOS declines to fire.

set -uo pipefail

ENV_FILE="${CAPTURE_ENV_FILE:-$HOME/.config/capture-reminders.env}"
STATE_DIR="${CAPTURE_STATE_DIR:-$HOME/.local/state/capture-reminders}"
SEEN_FILE="$STATE_DIR/seen"
LIST_NAME="${CAPTURE_LIST:-Capture}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

[ -f "$ENV_FILE" ] || { log "FATAL missing config: $ENV_FILE"; exit 1; }
# shellcheck disable=SC1090
. "$ENV_FILE"

: "${CAPTURE_URL:?CAPTURE_URL not set in $ENV_FILE}"
: "${CAPTURE_KEY:?CAPTURE_KEY not set in $ENV_FILE}"

mkdir -p "$STATE_DIR"
touch "$SEEN_FILE"

# An empty queue returns in well under a second, but each item costs ~20s of
# osascript round-trips, so a burst of captures can outlast the 60s timer.
# Overlapping runs would race on the same reminders and the seen-file, so take
# an exclusive lock and let the next tick pick up whatever is left. Same
# flock-style guard as the cron jobs on the Beelink.
exec 9>"$STATE_DIR/lock"
if ! shlock -f "$STATE_DIR/pid" -p $$ 2>/dev/null; then
	# shlock is not everywhere; fall back to a plain PID-file check.
	if [ -s "$STATE_DIR/pid" ] && kill -0 "$(cat "$STATE_DIR/pid" 2>/dev/null)" 2>/dev/null; then
		log "another run is still going, skipping this tick"
		exit 0
	fi
	printf '%s' $$ > "$STATE_DIR/pid"
fi
trap 'rm -f "$STATE_DIR/pid"' EXIT

# Ask for ids only. Names and notes can contain newlines and tabs, so pulling
# everything in one blob and splitting it is a parsing bug waiting to happen -
# ids never do, so fetch the text per item instead.
ids=$(osascript <<APPLESCRIPT 2>/dev/null
tell application "Reminders"
	set out to ""
	repeat with r in (reminders of list "$LIST_NAME" whose completed is false)
		set out to out & (id of r) & linefeed
	end repeat
	return out
end tell
APPLESCRIPT
)

# A non-zero exit here is almost always TCC: the process has not been granted
# Reminders access. Fail loudly rather than looking like an empty queue.
if [ $? -ne 0 ]; then
	log "FATAL cannot read Reminders. Grant access in System Settings > Privacy & Security > Reminders."
	exit 1
fi

[ -z "${ids//[[:space:]]/}" ] && { log "nothing pending in '$LIST_NAME'"; exit 0; }

routed=0
while IFS= read -r id; do
	[ -z "$id" ] && continue

	# Covers the one window where the POST succeeded but the completion write
	# then failed. Without it that item re-routes every single run, quietly
	# duplicating a task or a shopping entry until someone notices.
	if grep -qxF "$id" "$SEEN_FILE"; then
		log "SKIP $id already routed, completion never stuck"
		continue
	fi

	# LANDMINE - scope every lookup to the list.
	# `first reminder whose id is X` has no list qualifier, so Reminders scans
	# every reminder in every list on the account to resolve one id. With a real
	# reminder history that does not return in any useful time - it looks like a
	# hang, not a slow query, and it is easy to blame the network or the
	# endpoint. `first reminder of list "..." whose id is X` is bounded and
	# returns immediately.
	text=$(osascript <<APPLESCRIPT 2>/dev/null
tell application "Reminders"
	set r to first reminder of list "$LIST_NAME" whose id is "$id"
	set n to name of r
	set b to ""
	try
		if body of r is not missing value then set b to body of r
	end try
	if b is "" then
		return n
	else
		return n & linefeed & linefeed & b
	end if
end tell
APPLESCRIPT
	)

	[ -z "${text//[[:space:]]/}" ] && continue

	# --fail-with-body so a non-2xx sets a non-zero exit but still shows the
	# endpoint's one-line explanation, which is the whole diagnostic.
	body=$(printf '%s' "$text" | curl -sS --fail-with-body --max-time 90 \
		-X POST "$CAPTURE_URL" \
		-H "x-capture-key: $CAPTURE_KEY" \
		-H 'content-type: text/plain' \
		--data-binary @- 2>&1)
	rc=$?

	if [ $rc -ne 0 ]; then
		# Leave it pending. Next run retries; nothing is lost.
		log "FAIL ${text%%$'\n'*} :: ${body:-curl exit $rc}"
		continue
	fi

	log "OK ${text%%$'\n'*} -> ${body}"

	# Record BEFORE completing: if this dies here, the next run skips the item
	# rather than sending it twice. An orphan left in the list is visible and
	# harmless; a duplicate task is silent and is not.
	printf '%s\n' "$id" >> "$SEEN_FILE"

	osascript <<APPLESCRIPT >/dev/null 2>&1
tell application "Reminders"
	set completed of (first reminder of list "$LIST_NAME" whose id is "$id") to true
end tell
APPLESCRIPT
	[ $? -ne 0 ] && log "WARN routed but could not complete $id"

	routed=$((routed + 1))
done <<< "$ids"

# Unbounded growth would be a slow leak, and an id this old can never still be
# pending, so keep a recent tail.
tail -n 500 "$SEEN_FILE" > "$SEEN_FILE.tmp" && mv "$SEEN_FILE.tmp" "$SEEN_FILE"

log "done, routed $routed"
