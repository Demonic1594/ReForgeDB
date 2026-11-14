"use strict"
// Several bot processes on one database claim the same cooldown at the same
// moment: exactly one may get through. In one process the claims queue up,
// so only separate processes reach the database's own check.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const path = require("path")
const { spawn } = require("child_process")
const { boot, dbOptions, tmpDir, kind } = require("./fixtures/harness")

const PROCESSES = 6
const CLAIMS = 10
const dir = tmpDir()
let h

before(async () => {
    // Creates the tables (and on a server, empties the test database) first.
    h = await boot({ dir, logLevel: "warn" })
})
after(async () => {
    await h.DataBase.cdWipe()
    await h.DataBase.close()
})

function claimEverywhere(name) {
    const options = JSON.stringify(dbOptions(dir))
    const startAt = Date.now() + 3000
    return Promise.all(
        Array.from(
            { length: PROCESSES },
            () =>
                new Promise((resolve, reject) => {
                    const child = spawn(process.execPath, [path.join(__dirname, "fixtures", "claim.js"), options, String(startAt), name, String(CLAIMS)], { stdio: ["ignore", "pipe", "inherit"] })
                    let out = ""
                    child.stdout.on("data", (d) => (out += d))
                    child.on("error", reject)
                    child.on("exit", () => {
                        try {
                            resolve(JSON.parse(out.trim().split("\n").pop()))
                        } catch {
                            reject(new Error(`no result from a claiming process: ${out}`))
                        }
                    })
                })
        )
    )
}

const total = (results, key) => results.reduce((n, r) => n + (r[key] ?? 0), 0)

test(`a new cooldown: ${PROCESSES} processes x ${CLAIMS} claims, exactly one gets through`, { timeout: 60_000 }, async () => {
    const results = await claimEverywhere("race-new")
    assert.deepEqual(results.filter((r) => r.error), [], "no process failed")
    assert.equal(total(results, "claimed"), 1, JSON.stringify(results))
    assert.equal(total(results, "blocked"), PROCESSES * CLAIMS - 1)
})

test("an expired cooldown: exactly one restarts it", { timeout: 60_000 }, async () => {
    await h.DataBase.cdAdd({ name: "race-old", id: "1", duration: 1 })
    await new Promise((r) => setTimeout(r, 20))
    const results = await claimEverywhere("race-old")
    assert.deepEqual(results.filter((r) => r.error), [])
    assert.equal(total(results, "claimed"), 1, JSON.stringify(results))
    assert.ok((await h.DataBase.cdTimeLeft("race-old_1")).left > 3_500_000)
})

test("a running cooldown: nobody gets through", { timeout: 60_000 }, async () => {
    const results = await claimEverywhere("race-new")
    assert.equal(total(results, "claimed"), 0, JSON.stringify(results))
})

test("the processes shared one database", () => {
    assert.ok(["sqlite", "mysql", "postgres", "mongodb"].includes(kind))
})
