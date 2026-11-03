# Verification — 2026-11-03

## Automated checks

- Backend: uv run pytest — 16 passed. Covers every command and inverse, deletion identity/order, sequential undo, edit-after-undo, exhaustion, independent stale sessions, simultaneous writers, restart persistence, transactional rollback after update, missing/corrupt/interrupted legacy migration, and idempotent restart.
- Backend: uv run ruff check app tests — passed.
- Frontend: npm run build — passed; existing bundle-size advisory (541 kB JS).
- Frontend: npm run lint — no errors; six existing shared UI/use-mobile warnings.
- OpenSpec strict validation — passed.

## Storage measurements

Measured serialized JSON payload bytes with fixed 32-character track IDs:

| Tracks (one clip each) | Old full document snapshot | Lock forward | Lock inverse |
| --- | ---: | ---: | ---: |
| 1 | 394 bytes | 108 bytes | 109 bytes |
| 1000 | 332953 bytes | 108 bytes | 109 bytes |

These sizes exclude row metadata and database overhead. Current Project.document is still validated/diffed/written; no constant-time editing claim is made. Old snapshots are retained read-only rather than pruned.

## Local migration and runtime

- Stopped the verified original backend writer and restarted the updated backend on 127.0.0.1:8200.
- Startup created a SQLite pre-operations backup in backend/data before adding tables/converting history.
- Imported 19 legacy revisions as operation entries, preserving all 3 original project names, internal counters, and document SHA-256 hashes. Verified again after UI tests; original documents remain unchanged. Legacy revision count remains 19 after new edits.
- Live API returns can_undo; stale command and Producer message return 409 version_conflict, exhausted undo returns 422 invalid_command without another event.
- Created local test project History check (ae1be9be4b6b4bd59c10e66ce30aed2d). Browser: add track, lock, undo to unlock, undo to remove track, Undo disabled. Producer proposal application after exhaustion succeeds; undo again removes that track and disables Undo. Test project remains empty.

## Clip presentation

- Consulted official FL Studio Playlist documentation linked in docs/architecture.md.
- Replaced the random rounded capsule decoration with a compact clip and top title strip (52px track, 44px clip, 2px corner radius). Empty clips explicitly identify missing source; no fake MIDI notes or waveform data are generated. Actual note/waveform rendering remains unavailable until real content is supported.
- Browser checked at its existing 789x764 size. Selected original clip remains selectable and the surrounding shadcn sidebar-15 shell is preserved. Saved clip-after.png and left original Midnight sketch open.
