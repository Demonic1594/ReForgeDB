# The ReForge extensions

Reworked forks of tryforge's ForgeScript extensions, built to work together. ReForgeDB is the base the others store their data with. This page is the checklist every ReForge extension follows, and which versions work together.

## Compatibility

| | ReForgeDB 3.x | ForgeDB 2.x |
|---|---|---|
| **ReForgeGiveaways** 2.3.0+ | ✅ (recommended) | ✅, with a one-time reminder to switch |
| ReForgeGiveaways ≤ 2.2.1 | ❌ requires `forge.db` | ✅ |
| **ReForgeTopGG** 3.1.0+, `store: "reforgedb"` (or `"forgedb"`, the same store) | ✅ (recommended) | ✅, with a one-time reminder to switch |
| ReForgeTopGG ≤ 3.0.0, `store: "forgedb"` | ❌ requires `forge.db` | ✅ |
| ReForgeTopGG, other stores | not needed | not needed |
| Original ForgeGiveaways / ForgeTopGG | ❌ | ✅ |

Each extension's CI tests the pairs that interact: ReForgeGiveaways runs every test file with ForgeDB and with ReForgeDB, and ReForgeTopGG tests its database store with each and with both loaded. ReForgeDB is pinned there to a tag in `package.json`. Both use whichever database extension the bot loaded, anywhere in the extension list, and ReForgeDB when both are.

## Checklist

**Naming**
- Package `@tryforge/reforge.<name>`, class `ReForge<Name>`, extension name `reforge.<name>`, event handler `ReForge<Name>Events`.
- The original's class and option-type names are not exported. Removing an exported name is a major version.

**Messages, logging and errors**
- Everything printed starts with `[ReForge<Name>]`, and so do option errors (which stop the bot at start-up, from the constructor or `validateAndInit`, never from `init`) and function errors (which `$try` catches).
- A `logLevel` option (`silent`, `error`, `warn`, `info`, `debug`, `trace`, default `info`) and a `REFORGE<NAME>_LOG_LEVEL` environment variable. `debug` shows every operation worth knowing about; `trace` every request or timer. Secrets, tokens and request bodies are never written at any level.
- A failing listener or event command is logged; it never crashes the bot or fails the operation that emitted it.

**Database**
- Accept ReForgeDB (`reforge.db`) or ForgeDB (`forge.db`), ReForgeDB when both are loaded, and stop at start-up with a message naming both when the extension needs one and neither is there. ForgeScript's `requireExtensions` can only ask for one, so check in `validateAndInit`.
- Store through the loaded extension: extend its `DataBaseManager` at start-up (not at module load), or use `client.db`, which both provide.
- With ForgeDB, show the reminder to switch once per process, through the shared flag `Symbol.for("reforge.forgeDBReminder")` on `globalThis`, so a bot with several ReForge extensions sees it once.
- Never change the type or length of an existing column (TypeORM re-creates it on PostgreSQL and MySQL and drops the data). Adding nullable columns and indexes is safe.
- Never open an SQLite file with a second SQLite driver in the same process: sqlite3 and better-sqlite3 each bring their own copy of SQLite, and two copies do not see each other's locks.

**Timers and restarts**
- A timer that fires after downtime must not flood: drop events more than a configurable cut-off late (and mark them handled), as ReForgeTopGG's `reminderMaxDelay` and ReForgeDB's `cooldownExpireMaxDelay` do.
- No `setTimeout` for anything that can last longer than 24.8 days (Node fires those at once); check the database instead.
- Timers are unref'd and stopped by `client.destroy()`. Tests that need the process to stay up hold it open themselves.
- With several bot processes on one database, an event fires in exactly one of them: claim it with a conditional write.

**Users' data and installs**
- Never move, rename or change a user's files or data without an option that lets them choose.
- Don't change defaults that alter what users must install (peer dependencies, `engines`) without saying so in the upgrade notes. The database extensions are optional peers of the other ReForge extensions, so npm installs only the one the bot depends on.

**Tests**
- Tests boot a real ForgeScript client (never logged in) and run ForgeScript code through the real interpreter. Only the outside world (Discord's API, Top.gg) is stubbed, never the extension.
- Every fix gets a test that fails on the previous release. Measure before optimizing; drop what doesn't measurably pay.
- Each repository keeps its own copy of its harness and logger (no shared package yet).

**CI**
- Node.js 22 and 24, and the oldest ForgeScript the peer range allows (2.5.0).
- Every database the extension supports, and every pair with another extension that it interacts with.
- `dist/` and `metadata/` are committed (the packages install from GitHub), and CI fails when they are stale.

**Releases and docs**
- README in the same layout (contents, why, installation, options, functions, events, switching from the original, upgrading, notes, development, credits).
- CHANGELOG entry with upgrade notes for each release.
- Merge with a merge commit, tag that commit with an annotated tag `v<x.y.z>`, push the tag. Pushing the tag publishes the GitHub release (`.github/workflows/release.yml`), with the notes from `.github/release-notes/v<x.y.z>.md` or the version's CHANGELOG section; the workflow refuses a tag that does not match `package.json`.

## Status

| | Naming | Logging | Either database | Node 22/24 + ForgeScript 2.5 CI | Pair CI |
|---|---|---|---|---|---|
| ReForgeDB 3.2.0 | ✅ | ✅ | (is the database) | ✅ | n/a |
| ReForgeGiveaways 2.3.0 | ✅ | ✅ | ✅ | ✅ | ✅ |
| ReForgeTopGG 3.1.0 | ✅ | ✅ | ✅ | ✅ | ✅ |

All three keep `engines: node >=18.17` although CI tests 22 and newer (ForgeScript 2.8 itself needs Node.js 22): raising it would change what users can install.
