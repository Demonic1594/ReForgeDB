"use strict"
// Pure pieces: no database, no client.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const path = require("path")
const root = path.join(__dirname, "..")
const lib = require(root)
const { KeyedMutex, LRUCache, likeMatcher, likePrefix, normalizeLike, escapeRegExp, MAX_LIKE_LENGTH, compareIds, rankValue, chunk } = require(path.join(root, "dist/util/primitives"))
const { resolveSettings, Leaderboard } = require(path.join(root, "dist/util/database"))
const { pickId, pickText, sortOf, positiveInt, pagesOf, variableTypeOf, eventRecord } = require(path.join(root, "dist/util/functions"))
const { ReForgeDBLogger } = require(path.join(root, "dist/util/logger"))

test("identity: package, extension and exports", () => {
    const pkg = require(path.join(root, "package.json"))
    assert.equal(pkg.name, "@tryforge/reforge.db")
    assert.equal(typeof lib.ReForgeDB, "function")
    assert.equal(lib.ReForgeDB.extensionName, "reforge.db")
    assert.equal(lib.EVENT_HANDLER_NAME, "ReForgeDBEvents")
    // The original's class name is not exported: the fork is clearly distinct.
    assert.equal(lib.ForgeDB, undefined)
    for (const name of ["DataBase", "DataBaseManager", "Leaderboard", "ReForgeDBError", "ReForgeDBLogger"]) assert.equal(typeof lib[name], "function", name)
})

test("variable keys are exactly ForgeDB's, so existing databases keep working", () => {
    const id = (d) => lib.DataBase.make_intetifier(d)
    assert.equal(id({ type: "user", name: "coins", id: "1" }), "user_coins_1")
    assert.equal(id({ type: "guild", name: "prefix", id: "2" }), "guild_prefix_2")
    assert.equal(id({ type: "message", name: "poll", id: "3" }), "message_poll_3")
    assert.equal(id({ type: "old", name: "legacy", id: "abc" }), "old_legacy_abc")
    // Global variables have no id; ForgeDB stored the literal "undefined".
    assert.equal(id({ type: "custom", name: "motd" }), "custom_motd_undefined")
    // Guild-scoped types carry the guild between name and id.
    assert.equal(id({ type: "member", name: "xp", id: "1", guildId: "9" }), "member_xp_9_1")
    assert.equal(id({ type: "channel", name: "topic", id: "5", guildId: "9" }), "channel_topic_9_5")
    assert.equal(id({ type: "role", name: "color", id: "7", guildId: "9" }), "role_color_9_7")
    // A channel outside a guild (a DM) was stored with "undefined" as guild.
    assert.equal(id({ type: "channel", name: "topic", id: "5", guildId: undefined }), "channel_topic_undefined_5")
    assert.equal(lib.DataBase.makeIdentifier({ type: "user", name: "a", id: "1" }), "user_a_1")
})

test("cooldown keys are exactly ForgeDB's", () => {
    const id = (d) => lib.DataBase.make_cdIdentifier(d)
    assert.equal(id({ name: "daily", id: "1" }), "daily_1")
    assert.equal(id({ name: "daily" }), "daily")
    assert.equal(id({ name: "work-9", id: "1" }), "work-9_1")
})

test("pickId treats empty arguments as not given", () => {
    assert.equal(pickId(""), undefined)
    assert.equal(pickId("   "), undefined)
    assert.equal(pickId(null), undefined)
    assert.equal(pickId(undefined), undefined)
    assert.equal(pickId("123"), "123")
    assert.equal(pickId(" 123 "), "123")
    assert.equal(pickId({ id: "456" }), "456")
    assert.equal(pickId({ id: "" }), undefined)
    assert.equal(pickId({}), undefined)
    // Mentions stand for their ID.
    assert.equal(pickId("<@200000000000000001>"), "200000000000000001")
    assert.equal(pickId("<@!200000000000000001>"), "200000000000000001")
    assert.equal(pickId("<#300000000000000001>"), "300000000000000001")
    assert.equal(pickId("<@&400000000000000001>"), "400000000000000001")
    assert.equal(pickId(" <@200000000000000001> "), "200000000000000001")
    // Anything else is kept as given.
    assert.equal(pickId("<@abc>"), "<@abc>")
    assert.equal(pickId("<@123>"), "<@123>", "too short for a Discord ID")
    assert.equal(pickId("<:emoji:500000000000000001>"), "<:emoji:500000000000000001>")
    assert.equal(pickId("custom-key"), "custom-key")
    assert.equal(pickText(""), undefined)
    assert.equal(pickText("0"), "0")
    assert.equal(pickText(" "), " ")
})

