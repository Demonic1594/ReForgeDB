"use strict"
// How many statements operations cost, and behaviour under concurrency.
// Runs without events and without the read cache (the defaults).
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, ids, snowflake, queryCounter } = require("./fixtures/harness")

let h, run, exec, DB
const counter = queryCounter()
before(async () => {
    h = await boot({ logLevel: "warn", typeorm: counter.typeorm })
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

test("a cooldown check is one read, plus one write when it starts", async () => {
    assert.equal((await counter.during(() => run("$dbUserCooldown[cd;1h]"))).count, 2, "check + start")
    assert.equal((await counter.during(() => exec("$dbUserCooldown[cd;1h;wait]"))).count, 1, "check only")
    assert.equal((await counter.during(() => run("$dbGetUserCooldownTime[cd]"))).count, 1)
    assert.equal((await counter.during(() => run("$dbDeleteUserCooldown[cd]"))).count, 1)
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
    assert.doesNotMatch(first.queries[0].split(/ FROM /i)[0], /identifier|guildId/i)
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
    const ds = DB.dataSource
    const realQuery = ds.query
    ds.query = async () => {
        throw new Error("connection lost")
    }
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
        ds.query = realQuery
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
