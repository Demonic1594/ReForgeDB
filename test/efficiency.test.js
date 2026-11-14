"use strict"
// How many statements operations cost, and behaviour under concurrency.
// Runs without events and without the read cache (the defaults).
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, ids, snowflake, queryCounter, kind } = require("./fixtures/harness")

let h, run, exec, DB
const counter = queryCounter()
before(async () => {
    h = await boot({ logLevel: "warn", counter, cooldownSweepInterval: 0 })
    ;({ run, exec, DataBase: DB } = h)
})
after(async () => {
    await DB.close()
})

const user = (name, id = ids.user) => ({ name, id, type: "user" })

test("a write is one statement, a read is one statement", async () => {
    // ForgeDB: set = SELECT + save (SELECT + INSERT/UPDATE) = 3; delete = SELECT + DELETE = 2.
    assert.equal((await counter.during(() => DB.set({ ...user("a"), value: "1" }))).count, 1, "set (new)")
    assert.equal((await counter.during(() => DB.set({ ...user("a"), value: "2" }))).count, 1, "set (existing)")
    assert.equal((await counter.during(() => DB.get(user("a")))).count, 1, "get")
    assert.equal((await counter.during(() => DB.get(user("missing")))).count, 1, "get (missing)")
    assert.equal((await counter.during(() => DB.delete(user("a")))).count, 1, "delete")
    assert.equal((await counter.during(() => run("$setUserVar[b;1]"))).count, 1, "$setUserVar")
    assert.equal((await counter.during(() => run("$getUserVar[b]"))).count, 1, "$getUserVar")
    assert.equal((await counter.during(() => run("$deleteUserVar[b]"))).count, 1, "$deleteUserVar")
})

test("a cooldown claim is one statement, whether it starts the cooldown or finds it running", async () => {
    // Read-first (3.0.0): starting cost a read and a write. MySQL and MariaDB
    // keep that: their conditional upsert has no reliable row count.
    const start = kind === "mysql" ? 2 : 1
    assert.equal((await counter.during(() => run("$dbUserCooldown[cd;1h]"))).count, start, "start")
    assert.equal((await counter.during(() => exec("$dbUserCooldown[cd;1h;wait]"))).count, 1, "running")
    assert.equal((await counter.during(() => exec("$dbUserCooldown[cd;1h;wait]"))).count, 1, "running, again")
    assert.equal((await counter.during(() => run("$dbGetUserCooldownTime[cd]"))).count, 1)
    assert.equal((await counter.during(() => run("$dbDeleteUserCooldown[cd]"))).count, 1)
    // Deleted: free again, one statement (a plain number is a duration in ms).
    assert.equal((await counter.during(() => run("$dbUserCooldown[cd;100]"))).count, start, "start after a delete")
    // Run out: free again, one statement.
    await new Promise((r) => setTimeout(r, 150))
    assert.equal((await counter.during(() => run("$dbUserCooldown[cd;1h]"))).count, start, "start after it ran out")
    // Started by someone else (another process, a raw query): the guess is
    // wrong, which costs one more statement, never a wrong answer.
    await DB.cdAdd({ name: "other", id: ids.user, duration: 3_600_000 })
    DB.clearCache() // as if another process had added it
    let output
    const stolen = await counter.during(async () => (output = (await exec("$dbUserCooldown[other;1h;wait]")).output))
    assert.equal(stolen.count, kind === "mysql" ? 1 : 2)
    assert.equal(output, null, "the claim did not pass")
    await DB.cdWipe()
})

test("a leaderboard command scans the variable once, however many functions it uses", async () => {
    for (let i = 0; i < 50; i++) await DB.set({ ...user("lb", snowflake(i)), value: String(i) })
    const code = "$userLeaderboard[lb;desc;10;1]|$getUserLeaderboardValue[lb;desc]|$getUserLeaderboardLength[lb;10]|$getUserLeaderboardID[lb;desc;3]|$userLeaderboard[lb;desc;10;2]"
    const first = await counter.during(() => run(code))
    // ForgeDB ran one full scan (and sort) per function: 5 here.
    assert.equal(first.count, 1)
    // Ascending order is a separate snapshot.
    assert.equal((await counter.during(() => run("$userLeaderboard[lb;asc;10;1]$getUserLeaderboardID[lb;asc;1]"))).count, 1)
    // Only the two columns a leaderboard needs are read.
    if (kind === "mongodb") assert.deepEqual(JSON.parse(first.queries[0]).projection, { id: 1, value: 1 })
    else assert.doesNotMatch(first.queries[0].split(/ FROM /i)[0], /identifier|guildId/i)
    // A write refreshes it: the next command scans again, once.
    await DB.set({ ...user("lb", snowflake(999)), value: "1000" })
    const second = await counter.during(() => run(`$getUserLeaderboardID[lb;desc;1]|$getUserLeaderboardLength[lb]`))
    assert.equal(second.count, 1)
    assert.equal(await run("$getUserLeaderboardID[lb;desc;1]"), snowflake(999))
    // A write to another variable does not.
    await DB.set({ ...user("unrelated"), value: "1" })
    assert.equal((await counter.during(() => run("$getUserLeaderboardLength[lb]"))).count, 0)
    await DB.wipe()
})