test("argument helpers", () => {
    assert.equal(sortOf("asc"), "asc")
    assert.equal(sortOf("ASC "), "asc")
    assert.equal(sortOf(0), "asc")
    assert.equal(sortOf("desc"), "desc")
    assert.equal(sortOf(null), "desc")
    assert.equal(sortOf("nonsense"), "desc")
    assert.equal(positiveInt("5", 10), 5)
    assert.equal(positiveInt("5.9", 10), 5)
    assert.equal(positiveInt("0", 10), 10)
    assert.equal(positiveInt("-3", 10), 10)
    assert.equal(positiveInt("abc", 10), 10)
    assert.equal(positiveInt(null, 1), 1)
    assert.equal(positiveInt(Infinity, 7), 7)
    assert.equal(pagesOf(25, 10, false), 3)
    assert.equal(pagesOf(25, 10, true), 2.5)
    assert.equal(pagesOf(20, 10, false), 2)
    assert.equal(pagesOf(7, null, false), 7)
    assert.equal(pagesOf(0, 10, false), 0)
    assert.throws(() => pagesOf(5, 0, false), /above 0/)
    assert.throws(() => pagesOf(5, -2, false), /above 0/)
    assert.equal(variableTypeOf(0), "user")
    assert.equal(variableTypeOf(6), "guild")
    assert.equal(variableTypeOf(7), "old")
    assert.equal(variableTypeOf("user"), "user")
    assert.equal(variableTypeOf(null), undefined)
    assert.equal(variableTypeOf(99), undefined)
    assert.equal(variableTypeOf("0"), undefined)
})

test("eventRecord never throws outside events", () => {
    const ctx = (extras) => ({ runtime: { extras } })
    assert.equal(eventRecord(ctx(undefined), "data"), null)
    assert.equal(eventRecord(ctx(null), "newData"), null)
    assert.equal(eventRecord(ctx("text"), "oldData"), null)
    assert.equal(eventRecord(ctx({}), "data"), null)
    assert.equal(eventRecord(ctx({ data: null }), "data"), null)
    const rec = { name: "a" }
    assert.equal(eventRecord(ctx({ data: rec, event: "variableCreate" }), "data"), rec)
    assert.equal(eventRecord(ctx({ data: rec, event: "variableCreate" }), "newData"), rec)
    assert.equal(eventRecord(ctx({ data: rec, event: "variableCreate" }), "oldData"), null)
    assert.equal(eventRecord(ctx({ data: rec, event: "variableDelete" }), "oldData"), rec)
    assert.equal(eventRecord(ctx({ data: rec, event: "variableDelete" }), "newData"), null)
    const upd = { newData: { v: 2 }, oldData: { v: 1 }, event: "variableUpdate" }
    assert.equal(eventRecord(ctx(upd), "data"), upd.newData)
    assert.equal(eventRecord(ctx(upd), "newData"), upd.newData)
    assert.equal(eventRecord(ctx(upd), "oldData"), upd.oldData)
})

