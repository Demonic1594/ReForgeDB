"use strict"
/*
 * SQLite: switching an existing database between the two drivers, sqlite3
 * (type "sqlite") and better-sqlite3. Same file format, so a bot can change
 * `type` and keep its data; these tests check that it really does, in normal
 * use and under abuse: both directions, back and forth, both drivers at once
 * on one file, after a crash, with a file that is not a database, a missing
 * driver, a file locked by another program, and values that look like SQL.
 *
 * Every step runs in its own process (ReForgeDB's configuration is per
 * process), through test/fixtures/driver.js. Runs on SQLite only.
 */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")
const { kind, tmpDir, ids } = require("./fixtures/harness")

const FIXTURE = path.join(__dirname, "fixtures", "driver.js")
const HIDE = path.join(__dirname, "fixtures", "hide-module.js")
const DRIVERS = ["sqlite", "better-sqlite3"]
const other = (type) => (type === "sqlite" ? "better-sqlite3" : "sqlite")
const DRIVER_CLASS = { sqlite: "SqliteDriver", "better-sqlite3": "BetterSqlite3Driver" }

/** Runs one step in a new process with the given driver. Resolves with its JSON result. */
function step(type, dir, body, options = {}, { hide } = {}) {
    const env = { ...process.env }
    delete env.REFORGEDB_TEST_DB // the driver is chosen here, not by the CI job
    const args = [FIXTURE, type, dir, JSON.stringify(options), body]
    if (hide) {
        env.HIDE_MODULE = hide
        args.unshift("-r", HIDE)
    }
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] })
        let out = ""
        let err = ""
        child.stdout.on("data", (d) => (out += d))
        child.stderr.on("data", (d) => (err += d))
        child.on("error", reject)
        child.on("close", (code, signal) => {
            const last = out.trim().split("\n").pop()
            if (signal === "SIGKILL") return resolve({ crashed: true })
            try {
                resolve(JSON.parse(last))
            } catch {
                reject(new Error(`step did not finish (${code ?? signal}): ${out.slice(-500)} ${err.slice(-1500)}`))
            }
        })
    })
}

/** Like step(), and fails the test when the step itself failed. */
async function ok(type, dir, body, options, extra) {
    const result = await step(type, dir, body, options, extra)
    assert.equal(result.ok, true, `${type}: ${result.error} ${JSON.stringify(result.logs)}`)
    assert.equal(result.driver, DRIVER_CLASS[type], "the step ran on the driver it asked for")
    return result.out
}

/** Everything a bot can see: every row, a leaderboard, and whether its cooldowns are running. */
const SNAPSHOT = `
    const all = (await h.DataBase.getAll()).map((r) => [r.identifier, r.value]).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    const board = await h.run("$userLeaderboard[lb;desc;40;1]")
    const userCd = await h.exec("$dbUserCooldown[daily;1h;running $env[time]]")
    const globalCd = await h.exec("$globalCooldown[event;1h;running $env[time]]")
    return { all, board, userCd: userCd.output === null && /^running \\d+$/.test(userCd.sent[0]), globalCd: globalCd.output === null && /^running \\d+$/.test(globalCd.sent[0]) }
`

const INTEGRITY = `return (await h.DataBase.query("PRAGMA integrity_check"))[0].integrity_check`

/** Writes variables of every scope, odd values, a leaderboard and two running cooldowns. */
const SEED = `
    await h.run("$setUserVar[coins;150]$setMemberVar[xp;20]$setGuildVar[prefix;!]$setChannelVar[topic;hello]")
    await h.run("$setRoleVar[perk;yes;${ids.role}]$setMessageVar[votes;3]$setGlobalVar[motd;héllo 🌍 \\"quoted\\"]")
    const odd = {
        long: "x".repeat(100_000),
        lines: "line 1\\nline 2\\r\\nline 3",
        spaces: "  padded  ",
        json: JSON.stringify({ a: [1, 2, { b: "c" }], d: null }),
        sql: "'); DROP TABLE record; --",
        sql2: '" OR 1=1 --',
        empty: "",
    }
    for (const [name, value] of Object.entries(odd)) await h.DataBase.set({ name, id: "odd", type: "custom", value })
    await h.DataBase.set({ name: "'); DROP TABLE cooldown; --", id: "x\\" OR \\"1\\"=\\"1", type: "custom", value: "kept" })
    for (let i = 0; i < 30; i++) await h.DataBase.set({ name: "lb", id: String(300000000000000100n + BigInt(i)), type: "user", value: i % 7 === 0 ? "not a number" : String((i * 37) % 101) })
    await h.run("$dbUserCooldown[daily;1h]$globalCooldown[event;1h]")
`

