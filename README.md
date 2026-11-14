<div align="center">

# ReForgeDB
ReForgeDB is a reworked, hardened and faster database extension for ForgeScript: variables, leaderboards and cooldowns stored in SQLite, MySQL/MariaDB, PostgreSQL or MongoDB.

<a href="https://github.com/Demonic1594/ReForgeDB/"><img src="https://img.shields.io/github/package-json/v/Demonic1594/ReForgeDB/main?label=@tryforge/reforge.db&color=5c16d4" alt="@tryforge/reforge.db"></a>
<a href="https://github.com/tryforge/ForgeScript/"><img src="https://img.shields.io/github/package-json/v/tryforge/ForgeScript/main?label=@tryforge/forgescript&color=5c16d4" alt="@tryforge/forgescript"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-5c16d4" alt="License: GPL-3.0"></a>

</div>

---

## Contents

1. [Why ReForgeDB](#why-reforgedb)
2. [Installation](#installation)
3. [Options](#options)
4. [Functions](#functions)
5. [Cooldowns](#cooldowns)
6. [Default Values](#default-values)
7. [Events](#events)
8. [Errors, Logging and Debugging](#errors-logging-and-debugging)
9. [Performance](#performance)
10. [Switching from ForgeDB](#switching-from-forgedb)
11. [Other Extensions](#other-extensions)
12. [Notes and Limits](#notes-and-limits)
13. [Development](#development)
14. [Credits and License](#credits-and-license)

<h3 align="center">Why ReForgeDB</h3><hr>

- 🗄️ **Your database keeps working.** Same tables, same keys, same file (`database/forge.db`). ReForgeDB opens a ForgeDB database as it is; a test upgrades one on every supported database.
- ⏱️ **Cooldowns that work.** In ForgeDB, 11 of the 15 cooldown functions never loaded, and on MySQL and PostgreSQL no cooldown could be stored at all. ReForgeDB's survive restarts, take any duration, and cannot be claimed twice by spamming.
- 🛡️ **Survives a database that is down.** It reconnects by itself, and functions answer with an error your code can catch instead of crashing the bot.
- ⚡ **Faster.** Writes are 3 to 10 times faster, a leaderboard command scans its variable once instead of once per function, and deleting thousands of variables is one statement.
- 🔎 **Tells you what is wrong.** Clear errors that `$try` can catch, five log levels up to every SQL statement, and warnings for slow operations.
- 🧪 **Tested.** 96 tests on SQLite, better-sqlite3, PostgreSQL and MariaDB, on ForgeScript 2.5 and 2.8.

<details>
<summary><b>Everything fixed compared to ForgeDB 2.1.1</b></summary>

- `$userCooldown`, `$memberCooldown`, `$guildCooldown`, `$channelCooldown` and their `delete`/`get` functions never loaded: ForgeScript has built-in functions with these names and refuses to replace them. Code written from ForgeDB's documentation silently ran ForgeScript's in-memory cooldowns, with the arguments in another order.
- Every cooldown write failed on MySQL and PostgreSQL (`value out of range for type integer`): the time was stored in 32-bit columns.
- Two commands at once could both pass the same cooldown.
- An empty ID field (`$getUserVar[coins;;0]`, `$setUserVar[coins;5;]`) read and wrote a variable with an empty ID instead of the current user's.
- `$searchDB[;;user]` and `$deleteRecords[;;user]` ignored the `user` filter; `$deleteRecords[]` (or with an unset `$get`) deleted every variable.
- `$getChannelLeaderboardValue[name;sort;channel]` always returned `0`; `$getChannelLeaderboardID` could only look at the current server.
- A value that is not a number broke the order of a leaderboard and could rank first; members with equal values could swap places between two functions.
- `$getUserLeaderboardLength[name;0]` returned `Infinity`; a negative page gave rows from the end.
- Writing the same new variable from two commands at once failed with a `UNIQUE constraint` / `duplicate key` error.
- A database that was unreachable at start-up ended the bot (unhandled rejection); functions used before the connection crashed with `Cannot read properties of undefined`.
- Errors inside functions stopped the command silently and could not be caught with `$try`: a channel or role that no longer exists, `$getMemberVar` in a DM, `$getRoleVar` without a role, `$data` outside an event, `$getVar` with a numeric default.
- Events were emitted before the write, and `variableDelete` fired for variables that did not exist.
- `$dbPing` failed on MongoDB, where every read was also a full collection scan.
- A MariaDB server used with `type: "mysql"` had its tables altered on every start.
- `npm ci` failed (lock file out of date), `npm run commit` could run shell commands from the commit message, the README named the wrong PostgreSQL package, and dependencies had known vulnerabilities.

The full list, with what changed for your code, is in the [changelog](CHANGELOG.md).

</details>

<h3 align="center">Installation</h3><hr>

1. Install ReForgeDB and the driver of your database:

    | Database | `type` | Install |
    |---|---|---|
    | SQLite (default) | `sqlite` | `npm i github:Demonic1594/ReForgeDB sqlite3` |
    | SQLite, faster driver | `better-sqlite3` | `npm i github:Demonic1594/ReForgeDB better-sqlite3` |
    | PostgreSQL | `postgres` | `npm i github:Demonic1594/ReForgeDB pg` |
    | MySQL | `mysql` | `npm i github:Demonic1594/ReForgeDB mysql2` |
    | MariaDB | `mariadb` | `npm i github:Demonic1594/ReForgeDB mysql2` |
    | MongoDB | `mongodb` | `npm i github:Demonic1594/ReForgeDB mongodb` |

    > ℹ️ **Note**\
    > The compiled code is committed, so no build step is needed. The command follows `main`; to pin a release, add its tag, e.g. `npm i github:Demonic1594/ReForgeDB#v3.0.0`.

2. Add it to your client:
    ```js
    const { ForgeClient } = require("@tryforge/forgescript")
    const { ReForgeDB } = require("@tryforge/reforge.db")

    const client = new ForgeClient({
        ...options, // The options you currently have
        extensions: [
            new ReForgeDB() // SQLite in database/forge.db
        ]
    })
    ```

3. For another database, pass its connection:
    ```js
    new ReForgeDB({ type: "better-sqlite3", folder: "database" })
    new ReForgeDB({ type: "postgres", host: "localhost", port: 5432, username: "bot", password: "...", database: "bot" })
    new ReForgeDB({ type: "postgres", url: "postgres://bot:...@localhost:5432/bot" })
    new ReForgeDB({ type: "mariadb", host: "localhost", username: "bot", password: "...", database: "bot" })
    new ReForgeDB({ type: "mongodb", url: "mongodb://localhost:27017/bot" })
    ```

Requires Node.js 18.17 or newer (20.17 for `sqlite3` 6, 22 for ForgeScript 2.8) and ForgeScript 2.5 or newer. On Android (Termux), see the [Android guide](guides/android-installation.md).

<h3 align="center">Options</h3><hr>

| Option | Default | What it does |
|---|---|---|
| `type` | `sqlite` | `sqlite`, `better-sqlite3`, `mysql`, `mariadb`, `postgres` or `mongodb` |
| `url`, `host`, `port`, `username`, `password`, `database` | | Connection of a database server |
| `folder` | `database` | SQLite: folder of the database file `forge.db` |
| `wal` | `true` | SQLite: use the write-ahead log (much faster writes; adds `forge.db-wal` and `forge.db-shm` next to the file) |
| `charset` | `utf8mb4_general_ci` | MySQL/MariaDB: connection charset (the default stores emojis) |
| `events` | `[]` | Database events to listen to |
| `logLevel` | `info` | `silent`, `error`, `warn`, `info`, `debug` or `trace`; also the `REFORGEDB_LOG_LEVEL` environment variable |
| `slowQueryThreshold` | `1000` | Log a warning for operations slower than this many ms; `0` disables it |
| `cache` | off | Keep recently used variables in memory: `true`, or `{ max: 10000, ttl: 0 }`. Only for a single bot process, see [Performance](#performance) |
| `leaderboardCacheTTL` | `2000` | Reuse a sorted leaderboard for this many ms; `0` disables it |
| `cooldownSweepInterval` | `3600000` | Delete expired cooldowns this often (ms); `0` disables it |
| `readyTimeout` | `30000` | How long (ms) a function waits for the database to connect before it fails |
| `synchronize` | `true` | Let ReForgeDB create and update its tables |
| `typeorm` | | Extra [TypeORM](https://typeorm.io/docs/data-source/data-source-options) options, e.g. `{ ssl: { rejectUnauthorized: false } }` |

Invalid options stop the bot at start-up with a message that names the option.

<h3 align="center">Functions</h3><hr>

Every function, with its arguments and aliases, is described in [`metadata/functions.json`](metadata/functions.json). An optional ID that is left out or left empty means "the one of the command" (`$getUserVar[coins;;0]` reads the current user's coins, with `0` as default).

**Variables**

| Scope | Functions |
|---|---|
| User | `$setUserVar[name;value;user ID?]` `$getUserVar[name;user ID?;default?]` `$deleteUserVar[name;user ID?]` |
| Member (per server) | `$setMemberVar[name;value;member ID?;guild ID?]` `$getMemberVar[name;member ID?;guild ID?;default?]` `$deleteMemberVar[name;member ID?;guild ID?]` |
| Server | `$setGuildVar[name;value;guild ID?]` `$getGuildVar[name;guild ID?;default?]` `$deleteGuildVar[name;guild ID?]` (also `$setServerVar`, ...) |
| Channel | `$setChannelVar[name;value;channel ID?]` `$getChannelVar[name;channel ID?;default?]` `$deleteChannelVar[name;channel ID?]` |
| Role | `$setRoleVar[name;value;role ID]` `$getRoleVar[name;role ID;default?]` `$deleteRoleVar[name;role ID;guild ID?]` |
| Message | `$setMessageVar[name;value;message ID?]` `$getMessageVar[name;message ID?;default?]` `$deleteMessageVar[name;message ID?]` |
| Global | `$setGlobalVar[name;value]` `$getGlobalVar[name;default?]` `$deleteGlobalVar[name]` |
| Any ID (legacy) | `$setVar[name;id;value]` `$getVar[name;id;default?]` `$deleteVar[name;id]` |

Values are stored as text. Store objects as JSON and read them back with `$jsonLoad`.

**Leaderboards** (users, members, servers and channels; shown for users)

| Function | Returns |
|---|---|
| `$userLeaderboard[name;sort?;max?;page?;separator?;envValue?;envPosition?;code?]` | The page as text: `1. alice ~ 30`, or your `code` per row |
| `$getUserLeaderboardID[name;sort?;position]` | The ID at a position |
| `$getUserLeaderboardValue[name;sort?;user ID?]` | The position of a user, `0` when not ranked (alias `$getUserLeaderboardPosition`) |
| `$getUserLeaderboardLength[name;per page?;decimals?]` | The number of pages (of ranked users without `per page`) |

```
$userLeaderboard[coins;desc;10;1;
;row;place;$return[**#$env[place]** $env[row;username]: $env[row;value] coins]]
Page 1 of $getUserLeaderboardLength[coins;10] · You are #$getUserLeaderboardValue[coins]
```

Only values that are numbers are ranked. Equal values are ordered by ID, the same way in every function. `sort` is `desc` (highest first, the default) or `asc`. In `code`, `$env[row;...]` has `id`, `value`, `name`, `type`, `guildId` and the display name (`username`, `guild_name` or `channel_name`); `$continue` skips a row and `$break` ends the list.

**Database**

| Function | What it does |
|---|---|
| `$searchDB[name?;id?;type?;value?;guild ID?]` | The matching variables as JSON. `name` and `value` accept `%` (any text) and `_` (one character) |
| `$deleteRecords[name?;id?;type?;value?;guild ID?]` | Deletes the matching variables. At least one filter is required |
| `$getDB` | Every variable as JSON |
| `$wipeDB` | Deletes every variable and cooldown |
| `$dbPing[full?]` | Round trip to the database in ms |

<h3 align="center">Cooldowns</h3><hr>

ReForgeDB's cooldowns are stored in the database: they survive restarts and can last a year. They are named, so one cooldown can be shared by several commands.

```
$dbUserCooldown[daily;24h;You already claimed today. Try again in $round[$math[$env[time]/3600000]] hours.]
$setUserVar[coins;$math[$getUserVar[coins;;0]+100]]
You got 100 coins!
```

The first call starts the cooldown and the command goes on. While it is running, the function sends the `code`, with the milliseconds left in `$env[time]`, and stops the command. When several commands claim the same cooldown at once, exactly one gets through.

| Scope | Start | Time left (ms) | End |
|---|---|---|---|
| User | `$dbUserCooldown[name;duration;code?;user ID?]` | `$dbGetUserCooldownTime[name;user ID?]` | `$dbDeleteUserCooldown[name;user ID?]` |
| Member | `$dbMemberCooldown[name;duration;code?;member ID?;guild ID?]` | `$dbGetMemberCooldownTime[name;member ID?;guild ID?]` | `$dbDeleteMemberCooldown[name;member ID?;guild ID?]` |
| Server | `$dbGuildCooldown[name;duration;code?;guild ID?]` | `$dbGetGuildCooldownTime[name;guild ID?]` | `$dbDeleteGuildCooldown[name;guild ID?]` |
| Channel | `$dbChannelCooldown[name;duration;code?;channel ID?]` | `$dbGetChannelCooldownTime[name;channel ID?]` | `$dbDeleteChannelCooldown[name;channel ID?]` |
| Global | `$globalCooldown[name;duration;code?]` | `$getGlobalCooldownTime[name]` | `$deleteGlobalCooldown[name]` |

> ⚠️ **Warning**\
> `$userCooldown`, `$memberCooldown`, `$guildCooldown` and `$channelCooldown` (without `db`) are ForgeScript's own functions: kept in memory, lost on restart, separate for each command, and with other arguments (`$userCooldown[user ID;duration;code]`). ForgeDB documented functions with the same names, but they never loaded. Put `db` in front to get the stored ones: `$userCooldown[` → `$dbUserCooldown[`, `$getUserCooldownTime[` → `$dbGetUserCooldownTime[`, `$deleteUserCooldown[` → `$dbDeleteUserCooldown[`.

<h3 align="center">Default Values</h3><hr>

Declare what a variable is when it was never set:

```js
ReForgeDB.variables({
    coins: 0,
    language: "en",
    bio: "$username has not written a bio yet", // strings are ForgeScript code
    settings: { theme: "dark" }
})
```

`$getUserVar[coins]` then returns `0` for a new user. A default given in the function (`$getUserVar[coins;;100]`) comes first. Defaults apply to every variable type with that name.

<h3 align="center">Events</h3><hr>

| Event | When | Data |
|---|---|---|
| `connect` | The database is connected | |
| `variableCreate` | A variable was set for the first time | `$data[...]` |
| `variableUpdate` | An existing variable was set again | `$oldData[...]`, `$newData[...]` |
| `variableDelete` | An existing variable was deleted | `$data[...]` |

```js
const db = new ReForgeDB({ events: ["variableUpdate"] })

const client = new ForgeClient({
    ...options,
    extensions: [db]
})

db.commands.add({
    type: "variableUpdate",
    code: `$log[$newData[name] of $newData[id]: $oldData[value] -> $newData[value]]`
})
```

The properties are `identifier`, `name`, `id`, `type`, `value` and `guildId`. Events are emitted after the write succeeded. `$wipeDB` emits no events.

> ℹ️ **Note**\
> Listening to `variableCreate` or `variableUpdate` costs one extra read per write, and `variableDelete` one per delete, to know the old value. Without listeners no extra read is made.

<h3 align="center">Errors, Logging and Debugging</h3><hr>

When something goes wrong, the function returns a ForgeScript error that names the problem. The bot shows it like any other function error, and `$try` can catch it:

```
$try[
    $setUserVar[coins;100]
;
    Could not save: $env[error;message]
;error]
```

Typical messages: `[ReForgeDB] The database is not connected yet (waited 30000 ms). Last error: connect ECONNREFUSED 127.0.0.1:5432`, `[ReForgeDB] No guild ID was given, and this command has no guild ID to use instead`, `[ReForgeDB] $deleteRecords needs at least one filter; use $wipeDB to delete everything`.

`logLevel` (or the `REFORGEDB_LOG_LEVEL` environment variable) sets what is written to the console:

| Level | Shows |
|---|---|
| `silent` | Nothing |
| `error` | Failed operations and connection errors |
| `warn` | Also slow operations and configuration problems |
| `info` (default) | Also connection messages |
| `debug` | Also every operation with its duration: `[ReForgeDB] set user_coins_123 (0.21 ms)` |
| `trace` | Also every SQL statement |

Turn on `debug` without touching the code: `REFORGEDB_LOG_LEVEL=debug node index.js`.

If the database is unreachable when the bot starts, ReForgeDB retries after 1 s, 2 s, 4 s, up to every 60 s, and logs each attempt. Functions wait up to `readyTimeout` for the connection. `ReForgeDB.ready()` returns a promise for code that needs the database at start-up.

<h3 align="center">Performance</h3><hr>

Measured on one machine against ForgeDB 2.1.1 with the same script (2,000 rows on SQLite, 1,000 on the servers); your numbers will differ, the ratios are the point.

| | ForgeDB 2.1.1 | ReForgeDB |
|---|---|---|
| Writes per second, SQLite (`sqlite3`) | 463 | 4,550 |
| Writes per second, PostgreSQL | 629 | 2,871 |
| Writes per second, MariaDB | 762 | 2,567 |
| Reads per second, SQLite | 6,540 | 7,311 |
| Leaderboard page of 2,000 users, SQLite | 8.9 ms | 3.7 ms, then 0.5 ms while reused |
| `$deleteRecords` of 2,000 variables, SQLite | 3,144 ms | 7 ms |
| 50 writes at once to a new variable | 49 fail | all succeed |

Where it comes from: a write is one statement instead of three, SQLite uses its write-ahead log, leaderboards read two columns through an index and are sorted once per command, and bulk deletes are one statement.

**The read cache** (`cache: true`) keeps the most recently used variables in memory, so reading one again costs no query. That matters most with a database on another machine, where each query is a network round trip. It is off by default because it is only correct when **one** bot process uses the database: a write made by another process (another shard process, a dashboard, a script) is not seen until the copy expires (`ttl`) or is evicted. Writes made through ReForgeDB itself, including raw `client.db.query()` calls, always update or clear it.

Leaderboards are reused for `leaderboardCacheTTL` (2 s). Writes by the same process refresh them immediately; with several processes a leaderboard can be up to 2 s behind.

<h3 align="center">Switching from ForgeDB</h3><hr>

Your data stays where it is. ReForgeDB uses the same tables, keys and SQLite file.

1. Back up your database (copy `database/forge.db`, or dump the server database).
2. Replace the package:
    ```bash
    npm uninstall @tryforge/forge.db
    npm i github:Demonic1594/ReForgeDB
    ```
3. In your code, replace the import and the class:
    ```js
    const { ReForgeDB } = require("@tryforge/reforge.db") // was: { ForgeDB } = require("@tryforge/forge.db")
    new ReForgeDB({ ... })                                 // was: new ForgeDB({ ... })
    ReForgeDB.variables({ ... })                           // was: ForgeDB.variables({ ... })
    ```
4. Rename the cooldown functions as shown under [Cooldowns](#cooldowns), if you want stored cooldowns.
5. Start the bot. On first start ReForgeDB adds an index to the variables table, and on MySQL and PostgreSQL widens the two time columns of the cooldown table (which could not hold a cooldown before, so nothing is lost). SQLite gains two files, `forge.db-wal` and `forge.db-shm`: keep them with `forge.db` when you copy the database while the bot runs.

What behaves differently:

- The extension registers as `reforge.db` and its event handler as `ReForgeDBEvents`.
- An empty ID field means the ID of the command. Variables that ForgeDB wrote under an empty ID by mistake can be listed with `$searchDB[name;;user]` and removed with `$deleteRecords`.
- `$deleteRecords` needs at least one filter.
- Leaderboards leave out values that are not numbers, and the page-count functions count ranked entries only.
- Errors that used to stop a command silently are now shown (and catchable). Add `$try` where a failure is expected.
- Channel functions take the channel as an ID, so they work for deleted channels; `$deleteRoleVar` takes the role as an ID and has an optional guild.
- `$dbPing` returns a number.
- `variableDelete` no longer fires for a variable that did not exist.

Coming from ForgeDB 1.x (quick.db)? Move to ForgeDB 2 first with [its guide](https://github.com/tryforge/ForgeDB/blob/main/guides/how-to-update.md), then switch.

<h3 align="center">Other Extensions</h3><hr>

> ⚠️ **Warning**\
> Extensions written for ForgeDB look for an extension named `forge.db` and import `@tryforge/forge.db`. **ForgeGiveaways and ReForgeGiveaways up to 2.2.1 therefore do not load with ReForgeDB yet.** A bot that uses them should stay on ForgeDB until they support ReForgeDB.

An extension stores its own tables through ReForgeDB's connection settings by extending `DataBaseManager`, exactly as with ForgeDB:

```js
const { DataBaseManager } = require("@tryforge/reforge.db")

class TicketsDatabase extends DataBaseManager {
    database = "tickets.db" // the SQLite file; on servers, tables live in the configured database
    entityManager = { sqlite: [Ticket], mysql: [Ticket], postgres: [Ticket], mongodb: [MongoTicket] }
    connect() { return this.getDB() } // a TypeORM DataSource
}
```

and declares the dependency with `requireExtensions = ["reforge.db"]`. `getDB()` waits for ReForgeDB's configuration, shares one connection per `database` name, and can be called again after a failure to retry.

`client.db` is the `DataBase` class (`get`, `set`, `delete`, `getAll`, `find`, `search`, `leaderboard`, `cdAdd`, `cdTimeLeft`, ...), so code that reads through it, such as QuorielDB's `transferDatabase(client)`, works unchanged.

<h3 align="center">Notes and Limits</h3><hr>

- Tested on SQLite (`sqlite3` and `better-sqlite3`), PostgreSQL 16 and MariaDB 10.11. **MongoDB has not been tested against a live server** in this release: its code paths are separate and were reviewed, not run.
- A cooldown cannot be claimed twice within one bot process. Two processes sharing a database could each let one claim through at the same instant.
- Leaderboards are sorted in memory: fine for tens of thousands of entries per variable, not meant for millions.
- On MySQL and MariaDB, a variable name, an ID and the key built from them are limited to 255 characters; longer ones are refused with a clear error.
- Values are text. Numbers are compared as numbers on leaderboards only.

<h3 align="center">Development</h3><hr>

```bash
npm install
npm run build      # compile TypeScript to dist/
npm test           # build, then run all tests (SQLite)
npm run docgen     # regenerate metadata/*.json
npm run docs       # typedoc into docs/ (not committed)
```

The tests boot a real ForgeScript client (never logged in) and run ForgeScript code through the real interpreter. To run them on another database, point them at one made for the tests (it is wiped):

```bash
npm i --no-save pg
export REFORGEDB_TEST_DB='{"type":"postgres","host":"127.0.0.1","username":"postgres","database":"reforgedb_test"}'
npm test
```

`dist/` and `metadata/` are committed, because the package installs straight from GitHub; CI fails when they are out of date.

> ⚠️ **Warning**\
> Never change the type or length of an existing column in `src/util/types.ts`. TypeORM synchronizes the schema, and on PostgreSQL and MySQL it changes a column by dropping and re-creating it, which deletes its data. Adding indexes and nullable columns is safe.

<h3 align="center">Credits and License</h3><hr>

ReForgeDB is a modified fork of [ForgeDB](https://github.com/tryforge/ForgeDB) by aggelos and its contributors (Aditya, Aurea, Aayush, Koomball, xNickyDev), forked at version 2.1.1 (commit `0f9c251`). Modifications were made in November 2026 and are listed in the [changelog](CHANGELOG.md). Some ideas (reading the old value only when an event needs it, ranking numbers only) come from comparing with [QuorielDB](https://github.com/quoriel/db).

Licensed under the [GNU GPL v3](LICENSE), like the original.