test("rankValue: only finite numbers rank", () => {
    assert.equal(rankValue("10"), 10)
    assert.equal(rankValue(" 10 "), 10)
    assert.equal(rankValue("-2.5"), -2.5)
    assert.equal(rankValue("1e3"), 1000)
    assert.equal(rankValue("0"), 0)
    assert.equal(rankValue(""), null)
    assert.equal(rankValue("   "), null)
    assert.equal(rankValue("abc"), null)
    assert.equal(rankValue("1,000"), null)
    assert.equal(rankValue("Infinity"), null)
    assert.equal(rankValue("NaN"), null)
    assert.equal(rankValue(null), null)
    assert.equal(rankValue(undefined), null)
    assert.equal(rankValue({}), null)
    assert.equal(rankValue(5), 5)
})

test("compareIds orders snowflakes numerically", () => {
    assert.ok(compareIds("9", "10") < 0)
    assert.ok(compareIds("100000000000000000", "99999999999999999") > 0)
    assert.ok(compareIds("200000000000000001", "200000000000000002") < 0)
    assert.equal(compareIds("5", "5"), 0)
    assert.ok(compareIds("abc", "abd") < 0)
    const ids = ["30", "4", "200", "1"]
    assert.deepEqual([...ids].sort(compareIds), ["1", "4", "30", "200"])
})

test("likeMatcher matches like SQL LIKE", () => {
    const m = (pattern, text) => likeMatcher(pattern)(text)
    assert.ok(m("coins", "coins"))
    assert.ok(m("coins", "COINS"))
    assert.ok(!m("coins", "coins2"))
    assert.ok(!m("coins", "mycoins"))
    assert.ok(m("coin%", "coins_total"))
    assert.ok(m("%coin%", "my coins"))
    assert.ok(m("c_ins", "coins"))
    assert.ok(!m("c_ins", "cooins"))
    assert.ok(!m("c_ins", "cins"))
    assert.ok(m("%", ""))
    assert.ok(m("%", "multi\nline"))
    assert.ok(m("%a%b%", "xaxxbx"))
    assert.ok(!m("%a%b", "xaxxbx"))
    assert.ok(m("a%a", "aa"))
    assert.ok(!m("a%a", "a"))
    assert.ok(m("__", "日本"), "one _ is one character, also outside ASCII")
    assert.ok(m("%🎉", "party 🎉"))
    // Regex characters are literal.
    assert.ok(m("a.b", "a.b"))
    assert.ok(!m("a.b", "axb"))
    assert.ok(m("(x)[y]{z}^$|\\+*?", "(x)[y]{z}^$|\\+*?"))
    assert.ok(!m(".*", "anything"))
    assert.ok(!m("x", null))
    assert.ok(!m("x", 5))
})

test("a pathological pattern takes linear time", () => {
    // As a regular expression this did not finish within a minute on 30 characters.
    const pattern = "%".repeat(10) + "a%".repeat(10) + "b"
    const started = performance.now()
    assert.equal(likeMatcher(pattern)("a".repeat(5000)), false)
    assert.equal(likeMatcher(pattern)("a".repeat(5000) + "b"), true)
    assert.ok(performance.now() - started < 500, `${(performance.now() - started).toFixed(0)} ms`)
})

test("patterns are normalized and bounded; prefixes are literal", () => {
    assert.equal(normalizeLike("%%a%%%b%"), "%a%b%")
    assert.equal(normalizeLike("a_b"), "a_b")
    assert.equal(normalizeLike("x".repeat(MAX_LIKE_LENGTH)).length, MAX_LIKE_LENGTH)
    assert.throws(() => normalizeLike("x".repeat(MAX_LIKE_LENGTH + 1)), /at most 1000 characters/)
    assert.equal(likePrefix("coins%"), "coins")
    assert.equal(likePrefix("co_ns"), "co")
    assert.equal(likePrefix("%x"), "")
    assert.equal(likePrefix("plain"), "plain")
    assert.equal(escapeRegExp("a.b*(c)[d]\\e/f$^|+?{}"), "a\\.b\\*\\(c\\)\\[d\\]\\\\e\\/f\\$\\^\\|\\+\\?\\{\\}")
    assert.ok(new RegExp("^" + escapeRegExp("(a+)+$")).test("(a+)+$"))
})

