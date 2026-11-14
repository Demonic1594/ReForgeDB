"use strict"
// The cooldownExpire event: fired once when a stored cooldown runs out, by
// one process even when several share the database, never for a cooldown that
// was restarted or deleted, never as a flood after downtime, and not polled
// at all without a listener.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const path = require("path")
const { spawn } = require("child_process")
const { boot, dbOptions, tmpDir, ids, lib } = require("./fixtures/harness")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dir = tmpDir()
let h, DB
const fired = []

before(async () => {
    h = await boot({ dir, logLevel: "info", cooldownSweepInterval: 0, cooldownExpireInterval: 40, events: ["cooldownExpire"] })
    DB = h.DataBase
    h.extension.emitter.on("cooldownExpire", ({ cooldown }) => fired.push(cooldown))
})
after(async () => {
    await DB.cdWipe()
    await DB.close()
})

/** Stores cooldowns as if started `ago` ms ago (import() writes exact times, on every database). */
async function storeStarted(list) {
    const cooldowns = list.map(([name, id, duration, ago]) => ({ identifier: DB.make_cdIdentifier({ name, id }), name, id, startedAt: Date.now() - ago, duration }))
    await DB.import({ format: "reforge.db", version: 1, exportedAt: new Date().toISOString(), source: "test", records: [], cooldowns }, { overwrite: true })
}

test("a cooldown that runs out fires cooldownExpire once, and $cooldownData reads it in an event command", async () => {
    fired.length = 0
    h.extension.commands.add({ type: "cooldownExpire", code: "$setGlobalVar[expired;$cooldownData[name]|$cooldownData[id]|$cooldownData[duration]|$math[$cooldownData[expiredAt]-$cooldownData[startedAt]]]" })
    assert.equal(await h.run("$dbUserCooldown[daily;150]started"), "started")
    assert.equal(fired.length, 0, "not before it runs out")
    await sleep(400)
    const mine = fired.filter((c) => c.name === "daily")
    assert.equal(mine.length, 1, "once")
    assert.deepEqual({ ...mine[0], startedAt: 0, expiredAt: 0 }, { identifier: `daily_${ids.user}`, name: "daily", id: ids.user, startedAt: 0, duration: 150, expiredAt: 0 })
    assert.equal(mine[0].expiredAt, mine[0].startedAt + 150)
    assert.equal(await h.run("$getGlobalVar[expired]"), `daily|${ids.user}|150|150`)
    assert.equal(await h.run("$dbGetUserCooldownTime[daily]"), "0")
    await sleep(200)
    assert.equal(fired.filter((c) => c.name === "daily").length, 1, "never twice")
    assert.equal(await h.run("$cooldownData[name]"), "", "nothing outside the event")
})

test("a cooldown restarted or deleted before it runs out fires nothing for the old one", async () => {
    fired.length = 0
    await h.run("$dbUserCooldown[restart;150]$dbUserCooldown[gone;150]")
    await sleep(60)
    await DB.cdAdd({ name: "restart", id: ids.user, duration: 3_600_000 }) // restarted, now long
    await h.run("$dbDeleteUserCooldown[gone]")
    await sleep(400)
    assert.deepEqual(fired.map((c) => c.name), [])
    assert.ok(Number(await h.run("$dbGetUserCooldownTime[restart]")) > 3_000_000, "the restarted one still runs")
})

test("every scope fires: user, member, guild, channel and global, with the ID it was for", async () => {
    fired.length = 0
    await h.run("$dbUserCooldown[s;100]$dbMemberCooldown[s;100]$dbGuildCooldown[s;100]$dbChannelCooldown[s;100]$globalCooldown[s;100]")
    await sleep(450)
    const got = fired.map((c) => c.identifier).sort()
    assert.equal(got.length, 5, JSON.stringify(got))
    assert.ok(fired.some((c) => c.id === null || c.id === undefined), "the global one has no ID")
})

