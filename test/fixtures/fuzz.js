"use strict"
// A seeded random workload against ReForgeDB and an in-memory model of what
// the database must hold. Run in its own process (the configuration is per
// process): node fuzz.js <seed> <steps> <cache: on|off>
// Prints {ok, ...counters} or {ok: false, mismatch}.
const { boot, kind } = require("./harness")
const { likeMatcher, rankValue, compareIds } = require("../../dist/util/primitives")

const [seed = "1", steps = "300", cacheMode = "off"] = process.argv.slice(2)

// mulberry32: small, fast, reproducible. Two streams: one picks operations,
// one picks injected failures, so a seed replays the same on every database.
function rng(n) {
    let a = n >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}
const ops = rng(Number(seed))
const faults = rng(Number(seed) * 7919 + 1)
const pick = (list) => list[Math.floor(ops() * list.length)]

// Lower-case ASCII only: SQL engines differ in case rules for LIKE.
const NAMES = ["xp", "coins", "coin", "level", "lvl"]
const IDS = Array.from({ length: 12 }, (_, i) => "9" + String(i + 1).padStart(17, "0"))
const VALUES = () => pick(["0", "1", "5", "10", "-3", "2.5", "100", "abc", "", "7", "42"]) + (ops() < 0.2 ? String(Math.floor(ops() * 100)) : "")
const PATTERNS = ["xp", "coin%", "%o%", "c_ins", "l%l", "%", "lv_", "nothing"]

const key = (name, id) => `user_${name}_${id}`

;(async () => {
    const h = await boot({ logLevel: "silent", cache: cacheMode === "on" ? { max: 20 } : false, cooldownSweepInterval: 0 })
    const DB = h.DataBase
    const model = new Map() // identifier -> { name, id, value }
    const counters = { steps: 0, writes: 0, failedWrites: 0, reads: 0, leaderboards: 0, searches: 0, bulkDeletes: 0 }
    const fail = (mismatch) => {
        console.log(JSON.stringify({ ok: false, seed, cacheMode, step: counters.steps, mismatch }))
        process.exit(0)
    }

    // Injected failures: a database call fails before it reaches the
    // database, like a dropped connection. The write must then not count:
    // neither in the database nor in the cache.
    const ds = DB.dataSource
    let injecting = false
    const boom = () => {
        throw new Error("injected failure")
    }
    const maybeFail = () => {
        if (injecting && faults() < 0.05) boom()
    }
    const realQuery = ds.query.bind(ds)
    ds.query = async (...args) => (maybeFail(), realQuery(...args))
    for (const method of ["getRepository", "getMongoRepository"]) {
        const real = ds[method].bind(ds)
        ds[method] = (target) => {
            const repo = real(target)
            return new Proxy(repo, { get: (obj, prop) => (typeof obj[prop] === "function" ? (...a) => (maybeFail(), obj[prop](...a)) : obj[prop]) })
        }
    }

    const modelBoard = (name, sort) =>
        [...model.values()]
            .filter((r) => r.name === name && rankValue(r.value) !== null)
            .map((r) => ({ id: r.id, score: rankValue(r.value) }))
            .sort(sort === "asc" ? (a, b) => a.score - b.score || compareIds(a.id, b.id) : (a, b) => b.score - a.score || compareIds(a.id, b.id))
            .map((e) => e.id)

    for (let step = 0; step < Number(steps); step++) {
        counters.steps = step
        const roll = ops()
        if (roll < 0.7) {
            // A batch of concurrent operations on distinct keys.
            const used = new Set()
            const batch = []
            for (let i = 0; i < 1 + Math.floor(ops() * 8); i++) {
                const name = pick(NAMES)
                const id = pick(IDS)
                const k = key(name, id)
                if (used.has(k)) continue
                used.add(k)
                const what = ops()
                if (what < 0.5) batch.push({ k, kind: "set", name, id, value: VALUES() })
                else if (what < 0.7) batch.push({ k, kind: "delete", name, id })
                else batch.push({ k, kind: "get", name, id })
            }
            injecting = true
            const results = await Promise.allSettled(
                batch.map((op) => (op.kind === "set" ? DB.set({ name: op.name, id: op.id, type: "user", value: op.value }) : op.kind === "delete" ? DB.delete({ name: op.name, id: op.id, type: "user" }) : DB.get({ name: op.name, id: op.id, type: "user" })))
            )
            injecting = false
            for (const [i, op] of batch.entries()) {
                const r = results[i]
                if (r.status === "rejected") {
                    if (!/injected failure/.test(r.reason?.message)) fail({ op, error: r.reason?.message })
                    if (op.kind !== "get") counters.failedWrites++
                    continue
                }
                if (op.kind === "set") {
                    model.set(op.k, { name: op.name, id: op.id, value: op.value })
                    counters.writes++
                } else if (op.kind === "delete") {
                    model.delete(op.k)
                    counters.writes++
                } else {
                    counters.reads++
                    const expected = model.get(op.k)?.value ?? null
                    const got = r.value?.value ?? null
                    if (got !== expected) fail({ op, expected, got })
                }
            }
        } else if (roll < 0.82) {
            counters.leaderboards++
            const name = pick(NAMES)
            const sort = ops() < 0.5 ? "asc" : "desc"
            const got = (await DB.leaderboard({ type: "user", name, sort })).entries.map((e) => e.id)
            const expected = modelBoard(name, sort)
            if (JSON.stringify(got) !== JSON.stringify(expected)) fail({ leaderboard: name, sort, expected, got })
        } else if (roll < 0.94) {
            counters.searches++
            const pattern = pick(PATTERNS)
            const got = (await DB.search({ name: pattern, type: "user" })).map((r) => r.identifier).sort()
            const matches = likeMatcher(pattern)
            const expected = [...model.entries()].filter(([, r]) => matches(r.name)).map(([k]) => k).sort()
            if (JSON.stringify(got) !== JSON.stringify(expected)) fail({ search: pattern, expected, got })
        } else {
            counters.bulkDeletes++
            const pattern = pick(PATTERNS.filter((p) => p !== "%"))
            await DB.deleteMatching({ name: pattern, type: "user" })
            const matches = likeMatcher(pattern)
            for (const [k, r] of model) if (matches(r.name)) model.delete(k)
        }
    }

    // Finally the whole table, read past any cache, must equal the model.
    DB.clearCache()
    const all = (await DB.getAll()).map((r) => `${r.identifier}=${r.value}`).sort()
    const expected = [...model.entries()].map(([k, r]) => `${k}=${r.value}`).sort()
    if (JSON.stringify(all) !== JSON.stringify(expected)) fail({ final: true, expected, got: all })
    console.log(JSON.stringify({ ok: true, seed, cacheMode, kind, ...counters, rows: all.length }))
    await DB.close()
    process.exit(0)
})().catch((err) => {
    console.log(JSON.stringify({ ok: false, error: err.stack }))
    process.exit(0)
})