test("change tracking stays bounded with endless distinct variable names", async () => {
    // Bots build names from IDs (warn_<user>). Only names with a leaderboard are tracked.
    const tracked = DB["generations"].size
    try {
        for (let i = 0; i < 3000; i++) await DB.set({ name: `warn_${i}`, type: "custom", value: "1" })
        assert.equal(DB["generations"].size, tracked)
        await DB.leaderboard({ type: "user", name: "a-new-board" })
        assert.equal(DB["generations"].size, tracked + 1)
    } finally {
        await DB.wipe()
    }
})

test("$deleteRecords is one statement without delete listeners", async () => {
    for (let i = 0; i < 300; i++) await DB.set({ ...user("bulk", snowflake(i)), value: "1" })
    // ForgeDB: 1 search + (1 SELECT + 1 DELETE) per row = 601 statements.
    assert.equal((await counter.during(() => run("$deleteRecords[bulk]"))).count, 1)
    assert.equal((await DB.getAll()).length, 0)
})

test("concurrent writes to the same new variable all succeed", async () => {
    // ForgeDB: 49 of 50 failed with a UNIQUE / duplicate key error.
    const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => DB.set({ ...user("race"), value: String(i) })))
    assert.deepEqual(results.filter((r) => r.status === "rejected").map((r) => r.reason.message), [])
    const rows = await DB.find({ name: "race" })
    assert.equal(rows.length, 1)
    assert.ok(Number(rows[0].value) >= 0 && Number(rows[0].value) < 50)
    // And through ForgeScript, for many different variables at once.
    await Promise.all(Array.from({ length: 100 }, (_, i) => run(`$setUserVar[race2;${i};${snowflake(i % 10)}]`)))
    assert.equal((await DB.find({ name: "race2" })).length, 10)
    await DB.wipe()
})

test("a claim that loses a race never reports a cooldown as started that is not", async () => {
    // Another process starts the cooldown between this claim's statements,
    // then deletes it before this claim reads the time left. 3.0.0 answered 0
    // ("started") although nothing was stored, so the command passed without
    // a cooldown.
    const identifier = DB.make_cdIdentifier({ name: "raced", id: ids.user })
    const restore = []
    for (const method of ["claimFirst", "claimInDatabase"]) {
        const original = DB[method]
        if (typeof original !== "function") continue
        restore.push(() => (DB[method] = original))
        DB[method] = async () => {
            for (const undo of restore) undo()
            return false // lost to the other process, whose cooldown is gone again
        }
    }
    try {
        const left = await DB.cdClaim({ name: "raced", id: ids.user, duration: 3_600_000 })
        const stored = await DB.cdTimeLeft(identifier)
        if (left === 0) assert.ok(stored.left > 0, "answered 'started', so the cooldown must be running")
        else assert.ok(left > 0)
    } finally {
        for (const undo of restore) undo()
        await DB.cdWipe()
    }
})

test("cooldown names and IDs are stored as they are, also ones that look like field paths or SQL", async () => {
    for (const name of ["$startedAt", "$name", "'); DROP TABLE cooldown; --", "a.b"]) {
        const identifier = DB.make_cdIdentifier({ name, id: ids.user })
        assert.equal(await DB.cdClaim({ name, id: ids.user, duration: 3_600_000 }), 0, `${name}: first claim starts it`)
        assert.ok((await DB.cdClaim({ name, id: ids.user, duration: 3_600_000 })) > 0, `${name}: second claim finds it running`)
        const stored = await DB.cdTimeLeft(identifier)
        assert.equal(stored.name, name)
        assert.equal(stored.duration, 3_600_000)
    }
    await DB.cdWipe()
})

