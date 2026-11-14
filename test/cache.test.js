"use strict"
// The opt-in read cache: what it saves, and that it never disagrees with the
// database for writes made through ReForgeDB.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, ids, snowflake, queryCounter, kind } = require("./fixtures/harness")

let h, run, DB
const counter = queryCounter()
const MAX = 100
before(async () => {
    h = await boot({ logLevel: "warn", cache: { max: MAX }, counter, cooldownSweepInterval: 0 })
    ;({ run, DataBase: DB } = h)
})
after(async () => {
    await DB.close()
})

const user = (name, id = ids.user) => ({ name, id, type: "user" })
const queries = async (fn) => (await counter.during(fn)).count

test("reading what was just written or read costs no query", async () => {
    await DB.set({ ...user("a"), value: "1" })
    assert.equal(await queries(async () => assert.equal((await DB.get(user("a"))).value, "1")), 0)
    assert.equal(await queries(async () => assert.equal(await run("$getUserVar[a]$getUserVar[a]$getUserVar[a]"), "111")), 0)
    // A variable first seen by a read is cached by that read.
    DB.clearCache()
    assert.equal(await queries(() => DB.get(user("a"))), 1)
    assert.equal(await queries(() => DB.get(user("a"))), 0)
})

test("a missing variable is remembered as missing, until it is set", async () => {
    assert.equal(await queries(() => DB.get(user("ghost"))), 1)
    assert.equal(await queries(async () => assert.equal(await DB.get(user("ghost")), null)), 0)
    assert.equal(await queries(async () => assert.equal(await run("$getUserVar[ghost;;d]"), "d")), 0)
    await DB.set({ ...user("ghost"), value: "now" })
    assert.equal(await queries(async () => assert.equal(await run("$getUserVar[ghost;;d]"), "now")), 0)
    await DB.delete(user("ghost"))
})

test("every kind of write through ReForgeDB is seen by the next read", async () => {
    await DB.set({ ...user("w"), value: "1" })
    await DB.set({ ...user("w"), value: "2" })
    assert.equal((await DB.get(user("w"))).value, "2")
    await DB.delete(user("w"))
    assert.equal(await DB.get(user("w")), null)

    await run("$setUserVar[w;3]")
    assert.equal(await run("$getUserVar[w]"), "3")
    await run("$deleteRecords[w]")
    assert.equal(await run("$getUserVar[w;;gone]"), "gone")

    await DB.set({ ...user("w"), value: "4" })
    await DB.deleteMany([{ identifier: `user_w_${ids.user}` }])
    assert.equal(await DB.get(user("w")), null)

    await DB.set({ ...user("w"), value: "5" })
    await DB.delete({ identifier: `user_w_${ids.user}` })
    assert.equal(await DB.get(user("w")), null)

    await DB.set({ ...user("w"), value: "6" })
    await run("$wipeDB")
    assert.equal(await DB.get(user("w")), null)
    assert.equal((await DB.getAll()).length, 0)
})

test("a change made outside ReForgeDB is seen after clearCache()", async () => {
    await DB.set({ ...user("outside"), value: "1" })
    assert.equal((await DB.get(user("outside"))).value, "1")
    const key = `user_outside_${ids.user}`
    if (kind === "mongodb") {
        await DB.dataSource.mongoManager.updateOne(DB.dataSource.getMetadata("MongoRecord").target, { identifier: key }, { $set: { value: "changed" } })
    } else {
        const p = DB.dataSource.driver.createParameter("p", 0)
        await DB.dataSource.query(`UPDATE record SET value = 'changed' WHERE identifier = ${p}`, [key])
    }
    assert.equal((await DB.get(user("outside"))).value, "1", "still the cached copy")
    DB.clearCache()
    assert.equal((await DB.get(user("outside"))).value, "changed")
    await DB.delete(user("outside"))
})

if (kind !== "mongodb") {
    test("a raw query through client.db clears the cache, since it may change anything", async () => {
        await DB.set({ ...user("raw"), value: "1" })
        assert.equal((await DB.get(user("raw"))).value, "1")
        const p = DB.dataSource.driver.createParameter("p", 0)
        await DB.query(`UPDATE record SET value = 'changed' WHERE identifier = ${p}`, [`user_raw_${ids.user}`])
        assert.equal((await DB.get(user("raw"))).value, "changed")
        await DB.delete(user("raw"))
    })
} else {
    test("a raw query is refused on MongoDB with a clear error", async () => {
        await assert.rejects(DB.query("SELECT 1"), /Raw queries are not available on MongoDB/)
    })
}

test("cached records are copies: changing a returned object changes nothing", async () => {
    await DB.set({ ...user("copy"), value: "original" })
    const first = await DB.get(user("copy"))
    first.value = "mutated"
    first.name = "other"
    assert.equal((await DB.get(user("copy"))).value, "original")
    assert.equal((await DB.get(user("copy"))).name, "copy")
    await DB.delete(user("copy"))
})

test("the cache is bounded", async () => {
    const n = MAX * 3
    for (let i = 0; i < n; i++) await DB.set({ ...user("many", snowflake(i)), value: String(i) })
    // The most recent MAX are in memory; the oldest were evicted and cost a query.
    assert.equal(await queries(() => DB.get(user("many", snowflake(n - 1)))), 0)
    assert.equal(await queries(async () => assert.equal((await DB.get(user("many", snowflake(0)))).value, "0")), 1)
    const { LRUCache } = require("../dist/util/primitives")
    assert.ok(DB["readCache"] instanceof LRUCache)
    assert.equal(DB["readCache"].size, MAX)
    await DB.wipe()
})

test("concurrent writes to one key: the cache ends up equal to the database", async () => {
    for (let round = 0; round < 10; round++) {
        await Promise.all(Array.from({ length: 20 }, (_, i) => DB.set({ ...user("order"), value: `${round}-${i}` })))
        const cached = (await DB.get(user("order"))).value
        DB.clearCache()
        assert.equal((await DB.get(user("order"))).value, cached, `round ${round}`)
    }
    // Writes and deletes racing each other.
    for (let round = 0; round < 10; round++) {
        await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? DB.delete(user("order")) : DB.set({ ...user("order"), value: String(i) }))))
        const cached = (await DB.get(user("order")))?.value ?? null
        DB.clearCache()
        assert.equal((await DB.get(user("order")))?.value ?? null, cached, `delete round ${round}`)
    }
    await DB.wipe()
})

test("reads racing writes never cache a stale value", async () => {
    for (let round = 0; round < 30; round++) {
        DB.clearCache()
        const value = String(round)
        // The read starts first and may see the old row; the write must win in the cache.
        const [, , after] = await Promise.all([DB.get(user("stale")), DB.set({ ...user("stale"), value }), DB.get(user("stale"))])
        assert.ok(after === null || typeof after.value === "string")
        assert.equal((await DB.get(user("stale"))).value, value, `round ${round}`)
    }
    await DB.wipe()
})

test("events still fire with the cache on, with correct old data", async () => {
    // No events are enabled in this file; listeners added directly are honoured.
    const seen = []
    const onUpdate = (p) => seen.push([p.oldData.value, p.newData.value])
    h.extension.emitter.on("variableUpdate", onUpdate)
    await DB.set({ ...user("ev"), value: "1" })
    await DB.set({ ...user("ev"), value: "2" })
    h.extension.emitter.off("variableUpdate", onUpdate)
    assert.deepEqual(seen, [["1", "2"]])
    await DB.wipe()
})