test("chunk", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
    assert.deepEqual(chunk([], 3), [])
    assert.deepEqual(chunk([1], 3), [[1]])
})

test("LRUCache evicts the least recently used and honours ttl", async () => {
    const c = new LRUCache(2)
    c.set("a", 1)
    c.set("b", 2)
    assert.deepEqual(c.get("a"), { value: 1 }) // a is now the most recent
    c.set("c", 3) // evicts b
    assert.equal(c.get("b"), undefined)
    assert.deepEqual(c.get("a"), { value: 1 })
    assert.deepEqual(c.get("c"), { value: 3 })
    assert.equal(c.size, 2)
    c.set("n", null) // null is a value (a known-missing record)
    assert.deepEqual(c.get("n"), { value: null })
    assert.ok(c.delete("n"))
    c.clear()
    assert.equal(c.size, 0)

    const t = new LRUCache(10, 30)
    t.set("x", 1)
    assert.deepEqual(t.get("x"), { value: 1 })
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(t.get("x"), undefined)
    assert.equal(t.size, 0)
})

test("LRUCache with a weight bound evicts until the total fits", () => {
    const c = new LRUCache(100, 0, 10, (v) => v.length)
    c.set("a", "xxxx")
    c.set("b", "xxxx")
    assert.equal(c.weight, 8)
    c.set("c", "xxxx") // 12 > 10: the oldest goes
    assert.equal(c.get("a"), undefined)
    assert.equal(c.weight, 8)
    c.set("huge", "x".repeat(11)) // heavier than the bound: not kept at all
    assert.equal(c.get("huge"), undefined)
    assert.equal(c.size, 2)
    c.set("b", "x") // replacing an entry updates the weight
    assert.equal(c.weight, 5)
    c.delete("b")
    assert.equal(c.weight, 4)
    c.clear()
    assert.equal(c.weight, 0)
})

test("LRUCache stays within its bound under load", () => {
    const c = new LRUCache(100)
    for (let i = 0; i < 10_000; i++) c.set("k" + i, i)
    assert.equal(c.size, 100)
    assert.deepEqual(c.get("k9999"), { value: 9999 })
    assert.equal(c.get("k0"), undefined)
})

test("KeyedMutex serializes one key and frees its memory", async () => {
    const m = new KeyedMutex()
    const order = []
    const task = (name, ms) => () => new Promise((r) => setTimeout(() => (order.push(name), r(name)), ms))
    const results = await Promise.all([m.run("k", task("slow", 40)), m.run("k", task("fast", 1)), m.run("other", task("parallel", 5))])
    assert.deepEqual(results, ["slow", "fast", "parallel"])
    // Same key keeps arrival order; the other key was not blocked by it.
    assert.deepEqual(order, ["parallel", "slow", "fast"])
    assert.equal(m.size, 0)
})

test("KeyedMutex: a failing task does not block the next one", async () => {
    const m = new KeyedMutex()
    await assert.rejects(
        m.run("k", async () => {
            throw new Error("boom")
        }),
        /boom/
    )
    assert.equal(await m.run("k", async () => "ok"), "ok")
    assert.equal(m.size, 0)
})

test("Leaderboard positions and pages", () => {
    const entries = [
        { id: "a", value: "30", score: 30 },
        { id: "b", value: "20", score: 20 },
        { id: "c", value: "10", score: 10 },
    ]
    const b = new Leaderboard({ type: "user", name: "x", sort: "desc" }, entries)
    assert.equal(b.count, 3)
    assert.equal(b.positionOf("a"), 1)
    assert.equal(b.positionOf("c"), 3)
    assert.equal(b.positionOf("zzz"), 0)
    assert.equal(b.positionOf(undefined), 0)
    assert.equal(b.positionOf(""), 0)
    assert.deepEqual(b.page(1, 2), { start: 0, entries: entries.slice(0, 2) })
    assert.deepEqual(b.page(2, 2), { start: 2, entries: entries.slice(2) })
    assert.deepEqual(b.page(5, 2), { start: 8, entries: [] })
})

