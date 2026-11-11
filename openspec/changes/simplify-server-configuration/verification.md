# Verification

Verified on 2026-11-07.

- 167 tests passed, 3 opt-in tests skipped; TypeScript and production build passed.
- Shared-connection tests assert Producer chat and audio discovery/TTS use the configured model key and base URL. Unsupported remote capabilities reject before network submission.
- Configuration example validates; migration preserves secrets, unrelated multiline values, backups, local/proxy intent and data locations. Reapplication is a no-op; ambiguous keys/endpoints/layouts reject without changes.
- Reference launcher argument forwarding and data-copy credential preservation verified with isolated fixtures.
- Local server health reports local mode; four saved projects remain visible. Draft creation, tempo edit, undo and clean Save succeeded without changing the saved original or saved-project count.
- Initial capability discovery reported only OpenRouter as a remote provider. Remote audio requires S3. The later user-approved default Producer is DeepSeek Flash, selectable in the sidebar; its live context-recognition check completed without project edits.
- Client build scan: 39 static files, zero matches for the configured credential.
- History: 23 commits scanned in both the local repository and a fresh remote mirror. Local scan covers 857 stored objects including tooling tree refs; remote scan covers 698 objects. Removed integration names/protocol signatures/path matches: zero. Current source scan: 348 files, zero matches.
- Rewritten remote main matches the local history head. The history push used an explicit lease. Current uncommitted files were preserved through the ref/index update; recovery bundle and before/after worktree archives are outside the repository.
- Current implementation remains in the working tree; history cleanup was pushed separately. No service deployment was performed.