test("concurrent claims of one cooldown: exactly one gets through", async () => {
    // Twenty "!daily" at once: ForgeDB let all of them pass (check and start were separate steps).
    const results = await Promise.all(Array.from({ length: 20 }, () => exec("$dbUserCooldown[daily;1h;no]claimed")))
    assert.equal(results.filter((r) => r.output === "claimed").length, 1)
    assert.equal(results.filter((r) => r.sent[0] === "no").length, 19)
    // Different users do not wait for each other.
    const others = await Promise.all([ids.user2, ids.user3].map((u) => exec(`$dbUserCooldown[daily;1h;no;${u}]claimed`)))
    assert.deepEqual(others.map((r) => r.output), ["claimed", "claimed"])
    assert.equal(await DB.cdClaim({ name: "daily", id: ids.user, duration: 1000 }) > 0, true)
    await DB.cdWipe()
})

test("mixed concurrent load ends in a consistent state", async () => {
    const tasks = []
    for (let i = 0; i < 300; i++) {
        const id = snowflake(i % 25)
        if (i % 7 === 0) tasks.push(DB.delete(user("mix", id)))
        else if (i % 5 === 0) tasks.push(DB.get(user("mix", id)))
        else if (i % 11 === 0) tasks.push(DB.leaderboard({ type: "user", name: "mix" }))
        else tasks.push(DB.set({ ...user("mix", id), value: String(i) }))
    }
    const settled = await Promise.allSettled(tasks)
    assert.deepEqual(settled.filter((r) => r.status === "rejected").map((r) => r.reason.message), [])
    const rows = await DB.find({ name: "mix" })
    assert.equal(new Set(rows.map((r) => r.identifier)).size, rows.length, "no duplicate rows")
    // The leaderboard agrees with the table once everything settled.
    const board = await DB.leaderboard({ type: "user", name: "mix" })
    assert.equal(board.count, rows.length)
    for (const r of rows) assert.ok(board.positionOf(r.id) > 0)
    await DB.wipe()
})

test("slow operations are reported", async () => {
    const { resolveSettings } = require("../dist/util/database")
    assert.equal(resolveSettings({ type: "sqlite" }).slowQueryThreshold, 1000)
    // Nothing in this file took a second: no slow warnings were logged.
    assert.deepEqual(h.logsOf("warn").filter((l) => /Slow/.test(l)), [])
})

test("a failing database gives catchable errors and one log line, not a flood", async () => {
    // Every way to the database fails: raw SQL, repositories, MongoDB repositories.
    const ds = DB.dataSource
    const real = { query: ds.query, getRepository: ds.getRepository, getMongoRepository: ds.getMongoRepository }
    const lost = async () => {
        throw new Error("connection lost")
    }
    const broken = new Proxy({}, { get: () => lost })
    ds.query = lost
    ds.getRepository = () => broken
    ds.getMongoRepository = () => broken
    try {
        const before = h.logsOf("error").length
        for (let i = 0; i < 25; i++) {
            assert.match(await run("$try[$getUserVar[x];$env[e;message];e]"), /\[ReForgeDB\] get failed: connection lost/)
        }
        assert.match((await exec("$setUserVar[x;1]")).sent[0], /\[ReForgeDB\] set failed: connection lost/)
        const lines = h.logsOf("error").slice(before)
        assert.deepEqual(lines, ["[ReForgeDB] $getUserVar: get failed: connection lost", "[ReForgeDB] $setUserVar: set failed: connection lost"])
        await assert.rejects(DB.get({ name: "x", id: "1", type: "user" }), (err) => err.name === "ReForgeDBError" && err.cause?.message === "connection lost")
    } finally {
        Object.assign(ds, real)
    }
    // It works again as soon as the database does.
    assert.equal(await run("$setUserVar[x;1]$getUserVar[x]"), "1")
    await DB.wipe()
})

test("mistakes in a command are shown to its author, not logged as errors", async () => {
    const before = h.logsOf("error").length
    for (let i = 0; i < 5; i++) await exec("$getUserLeaderboardLength[a;0]$deleteRecords[]")
    await exec("$getMemberVar[xp]", { obj: h.cache.dmMessage })
    assert.deepEqual(h.logsOf("error").slice(before), [])
})
