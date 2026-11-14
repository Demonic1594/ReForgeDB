"use strict"
// The database is unreachable when the bot starts, then comes back.
const { test, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const { boot, tmpDir, external, kind } = require("./fixtures/harness")

let h
let unhandled = 0
process.on("unhandledRejection", () => unhandled++)
after(async () => {
    await h?.DataBase.close()
})

const errorOf = async (code) => h.run(`$try[${code};$env[e;message];e]`)

if (!external) {
    // SQLite: the "folder" is a file, so the database cannot be opened until it is removed.
    const base = tmpDir()
    const blocked = path.join(base, "data")
    fs.writeFileSync(blocked, "not a folder")

    test("an unreachable database does not crash the bot; functions fail with a clear, catchable error", async () => {
        h = await boot({ dir: blocked, wait: false, readyTimeout: 300, logLevel: "info", events: ["connect"] })
        assert.equal(h.DataBase.connected, false)
        // ForgeDB: an unhandled rejection at start-up (which ends the process),
        // then "Cannot read properties of undefined" on every function.
        const started = Date.now()
        const message = await errorOf("$getUserVar[coins]")
        assert.match(message, /\[ReForgeDB\] The database is not connected yet \(waited 300 ms\)\. Last error: /)
        assert.ok(Date.now() - started >= 250, "the function waited for the connection first")
        assert.match(await errorOf("$setUserVar[coins;1]"), /not connected yet/)
        assert.match(await errorOf("$userLeaderboard[coins]"), /not connected yet/)
        assert.match(await errorOf("$dbUserCooldown[x;1h]"), /not connected yet/)
        assert.match(await errorOf("$dbPing"), /not connected yet/)
        // Without $try the user is told, instead of the command dying silently.
        assert.match((await h.exec("$getUserVar[coins]")).sent[0], /not connected yet/)
        await assert.rejects(h.DataBase.ready(50), /not connected yet \(waited 50 ms\)/)
        await assert.rejects(h.lib.ReForgeDB.ready(50), /not connected yet/)
        assert.ok(h.logsOf("error").some((l) => /Could not connect to the database \(attempt 1\), retrying in 1s/.test(l)))
    })

    test("it keeps retrying and connects once the database is reachable", async () => {
        let connects = 0
        h.extension.emitter.on("connect", () => connects++)
        fs.rmSync(blocked)
        await h.DataBase.ready(15_000)
        assert.equal(h.DataBase.connected, true)
        assert.equal(connects, 1)
        assert.ok(h.logsOf("info").some((l) => /Connected to (better-)?sqlite3? after \d+ attempts/.test(l)))
        assert.equal(await h.run("$setUserVar[coins;5]$getUserVar[coins]"), "5")
        assert.ok(fs.existsSync(path.join(blocked, "reforge.db")))
    })

    test("calls made while it was down, with time left to wait, complete once it is up", async () => {
        // Covered by the wait itself: ready() resolves every waiter on connect.
        await Promise.all([h.DataBase.ready(), h.DataBase.ready(1), h.lib.ReForgeDB.ready()])
    })
} else {
    test("an unreachable server does not crash the bot; functions fail with a clear, catchable error", async () => {
        // Nothing listens on port 1.
        const unreachable = kind === "mongodb" ? { url: "mongodb://127.0.0.1:1/reforgedb_test", typeorm: { extra: { serverSelectionTimeoutMS: 200 } } } : { port: 1, host: "127.0.0.1", url: undefined }
        h = await boot({ ...unreachable, wait: false, readyTimeout: 400, logLevel: "info" })
        const message = await errorOf("$getUserVar[coins]")
        assert.match(message, /\[ReForgeDB\] The database is not connected yet \(waited 400 ms\)/)
        assert.match((await h.exec("$setUserVar[coins;1]")).sent[0], /not connected yet/)
        await assert.rejects(h.DataBase.ready(50), /not connected yet/)
        assert.ok(h.logsOf("error").some((l) => /Could not connect to the database \(attempt 1\), retrying in 1s/.test(l)))
    })
}

test("closing stops the retries and background work", async () => {
    await h.DataBase.close()
    assert.equal(h.DataBase.connected, false)
    assert.equal(h.DataBase.dataSource, null)
})

test("nothing was left as an unhandled rejection", async () => {
    await new Promise((r) => setTimeout(r, 50))
    assert.equal(unhandled, 0)
})