if (kind === "sqlite") {
    for (const first of DRIVERS) {
        test(`a database written with ${first} reads the same with ${other(first)}, and back`, async () => {
            const dir = tmpDir()
            await ok(first, dir, SEED)
            const seeded = await ok(first, dir, SNAPSHOT)
            assert.equal(seeded.userCd, true)
            assert.equal(seeded.globalCd, true)
            assert.ok(seeded.all.some(([id, v]) => id.includes("DROP TABLE cooldown") && v === "kept"))

            const switched = await ok(other(first), dir, SNAPSHOT)
            assert.deepEqual(switched, seeded, "every row, the leaderboard and the running cooldowns are the same")

            // Changes made by the second driver are seen by the first.
            await ok(other(first), dir, `await h.run("$setUserVar[coins;999]$deleteGuildVar[prefix]$dbDeleteUserCooldown[daily]")`)
            const back = await ok(first, dir, SNAPSHOT + "")
            const coins = back.all.find(([id]) => id.startsWith("user_coins_"))
            assert.equal(coins[1], "999")
            assert.ok(!back.all.some(([id]) => id.startsWith("guild_prefix_")))
            // The snapshot's own claim started the deleted cooldown again: free, so it was claimed.
            assert.equal(back.userCd, false)
            assert.equal(back.globalCd, true)
            assert.equal(await ok(first, dir, INTEGRITY), "ok")
        })

        test(`opening a ${first} database with ${other(first)} changes nothing in the schema`, async () => {
            const dir = tmpDir()
            await ok(first, dir, `await h.run("$setUserVar[a;1]")`)
            const pending = await ok(other(first), dir, `return (await h.DataBase.dataSource.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query)`, { synchronize: false })
            assert.deepEqual(pending, [])
        })

        test(`a crash with ${first} loses nothing ${other(first)} cannot read`, async () => {
            const dir = tmpDir()
            const crashed = await step(first, dir, `for (let i = 0; i < 50; i++) await h.run("$setGlobalVar[k" + i + ";v" + i + "]"); crash()`)
            assert.equal(crashed.crashed, true)
            assert.ok(fs.existsSync(path.join(dir, "reforge.db-wal")), "the crash left the write-ahead log behind")
            const rows = await ok(other(first), dir, `return (await h.DataBase.find({ type: "custom" })).map((r) => r.name + "=" + r.value).sort()`)
            assert.deepEqual(rows, Array.from({ length: 50 }, (_, i) => `k${i}=v${i}`).sort())
            assert.equal(await ok(other(first), dir, INTEGRITY), "ok")
        })

        test(`${first}: a file that is not a database is reported and never overwritten`, async () => {
            const dir = tmpDir()
            const file = path.join(dir, "reforge.db")
            const notes = Buffer.from("these are my notes, not a database\n".repeat(300))
            fs.writeFileSync(file, notes)
            const result = await step(first, dir, `return (await h.exec("$try[$setUserVar[a;1]written;failed: $env[error;message];error]")).output`, { wait: false, readyTimeout: 2000 })
            assert.equal(result.ok, true, result.error)
            assert.match(result.out, /^failed: .*\[ReForgeDB\].*file is not a database/)
            assert.deepEqual(fs.readFileSync(file), notes, "the file is exactly as it was")
        })

        test(`${first}: a missing driver package is named, and no database file is created`, async () => {
            const dir = tmpDir()
            const pkg = first === "sqlite" ? "sqlite3" : "better-sqlite3"
            const result = await step(first, dir, `return (await h.exec("$try[$setUserVar[a;1]written;failed: $env[error;message];error]")).output`, { wait: false, readyTimeout: 2000 }, { hide: pkg })
            assert.equal(result.ok, true, result.error)
            assert.match(result.out, new RegExp(`^failed: .*\\[ReForgeDB\\].*npm install ${pkg}`))
            assert.deepEqual(fs.readdirSync(dir), [], "no empty database file was left behind")
        })

        test(`${first}: a file locked by another program fails catchably, then works again`, async () => {
            const dir = tmpDir()
            await ok(first, dir, `await h.run("$setUserVar[a;1]")`)
            // Another program holds the write lock for 12 s, longer than the 5 s
            // busy timeout, then lets go. It must be another process: two copies of
            // SQLite in one process (sqlite3 and better-sqlite3 each bring their own)
            // do not see each other's locks.
            const holder = spawn(process.execPath, [path.join(__dirname, "fixtures", "hold-lock.js"), path.join(dir, "reforge.db"), "12000"], { stdio: ["ignore", "pipe", "inherit"] })
            await new Promise((resolve) => holder.stdout.once("data", resolve))
            const released = new Promise((resolve) => holder.once("exit", resolve))
            const out = await ok(first, dir, `
                const write = (v) => h.exec("$try[$setUserVar[a;" + v + "]written;failed: $env[error;message];error]")
                const started = Date.now()
                const blocked = (await write(2)).output
                const waited = Date.now() - started
                let after = null
                while (Date.now() - started < 30_000 && after !== "written") {
                    await new Promise((r) => setTimeout(r, 500))
                    after = (await write(3)).output
                }
                return { blocked, waited, after, value: await h.run("$getUserVar[a]") }
            `)
            await released
            assert.match(out.blocked, /^failed: .*\[ReForgeDB\].*(locked|busy)/i)
            assert.ok(out.waited >= 4000, `waited for the lock (${out.waited} ms) instead of failing at once`)
            assert.equal(out.after, "written", "writes work again once the lock is released")
            assert.equal(out.value, "3")
        })
    }

    test("switching the driver back and forth 8 times, with the write-ahead log off and on, keeps every write", async () => {
        const dir = tmpDir()
        const journal = []
        for (let i = 0; i < 8; i++) {
            const type = DRIVERS[i % 2]
            const wal = i % 4 < 2
            const out = await ok(
                type,
                dir,
                `
                await h.run("$setGlobalVar[n;$math[$getGlobalVar[n;0]+1]]$setGlobalVar[by${i};${type}]")
                return { n: await h.run("$getGlobalVar[n]"), mode: (await h.DataBase.query("PRAGMA journal_mode"))[0].journal_mode }
            `,
                { wal }
            )
            assert.equal(out.n, String(i + 1), `write ${i + 1} (${type}) saw every earlier one`)
            journal.push(out.mode)
            if (!wal) assert.ok(!fs.existsSync(path.join(dir, "reforge.db-wal")), "no write-ahead log left without wal")
        }
        assert.deepEqual(journal, ["wal", "wal", "delete", "delete", "wal", "wal", "delete", "delete"])
        const rows = await ok("sqlite", dir, `return (await h.DataBase.find({ type: "custom" })).map((r) => r.name + "=" + r.value).sort()`)
        assert.deepEqual(rows, ["n=8", ...Array.from({ length: 8 }, (_, i) => `by${i}=${DRIVERS[i % 2]}`)].sort())
    })

    test("both drivers on one file at once: every write lands, every cooldown is claimed once", async () => {
        const dir = tmpDir()
        await ok("sqlite", dir, `await h.run("$setGlobalVar[ready;1]")`)
        const startAt = Date.now() + 6000
        const workers = [0, 1, 2, 3].map((w) =>
            ok(
                DRIVERS[w % 2],
                dir,
                `
                while (Date.now() < ${startAt}) await new Promise((r) => setTimeout(r, 5))
                const writes = Array.from({ length: 150 }, (_, i) => h.DataBase.set({ name: "w${w}_" + i, id: "x", type: "custom", value: String(i) }))
                const claims = Array.from({ length: 20 }, (_, c) => h.DataBase.cdClaim({ name: "race" + c, duration: 3_600_000 }).then((left) => left === 0))
                await Promise.all(writes)
                return (await Promise.all(claims)).map((won, c) => (won ? c : -1)).filter((c) => c >= 0)
            `
            )
        )
        const won = await Promise.all(workers)
        const claimed = won.flat().sort((a, b) => a - b)
        assert.deepEqual(claimed, Array.from({ length: 20 }, (_, c) => c), `each cooldown claimed exactly once, by any process (${JSON.stringify(won)})`)
        const count = await ok("better-sqlite3", dir, `return (await h.DataBase.find({ type: "custom" })).length`)
        assert.equal(count, 4 * 150 + 1)
        assert.equal(await ok("sqlite", dir, INTEGRITY), "ok")
    })
}