test("options are validated at construction with clear messages", () => {
    assert.throws(() => resolveSettings({ type: "oracle" }), /Unknown database type "oracle"/)
    assert.throws(() => resolveSettings({ type: "mongodb" }), /needs a "url"/)
    assert.throws(() => resolveSettings({ type: "sqlite", logLevel: "loud" }), /Unknown logLevel "loud"/)
    assert.throws(() => resolveSettings({ type: "sqlite", events: "connect" }), /must be an array/)
    assert.throws(() => resolveSettings({ type: "sqlite", readyTimeout: -1 }), /readyTimeout/)
    assert.throws(() => resolveSettings({ type: "sqlite", slowQueryThreshold: "1s" }), /slowQueryThreshold/)
    assert.throws(() => resolveSettings({ type: "sqlite", leaderboardCacheTTL: NaN }), /leaderboardCacheTTL/)
    assert.throws(() => resolveSettings({ type: "sqlite", cache: { max: 0 } }), /cache\.max/)
    assert.throws(() => new lib.ReForgeDB({ type: "nope" }), /Unknown database type/)

    const d = resolveSettings(undefined)
    assert.deepEqual(d, { slowQueryThreshold: 1000, readyTimeout: 30000, leaderboardCacheTTL: 2000, cooldownSweepInterval: 3600000, cache: null })
    assert.deepEqual(resolveSettings({ type: "sqlite", cache: true }).cache, { max: 10000, ttl: 0 })
    assert.deepEqual(resolveSettings({ type: "sqlite", cache: { max: 50.9, ttl: 1000 } }).cache, { max: 50, ttl: 1000 })
    assert.equal(resolveSettings({ type: "mariadb" }).readyTimeout, 30000)
    assert.equal(resolveSettings({ type: "sqlite", leaderboardCacheTTL: 0 }).leaderboardCacheTTL, 0)
})

test("log levels gate output", () => {
    const before = ReForgeDBLogger.level
    try {
        ReForgeDBLogger.level = "warn"
        assert.ok(ReForgeDBLogger.enabled("error"))
        assert.ok(ReForgeDBLogger.enabled("warn"))
        assert.ok(!ReForgeDBLogger.enabled("info"))
        assert.ok(!ReForgeDBLogger.enabled("debug"))
        ReForgeDBLogger.level = "silent"
        assert.ok(!ReForgeDBLogger.enabled("error"))
        ReForgeDBLogger.level = "trace"
        assert.ok(ReForgeDBLogger.enabled("debug"))
        assert.ok(ReForgeDBLogger.enabled("trace"))
        assert.ok(!ReForgeDBLogger.enabled("silent"))
    } finally {
        ReForgeDBLogger.level = before
    }
})

test("variables(): defaults are stored, replaced and compiled lazily", () => {
    const { ReForgeDB } = lib
    ReForgeDB.variables({ coins: 0, title: "Hi $username", obj: { a: 1 }, none: null })
    assert.ok(ReForgeDB.hasDefault("coins"))
    assert.ok(!ReForgeDB.hasDefault("toString"), "inherited properties are not defaults")
    assert.ok(!ReForgeDB.hasDefault("constructor"))
    assert.deepEqual(ReForgeDB.defaultFor("coins"), { value: 0 })
    assert.deepEqual(ReForgeDB.defaultFor("obj"), { value: { a: 1 } })
    assert.deepEqual(ReForgeDB.defaultFor("none"), { value: null })
    assert.equal(ReForgeDB.defaultFor("missing"), undefined)
    ReForgeDB.variables({ other: 1 })
    assert.ok(!ReForgeDB.hasDefault("coins"), "each call replaces the defaults")
    assert.throws(() => ReForgeDB.variables(null), /expects an object/)
    ReForgeDB.variables({})
})
