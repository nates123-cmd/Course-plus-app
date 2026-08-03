#!/usr/bin/env python3
"""Route Apple Reminders into the Course+ capture endpoint.

Say "Hey Siri, add eggs to Capture" from a raised wrist. The reminder syncs to
iCloud in seconds; this poller reads that one list over CalDAV, POSTs each item
to /capture, and marks it complete once the router has written a real record.

Why CalDAV and not a file watcher: iCloud *Drive* is an Apple-only surface, so
anything reading Just Press Record's folder has to run on a Mac. Reminders sync
over plain RFC 4791 CalDAV with an app-specific password, so this can live on
the Beelink, which is always on and never sleeps. That is the whole reason this
approach wins - the capture is one utterance and nothing in the path depends on
a laptop being awake.

Scope: this only ever touches ONE named list. See SHARED-LIST MODE in the
README before pointing it at the default Reminders list; the behaviour there is
not the same and this script would eat real reminders.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path

import caldav
import requests

CALDAV_URL = "https://caldav.icloud.com"

# Marking a todo complete is what stops it being picked up again, so in the
# normal case no local state is needed. This cache exists only for the narrow
# window where the POST succeeded but the completion write then failed - without
# it, that item would be routed again on every cycle, quietly duplicating a task
# or a shopping item every minute until someone noticed.
SEEN_PATH = Path(os.environ.get("CAPTURE_SEEN_FILE", "~/.local/state/capture-reminders/seen.json")).expanduser()

log = logging.getLogger("capture-reminders")


def load_env(path: Path) -> None:
    """Read KEY=value lines. Secrets live here, never in the repo or the unit file."""
    if not path.exists():
        sys.exit(f"missing config: {path}")
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def load_seen() -> set[str]:
    try:
        return set(json.loads(SEEN_PATH.read_text()))
    except Exception:
        return set()


def save_seen(seen: set[str]) -> None:
    # Unbounded growth would be a slow leak, and an item this old can never
    # still be pending, so keep only a recent tail.
    trimmed = list(seen)[-500:]
    SEEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    SEEN_PATH.write_text(json.dumps(trimmed))


def find_list(principal: caldav.Principal, name: str) -> caldav.Calendar:
    """Locate the Reminders list by display name.

    iCloud exposes Reminders lists and Calendars through the same collection, so
    match on name rather than assuming an ordering. Matching is case-insensitive
    because the name Siri hears and the name shown in the app can differ in case.
    """
    wanted = name.strip().lower()
    available = []
    for cal in principal.calendars():
        try:
            display = str(cal.get_properties([caldav.dav.DisplayName()]).get("{DAV:}displayname", "") or "")
        except Exception:
            display = ""
        available.append(display)
        if display.strip().lower() == wanted:
            return cal
    sys.exit(f"no Reminders list named {name!r}. Found: {', '.join(filter(None, available)) or '(none)'}")


def text_of(todo) -> str:
    """Title, plus the note body when there is one.

    Siri puts everything in SUMMARY, so DESCRIPTION is usually empty - but a
    reminder typed on the phone can carry a note, and dropping it would silently
    lose half of what was captured.
    """
    component = todo.icalendar_component
    summary = str(component.get("SUMMARY", "") or "").strip()
    description = str(component.get("DESCRIPTION", "") or "").strip()
    return f"{summary}\n\n{description}".strip() if description else summary


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )

    load_env(Path(os.environ.get("CAPTURE_ENV_FILE", "~/apps/capture-router/.env")).expanduser())

    apple_id = os.environ.get("APPLE_ID")
    apple_password = os.environ.get("APPLE_APP_PASSWORD")
    capture_url = os.environ.get("CAPTURE_URL")
    capture_key = os.environ.get("CAPTURE_KEY")
    list_name = os.environ.get("CAPTURE_LIST", "Capture")

    missing = [
        name
        for name, value in [
            ("APPLE_ID", apple_id),
            ("APPLE_APP_PASSWORD", apple_password),
            ("CAPTURE_URL", capture_url),
            ("CAPTURE_KEY", capture_key),
        ]
        if not value
    ]
    if missing:
        sys.exit(f"config incomplete, missing: {', '.join(missing)}")

    # An app-specific password is mandatory here. iCloud CalDAV rejects the real
    # Apple ID password outright, which is a feature: this box never holds the
    # credential that could change the account.
    client = caldav.DAVClient(url=CALDAV_URL, username=apple_id, password=apple_password)
    todos = find_list(client.principal(), list_name).todos()

    if not todos:
        log.info("nothing pending in %r", list_name)
        return 0

    seen = load_seen()
    routed = 0

    for todo in todos:
        uid = str(todo.icalendar_component.get("UID", "") or "")
        if uid and uid in seen:
            log.warning("skipping %s: already routed, completion never stuck", uid)
            continue

        text = text_of(todo)
        if not text:
            continue

        try:
            response = requests.post(
                capture_url,
                data=text.encode("utf-8"),
                headers={"x-capture-key": capture_key, "content-type": "text/plain"},
                timeout=60,  # the endpoint calls a model; it is not instant
            )
        except requests.RequestException as err:
            # Leave it pending. The next run retries, and nothing is lost.
            log.error("post failed for %r: %s", text[:60], err)
            continue

        if response.status_code != 200:
            log.error("endpoint %s for %r: %s", response.status_code, text[:60], response.text.strip()[:120])
            continue

        outcome = response.text.strip()
        log.info("routed %r -> %s", text[:60], outcome)

        # Record BEFORE completing: if the process dies here, the next run skips
        # the item rather than routing it a second time. An orphan in the list is
        # a visible, harmless problem; a duplicate task is a silent one.
        if uid:
            seen.add(uid)
            save_seen(seen)

        try:
            todo.complete()
        except Exception as err:
            log.error("routed but could not complete %s: %s", uid, err)

        routed += 1

    log.info("done, routed %d of %d", routed, len(todos))
    return 0


if __name__ == "__main__":
    sys.exit(main())