test("after downtime: cooldowns that ran out long ago are dropped quietly, recent ones still fire", async () => {
    fired.length = 0
    h.logs.length = 0
    await storeStarted([
        ...Array.from({ length: 30 }, (_, i) => [`old${i}`, ids.user, 60_000, 3 * 24 * 3_600_000]), // ran out 3 days ago
        ["recent", ids.user, 60_000, 60_000 + 30 * 60_000], // ran out 30 minutes ago
        ["month", ids.user, 30 * 24 * 3_600_000, 30 * 24 * 3_600_000 + 1000], // a 30-day cooldown, just over (longer than setTimeout allows)
    ])
    await sleep(400)
    assert.deepEqual(fired.map((c) => c.name).sort(), ["month", "recent"])
    // Counted in the log (the rows were written one at a time, so possibly over several checks).
    const dropped = h.logs.map((l) => /Dropped (\d+) cooldownExpire event\(s\)/.exec(l.text)).filter(Boolean).reduce((n, m) => n + Number(m[1]), 0)
    assert.equal(dropped, 30, h.logs.map((l) => l.text).join("\n"))
    const left = (await DB.export()).cooldowns.filter((c) => c.name.startsWith("old"))
    assert.deepEqual(left, [], "and deleted")
})

test("more than one batch (1,200 at once) all fire, each once", async () => {
    fired.length = 0
    const rows = Array.from({ length: 1200 }, (_, i) => ({ identifier: `bulk${i}`, name: `bulk${i}`, id: null, startedAt: Date.now() - 2000, duration: 1000 }))
    await DB.import({ format: "reforge.db", version: 1, exportedAt: new Date().toISOString(), source: "test", records: [], cooldowns: rows })
    for (let i = 0; i < 100 && fired.length < 1200; i++) await sleep(100)
    assert.equal(fired.length, 1200)
    assert.equal(new Set(fired.map((c) => c.identifier)).size, 1200)
})

test("options: a cut-off under a minute is refused", () => {
    assert.throws(() => new lib.ReForgeDB({ cooldownExpireMaxDelay: 1000 }), /cooldownExpireMaxDelay.*at least 60000/)
    assert.throws(() => new lib.ReForgeDB({ cooldownExpireInterval: -1 }), /cooldownExpireInterval/)
})

test("several processes on one database: each expiry fires in exactly one of them", { timeout: 90_000 }, async () => {
    const options = JSON.stringify(dbOptions(dir))
    const children = Array.from(
        { length: 4 },
        () =>
            new Promise((resolve, reject) => {
                const child = spawn(process.execPath, [path.join(__dirname, "fixtures", "expire.js"), options, "6000"], { stdio: ["ignore", "pipe", "inherit"] })
                let out = ""
                child.stdout.on("data", (d) => (out += d))
                child.on("error", reject)
                child.on("exit", () => {
                    try {
                        resolve(JSON.parse(out.trim().split("\n").pop()))
                    } catch {
                        reject(new Error(`no result: ${out}`))
                    }
                })
            })
    )
    // This process stops listening, so only the children fire.
    const listeners = h.extension.emitter.listeners("cooldownExpire")
    h.extension.emitter.removeAllListeners("cooldownExpire")
    try {
        await sleep(3500) // the children connect
        for (let i = 0; i < 60; i++) await DB.cdAdd({ name: `race${i}`, id: "1", duration: 300 + (i % 10) * 50 })
        const results = await Promise.all(children)
        assert.deepEqual(results.filter((r) => r.error), [])
        const all = results.flatMap((r) => r.fired).filter((x) => x.startsWith("race"))
        assert.equal(all.length, 60, `fired ${all.length} times across ${results.length} processes: ${results.map((r) => r.fired.length)}`)
        assert.equal(new Set(all).size, 60, "each once")
    } finally {
        for (const l of listeners) h.extension.emitter.on("cooldownExpire", l)
    }
})

test("without a listener nothing is checked, and the sweeper deletes expired cooldowns as before", async () => {
    const listeners = h.extension.emitter.listeners("cooldownExpire")
    h.extension.emitter.removeAllListeners("cooldownExpire")
    const real = DB.expireCooldowns
    let checks = 0
    DB.expireCooldowns = async (...a) => (checks++, real.apply(DB, a))
    try {
        await DB.cdAdd({ name: "quiet", id: "1", duration: 1 })
        await sleep(300)
        assert.equal(checks, 0, "no check without a listener")
        assert.equal(await DB.sweepCooldowns(), 1, "the sweeper takes over when no one listens")
    } finally {
        DB.expireCooldowns = real
        for (const l of listeners) h.extension.emitter.on("cooldownExpire", l)
    }
})
