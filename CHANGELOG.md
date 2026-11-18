# Changelog

## 3.3.0 (ReForgeDB, November 2026)

For bots switching from ForgeDB: its cooldown names can be kept, and a call written for them is reported at start-up. Nothing changes for a bot that sets nothing, apart from that warning.

### Added
- **`forgeDBCooldownNames` option** (off by default). On: `$userCooldown`, `$memberCooldown`, `$guildCooldown`, `$channelCooldown`, `$getUserCooldownTime`, `$getMemberCooldownTime`, `$getGuildCooldownTime`, `$deleteUserCooldown`, `$deleteMemberCooldown`, `$deleteGuildCooldown` and `$deleteChannelCooldown` are the stored cooldowns too, with ForgeDB's arguments (the same as the `$db` functions; checked against ForgeDB 2.1.1), so a bot switching from ForgeDB needs no renaming. They replace ForgeScript's in-memory cooldowns of those names, also when another client in the process loaded ForgeScript's first. ForgeScript then logs `Attempted to override the following 11 functions` at start-up: its own versions being skipped, as with ForgeDB.
- **Start-up warning** (option off) for each call that looks written for ForgeDB's stored cooldowns: one of these names whose first argument is not an ID or a function, e.g. `$userCooldown[daily;1d;...]`. Such a call runs ForgeScript's in-memory cooldown, which reads `daily` as the user ID, so every user shares one cooldown, lost on restart (reproduced on 3.2.0: user A's claim blocks user B). The warning names the command and file and both fixes. It runs once, on the ready event, over the bot's commands, its application commands and the commands of extensions. `findLegacyCooldownCalls(client)` and `FORGEDB_COOLDOWN_NAMES` are exported.

### Tests
- `test/forgedb-names.test.js` (the option, after ForgeScript's functions were loaded first) and `test/forgedb-names-warning.test.js` (the warning): 5 of their 6 tests fail on 3.2.0. 166 tests on SQLite (160 before).

## 3.2.0 (ReForgeDB, November 2026)

A cooldown-expiry event, SQLite backups, and export/import for every database, adapted from ideas in [QuorielDB](https://github.com/quoriel/db) (hold timers, backups) and built differently. Nothing to migrate; without the new event nothing runs that did not run before.

### Added
- **`cooldownExpire` event** with `$cooldownData[name|id|identifier|startedAt|duration|expiredAt]`. It fires once when a stored cooldown runs out. ReForgeDB looks for cooldowns that ran out every `cooldownExpireInterval` (new option, 5 s) instead of keeping a timer per cooldown (QuorielDB's way), so any duration works (Node fires a `setTimeout` over 24.8 days at once) and nothing is rescheduled on start. Each expiry is claimed with a conditional delete (same identifier, start and duration), so with several bot processes on one database exactly one fires it, and a cooldown restarted or deleted before it ran out fires nothing. Cooldowns that ran out more than `cooldownExpireMaxDelay` (new option, 12 hours, at least 1 minute) ago, while the bot was offline, are deleted without an event and counted in the log, so a restart never sends a flood. Checks handle 500 at a time and continue at once when there are more. Without a listener nothing is checked, and the hourly sweep deletes expired cooldowns as before.
- **`$dbBackup[file name?]`** and **`client.db.backup(file?)`**, SQLite: a consistent copy while the bot runs (`VACUUM INTO`), as one file without `-wal`, in `backups/` next to the database by default. Never overwrites a file or the database itself. `$dbBackup` takes only a plain file name (no folders, no leading dot), so a command cannot write outside `backups/`. On other databases it fails with an error that names `export()` and the database's own tools.
- **`client.db.export()`** and **`client.db.import(data, { overwrite })`**, every database: all variables and cooldowns as plain JSON-safe data, and back, also into another type of database (checked by hand from SQLite into PostgreSQL). Existing entries are kept unless `overwrite` is set; the whole input is checked before the first write, so invalid data writes nothing and the error lists the problems. Import emits no events and refreshes the caches.
- [ECOSYSTEM.md](ECOSYSTEM.md): the checklist every ReForge extension follows, and which versions work together.

### Not taken from QuorielDB
- Its configurable key schema and `registerDB` types: they would break ForgeDB's key format, which existing databases use, and `DataBaseManager` already lets extensions add their own tables.
- LMDB.

### Tests
- `test/expire.test.js` (8): fired once with `$cooldownData` in an event command, restarted and deleted cooldowns, every scope, downtime (30 stale dropped, a 30-minute-late one and a 30-day cooldown fired), 1,200 at once, 4 processes on one database (60 expiries, each fired once in exactly one process), no checks without a listener.
- `test/backup.test.js` (7 on SQLite, 5 on servers): export, wipe and import round trip with running cooldowns; overwrite; invalid input writes nothing; caches refreshed; `$dbBackup` complete and never overwriting; names that would leave `backups/` refused and nothing written; a consistent copy during writes; the error on servers.
- 160 tests on SQLite (145 before), 130 on PostgreSQL (117).

## 3.1.0 (ReForgeDB, November 2026)

Faster cooldown claims, one fix in them, and tests for switching between the two SQLite drivers. Nothing to migrate.

### Performance
- **A cooldown claim is one statement**, whether it starts the cooldown or finds it running (3.0.0: a read, plus a write when it started it). ReForgeDB remembers when each cooldown it saw runs out and picks the statement that likely decides the claim: a conditional write (`INSERT ... ON CONFLICT DO UPDATE ... WHERE` it has run out; on MongoDB one update pipeline with upsert that keeps a running cooldown's values) when it is probably free, a read when it is probably running. The database still decides every claim, so a wrong guess costs one more statement, never a wrong answer. MySQL and MariaDB keep the read and the conditional write when starting a cooldown: their `ON DUPLICATE KEY UPDATE` cannot report reliably whether it changed the row.
- Measured with `$dbUserCooldown` on PostgreSQL 16, 5 ms away in each direction, 150 users: starting a cooldown 24.0-24.6 ms (3.0.0) → 12.8-13.0 ms; finding it running 11.7-11.8 ms → 11.8-11.9 ms.

### Fixed
- **A claim that lost a race could report a cooldown as started that was not.** When another process started the cooldown between the claim's two statements and it was gone again (deleted, or a very short one) before the claim read the time left, the claim answered "started": the command ran and no cooldown was stored. A claim that did not start the cooldown now tries again, and never answers "started" without it.

### Tests
- `test/driver.test.js`: a database written with one SQLite driver is read the same by the other, in both directions (every scope, odd values, values that look like SQL, a leaderboard, running cooldowns); the schema is left as it is; 8 switches back and forth with the write-ahead log off and on; a crash (`kill -9`) with one driver, read by the other; a file that is not a database is reported and never overwritten; a missing driver package is named and no file is created; a file locked by another program fails with a catchable error after the 5 s busy timeout and works again afterwards; four processes on both drivers writing one file at once, with every cooldown claimed exactly once.
- 145 tests on SQLite (129 before), 117 on PostgreSQL, MariaDB and MySQL (114), 118 on MongoDB (115).
- `better-sqlite3` is a development dependency, so `npm install` brings both drivers for the tests. Nothing changes for bots that install ReForgeDB.

### Documentation
- A section on switching between `sqlite` and `better-sqlite3`, with a warning found by these tests: never open the database file with the other driver in the same process. Each driver brings its own copy of SQLite, and two copies in one process do not see each other's locks.

## 3.0.0 (ReForgeDB, November 2026)

The first release of ReForgeDB, a fork of [ForgeDB](https://github.com/tryforge/ForgeDB) 2.1.1 (commit `0f9c251`). A review of every function and of the storage layer: each fix below has a test, and the bugs were reproduced on ForgeDB 2.1.1 first. [Upgrade notes](README.md#switching-from-forgedb).

Existing databases are used as they are: same tables, same keys, same SQLite file. Tested by upgrading a ForgeDB database on SQLite, PostgreSQL and MariaDB.

### Renamed
- Package `@tryforge/reforge.db`, class `ReForgeDB`, options type `IReForgeDBOptions` (`IDataBaseOptions` still works), extension name `reforge.db`, event handler `ReForgeDBEvents`, log prefix `[ReForgeDB]`. The `ForgeDB` name is not exported.
- `DBCommandManager`, `DBEventHandler`, `IDBEvents` and `DBLogger` are `ReForgeDBCommandManager`, `ReForgeDBEventHandler`, `IReForgeDBEvents` and `ReForgeDBLogger`. `DataBase` and `DataBaseManager` keep their names.
- The SQLite file of a new install is `database/reforge.db`. An existing ForgeDB `database/forge.db` is used where it is unless the new `forgeDBFile` option says otherwise: `copy` (to `reforge.db`, keeping `forge.db`), `rename`, or `ignore` (start empty). Side files are copied or moved with it. Once `reforge.db` exists it is always used.
- Extensions that require `forge.db` by name or import `@tryforge/forge.db` (ForgeGiveaways, ReForgeGiveaways up to 2.2.1) do not load with ReForgeDB until they are updated.

### Fixed: cooldowns
- **Eleven cooldown functions never loaded.** ForgeScript has built-in (checked in 2.3.0, 2.4.1, 2.5.0 and 2.8.0) `$userCooldown`, `$memberCooldown`, `$guildCooldown`, `$channelCooldown` and their `delete`/`get` functions, and refuses to let an extension replace them (`Attempted to override the following 11 functions`). **Correction (2026-11-16): this is wrong for a bot.** ForgeScript loads every extension's functions before its own and skips its own names that are taken, so in a bot with ForgeDB the 11 functions were ForgeDB's; the warning is ForgeScript's own versions being skipped (checked with one client on ForgeScript 2.5.0 and 2.8.0 and ForgeDB 2.1.1: `$userCooldown[daily;1d;...]` writes ForgeDB's cooldown table). A test harness that creates a second client in the same process gets the opposite result. What follows for switching: the `db` names are right, but renaming is required, since with ReForgeDB the old names run ForgeScript's in-memory cooldowns with other arguments (see the README's Switching from ForgeDB, step 4). ForgeDB's stored cooldowns were never used: code written from its documentation ran ForgeScript's in-memory, per-command cooldowns, with the arguments in another order (`[user ID;duration;code]`), and lost them on restart. The stored cooldowns are now `$dbUserCooldown`, `$dbMemberCooldown`, `$dbGuildCooldown`, `$dbChannelCooldown`, `$dbGet...CooldownTime` and `$dbDelete...Cooldown`.
- **No cooldown could be stored on MySQL or PostgreSQL.** The start time (milliseconds) went into a 32-bit `integer` column: every write failed with `value "1794590291693" is out of range for type integer`. On MySQL without strict mode it was clamped instead, which made every cooldown look expired. The columns are 64-bit on these databases now; durations over 24.8 days work too.
- **A cooldown could be passed twice.** The check and the start were separate steps, so two commands at once (a spammed `!daily`) both got through. A claim now starts the cooldown with a conditional write (only if it is still free), so the database decides even between several bot processes: of 60 claims from 6 processes at the same moment, exactly one passes. Claims in one process also queue up, so they do not race in the database for nothing.
- In the code that never loaded, `$memberCooldown` ignored its guild argument and `$userCooldown` its user argument. `$getChannelCooldownTime`, one of the four that did load, typed its channel as a guild and rejected every channel ID.
- `$delete...Cooldown` did not wait for the database, so a failure became an unhandled rejection.
- Expired cooldowns stayed in the database forever. They are deleted once an hour (`cooldownSweepInterval`).
- `$getChannelCooldownTime` also answers for ForgeScript's in-memory `$channelCooldown`, whose own getter is registered under a wrong name in ForgeScript.

### Fixed: variables
- **An empty ID field used an empty ID.** ForgeScript passes an optional argument that is present but empty as `""`. `$getUserVar[coins;;0]` read the variable of user `""` (and returned the default instead of the user's coins), and `$setUserVar[coins;5;]` wrote to it. Empty now means "the ID of the command" in every function.
- **Writing a new variable from two commands at once failed** with `UNIQUE constraint failed` or `duplicate key value` (49 of 50 concurrent writes). A write is one atomic upsert now.
- On MongoDB an update was not awaited (errors were lost, and a read right after could see the old value), and two first writes of a variable at once could insert two documents. The key index is unique now; duplicates left by ForgeDB are removed on first start (the document ForgeDB read and updated is kept), which is logged.
- `$getVar` threw a `TypeError` when the default declared with `variables()` was not text.
- A default declared under a name such as `toString` or `constructor` matched JavaScript's own object properties.
- `$getMemberVar`, `$setMemberVar`, `$getGuildVar` and others threw a `TypeError` in a direct message, and `$getRoleVar`/`$setRoleVar`/`$deleteRoleVar` without a role. They return an error that says which ID is missing.
- Channel functions took the channel as a `Channel` argument: an ID of a deleted channel made the whole command stop with an error `$try` could not catch, so the variables of a deleted channel could not be removed. They take the ID now. In a DM they no longer throw.

### Fixed: leaderboards
- **A value that is not a number broke the order** (the comparison returned `NaN`), and such a value could rank first. Only numbers are ranked; empty and text values are left out.
- **Equal values could swap places** between `$userLeaderboard`, `$getUserLeaderboardID` and `$getUserLeaderboardValue`, because the database returns rows in no fixed order. Ties are ordered by ID everywhere.
- `$getChannelLeaderboardValue[name;sort;channel ID]` always returned `0` (it compared an ID with a channel object). `$getChannelLeaderboardID` returned type `User` and only looked at the current server; it has an optional guild argument.
- An empty guild field in `$memberLeaderboard` and `$channelLeaderboard` searched for the guild `""`.
- `$get...LeaderboardLength[name;0]` returned `Infinity`; it is an error now. A negative or zero page or page size gave rows from the end; they fall back to page 1 and 10 rows.
- The row `code` set `$env[]` (an empty name) when no names were given; an error inside it was added to the output as a row instead of being reported. `$continue` and `$break` work in it.
- Rows of users or channels that are not cached showed `undefined`; they show the ID.

### Fixed: search, delete, events
- **`$searchDB` and `$deleteRecords` ignored the `user` type** (enum value `0` was treated as "no filter"): `$deleteRecords[;;user]` deleted variables of every type.
- **`$deleteRecords` without a filter deleted everything**, also when its only argument was an unset `$get[...]`. It needs at least one filter now; `$wipeDB` deletes everything.
- `$searchDB` and `$deleteRecords` did not work on MongoDB (`LIKE` patterns are translated now) and needed the bot to be in the guild given as filter.
- Events were emitted **before** the write, so a listener that read the variable saw the old state, and an event was emitted even when the write then failed.
- `variableDelete` was emitted, with `data: null`, when the variable did not exist.
- `$data`, `$newData` and `$oldData` threw a `TypeError` outside events (and `$data` inside `variableUpdate`).
- A listener or event command that failed could crash the bot (unhandled rejection).

### Fixed: connection and set-up
- **A database that was unreachable at start-up ended the process** (unhandled rejection), and functions called before the connection was made threw `Cannot read properties of undefined (reading 'getRepository')`. ReForgeDB retries (1 s, doubling up to 60 s), and functions wait for the connection up to `readyTimeout`, then fail with an error that includes the last connection error.
- The check for a missing configuration threw inside a timer, where nothing could catch it, and kept a 10 s timer alive on every start.
- Two extensions asking for the same database at the same moment opened it twice.
- `$dbPing` ran `SELECT 1`, which fails on MongoDB.
- MongoDB: every read scanned the whole collection (no index on the key). The key indexes are unique, which also makes concurrent writes safe.
- A MariaDB server used with `type: "mysql"` (the only choice ForgeDB offered) had its tables altered on every start. The server is detected; `type: "mariadb"` exists too.
- MySQL connections ask for `utf8mb4_general_ci` unless `charset` is set: the older `mysql` driver package defaults to a 3-byte charset that cannot store emojis.
- The options object passed to the constructor was modified.
- `reflect-metadata` was imported but not declared as a dependency.

### Fixed: tooling and documentation
- `npm ci` failed: `package-lock.json` did not match `package.json`.
- `npm run commit` built a shell command from the commit message and branch name; a message with quotes or `$(...)` could run commands. It calls git directly.
- The README told PostgreSQL users to install `postgres`; the driver is `pg`.
- The test script only printed `test`.

### Security
- Updated TypeORM to 0.3.31 (SQL injection advisory in 0.3.26) and the development dependency `sqlite3` to 6 (its `tar` dependency had a critical advisory). `npm audit --omit=dev` reports three moderate findings in `glob`/`minimatch`, pulled in by TypeORM 0.3 for file-pattern loading, which ReForgeDB does not use.
- `$deleteRecords` can no longer wipe the database by accident (see above).
- A `$searchDB` or `$deleteRecords` pattern such as `%a%a%a%a%b` became a regular expression on MongoDB that could run for minutes on the database server. MongoDB is now sent only the pattern's literal start, and `%`/`_` are matched by ReForgeDB in linear time. On every database runs of `%` are collapsed and patterns are limited to 1,000 characters.

### Performance
Measured against ForgeDB 2.1.1 with the same script on one machine.

| | ForgeDB 2.1.1 | ReForgeDB 3.0.0 |
|---|---|---|
| Writes per second, SQLite (`sqlite3`) | 463 | 4,550 |
| Writes per second, PostgreSQL 16 | 629 | 2,871 |
| Writes per second, MariaDB 10.11 | 762 | 2,567 |
| Reads per second, SQLite | 6,540 | 7,311 |
| `$userLeaderboard`, 2,000 users, SQLite | 8.9 ms | 3.7 ms (0.5 ms while reused) |
| `$deleteRecords`, 2,000 variables, SQLite | 3,144 ms | 7 ms |

- A write is one statement (was a read, then TypeORM's own read, then the write). The old value is only read when a `variableCreate` or `variableUpdate` listener exists.
- SQLite uses the write-ahead log with `synchronous = NORMAL` (`wal: false` turns it off).
- Reads, writes, cooldowns and leaderboard scans use statements prepared once per connection instead of TypeORM's query builder.
- New index on `(name, type, guildId)` for leaderboards and searches.
- A leaderboard reads two columns and is sorted once, then reused for 2 s or until a write by the same process (`leaderboardCacheTTL`): a command with a page, a position and a page count scans once instead of three times.
- `$deleteRecords` is one statement without delete listeners (was one search plus a read and a delete per row); `$delete...Var` is one statement (was two).
- Optional read cache (`cache`), for bots with one process.
- Memory stays bounded: a write only updates change counters of variables that have a leaderboard (bots build names from IDs, so counting every name ever written grew without end), and cached leaderboards hold at most a million entries in total.

### Added
- Options: `logLevel`, `slowQueryThreshold`, `cache`, `leaderboardCacheTTL`, `cooldownSweepInterval`, `readyTimeout`, `synchronize`, `wal`, `charset`, `typeorm`; database type `mariadb`. Options are validated at start-up.
- Logging with levels `silent`, `error`, `warn`, `info`, `debug` (every operation with its duration) and `trace` (every SQL statement); `REFORGEDB_LOG_LEVEL` environment variable; warnings for slow operations.
- Every function reports failures as a ForgeScript error (`[ReForgeDB] ...`) that `$try` can catch.
- `ReForgeDB.ready()`; `DataBase.ready()`, `search()`, `leaderboard()`, `deleteMany()`, `deleteMatching()`, `cdClaim()`, `sweepCooldowns()`, `ping()`, `close()`, `connected`, `kind`, `dataSource`.
- `VariableType` has `old`, so `$searchDB[;;old]` finds `$setVar` variables.
- `$env[row;...]` in leaderboard code also has `name`, `type`, `identifier` and `guildId`.
- `$deleteRoleVar[name;role ID;guild ID?]` and `$deleteMemberVar` work for roles and guilds that no longer exist.
- `DataBaseManager` internals are `#private`: an extension's subclass can define `connect()`, `open()` or `prepare()` without breaking it.
- Mentions are accepted wherever an ID is (`<@id>`, `<@!id>`, `<#id>`, `<@&id>`): they used to be stored under the mention text, a variable nobody could find again.
- An unknown channel ID is looked up on Discord once per 10 minutes instead of on every call, so cleaning up a deleted channel's variables does not cost one API request each.
- With `cache` on in a bot that runs in several processes (sharding), a warning explains why that cache can be stale.
- `client.db.clearCache()`, to see changes made outside ReForgeDB with the read cache on.
- `DataBaseManager` hooks for extensions: `previousDatabase` and `previousDatabaseAction` (use, copy, rename or ignore an SQLite file of an earlier name) and `beforeSynchronize(dataSource)`.
- A seeded fuzz test: random concurrent writes, reads, deletes, searches and leaderboards with 5% injected database failures, compared with an in-memory model after every step, with the cache on and off (`FUZZ_SEED` replays a run).
- Test suite (129 tests), run in CI on SQLite, better-sqlite3, PostgreSQL 16, MariaDB 10.11, MySQL 8.4 and MongoDB 7.

### Changed
- `$dbPing` has output type `Number`; `$searchDB` output type `Json`.
- The guild filter of `$searchDB`/`$deleteRecords` and the channel arguments are plain IDs.
- Leaderboard page counts only count ranked (numeric) entries.
- Requires Node.js 18.17 or newer.

### Notes
- First start on a ForgeDB database: duplicate MongoDB documents of one key are removed; an index is added to `record`; on MySQL and PostgreSQL the `startedAt` and `duration` columns of `cooldown` become `bigint` (TypeORM re-creates them; they could not hold a valid cooldown before). SQLite switches to write-ahead logging.
- The typedoc output (`docs/`) and the two guides about leaving ForgeDB 1.x are no longer in the repository; `npm run docs` builds the former.

## Earlier versions

ForgeDB's history up to 2.1.1 is in [its repository](https://github.com/tryforge/ForgeDB).
