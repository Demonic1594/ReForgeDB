"use strict"
// Backups ($dbBackup, client.db.backup: SQLite) and export/import (every
// database): complete, consistent, never overwriting, refusing paths outside
// the backups folder, and writing nothing from invalid data.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const { boot, tmpDir, ids, kind } = require("./fixtures/harness")

const dir = tmpDir()
let h, DB
before(async () => {
    h = await boot({ dir, logLevel: "warn", cooldownSweepInterval: 0 })
    DB = h.DataBase
})
after(async () => {
    await DB.wipe()
    await DB.cdWipe()
    await DB.close()
})

async function seed() {
    await DB.wipe()
    await DB.cdWipe()
    await h.run("$setUserVar[coins;150]$setMemberVar[xp;20]$setGuildVar[prefix;!]$setGlobalVar[motd;héllo 🌍]$dbUserCooldown[daily;1h]$globalCooldown[event;2h]")
    for (const [name, value] of Object.entries({ json: JSON.stringify({ a: [1, { b: null }] }), sql: "'); DROP TABLE record; --", lines: "a\nb\r\nc", empty: "" })) {
        await DB.set({ name, id: "odd", type: "custom", value })
    }
}

const sortBy = (rows) => [...rows].sort((a, b) => (a.identifier < b.identifier ? -1 : 1))

test("export, wipe, import: every variable and cooldown comes back exactly, cooldowns still running", async () => {
    await seed()
    const exported = await DB.export()
    assert.equal(exported.format, "reforge.db")
    assert.equal(exported.records.length, 8)
    assert.equal(exported.cooldowns.length, 2)
    // It is plain JSON: the text form imports the same.
    const text = JSON.stringify(exported)
    await DB.wipe()
    await DB.cdWipe()
    const result = await DB.import(text)
    assert.deepEqual(result, { records: { created: 8, overwritten: 0, skipped: 0 }, cooldowns: { created: 2, overwritten: 0, skipped: 0 } })
    const again = await DB.export()
    assert.deepEqual(sortBy(again.records), sortBy(exported.records))
    assert.deepEqual(sortBy(again.cooldowns), sortBy(exported.cooldowns))
    assert.equal(await h.run("$getUserVar[coins]"), "150")
    assert.equal((await h.exec("$dbUserCooldown[daily;1h;running]")).sent[0], "running", "the imported cooldown still runs")
})

test("import keeps existing data unless overwrite is set", async () => {
    await seed()
    const exported = await DB.export()
    await h.run("$setUserVar[coins;999]$setUserVar[new;1]")
    const kept = await DB.import(exported)
    assert.deepEqual(kept.records, { created: 0, overwritten: 0, skipped: 8 })
    assert.equal(await h.run("$getUserVar[coins]"), "999", "kept")
    const replaced = await DB.import(exported, { overwrite: true })
    assert.deepEqual(replaced.records, { created: 0, overwritten: 8, skipped: 0 })
    assert.equal(await h.run("$getUserVar[coins]"), "150", "overwritten")
    assert.equal(await h.run("$getUserVar[new]"), "1", "variables that are not in the export are left alone")
})

test("invalid data writes nothing and says what is wrong", async () => {
    await seed()
    const before = await DB.export()
    const good = before.records[0]
    const bad = [
        "not json {",
        JSON.stringify({ hello: 1 }),
        { ...before, version: 2 },
        { ...before, records: "nope" },
        // One bad row among good ones: nothing is written, not even the good ones.
        { ...before, records: [{ ...good, identifier: "brand_new_1" }, { ...good, identifier: "brand_new_2", type: "planet" }] },
        { ...before, records: [], cooldowns: [{ identifier: "c", name: "c", id: null, startedAt: -5, duration: 1.5 }] },
        { ...before, records: [{ ...good, identifier: "x", value: { $gt: "" } }] },
    ]
    for (const input of bad) await assert.rejects(DB.import(input), /import\(\)/)
    await assert.rejects(DB.import({ ...before, records: Array.from({ length: 30 }, (_, i) => ({ ...good, identifier: "", name: i })) }), /60 problem\(s\).*and 50 more/)
    const after = await DB.export()
    assert.deepEqual(sortBy(after.records), sortBy(before.records))
    assert.deepEqual(sortBy(after.cooldowns), sortBy(before.cooldowns))
})

test("import refreshes caches: leaderboards and cooldown guesses see the imported data", async () => {
    await DB.wipe()
    await DB.cdWipe()
    await h.run("$setUserVar[lb;5]")
    assert.match(await h.run("$userLeaderboard[lb]"), /5/)
    const exported = await DB.export()
    exported.records = exported.records.map((r) => ({ ...r, value: "77" }))
    exported.cooldowns = [{ identifier: `cd_${ids.user}`, name: "cd", id: ids.user, startedAt: Date.now(), duration: 3_600_000 }]
    await DB.import(exported, { overwrite: true })
    assert.match(await h.run("$userLeaderboard[lb]"), /77/)
    assert.equal((await h.exec("$dbUserCooldown[cd;1h;running]")).sent[0], "running")
})

if (kind === "sqlite") {
    const backups = () => path.join(dir, "backups")

    test("$dbBackup writes a complete, standalone copy into backups/, and never overwrites one", async () => {
        await seed()
        const file = await h.run("$dbBackup[nightly]")
        assert.equal(file, path.join(backups(), "nightly.db"))
        const Raw = require("better-sqlite3")
        const copy = new Raw(file, { readonly: true })
        assert.equal(copy.prepare("select count(*) n from record").get().n, 8)
        assert.equal(copy.prepare("select count(*) n from cooldown").get().n, 2)
        assert.equal(copy.prepare("pragma integrity_check").get().integrity_check, "ok")
        copy.close()
        assert.ok(!fs.existsSync(file + "-wal"), "no write-ahead log next to the copy")
        const size = fs.statSync(file).size
        const second = await h.exec("$try[$dbBackup[nightly];$env[error;message];error]")
        assert.match(second.output, /already exists; a backup never overwrites a file/)
        assert.equal(fs.statSync(file).size, size)
        // Without a name: a dated file.
        assert.match(path.basename(await h.run("$dbBackup")), /^reforge-\d{4}-\d{2}-\d{2}T[\d-]+Z\.db$/)
    })

    test("$dbBackup refuses names that leave the backups folder", async () => {
        const outside = fs.readdirSync(dir)
        for (const name of ["../escape", "../../etc/x", "a/b", ".hidden", "..", "x".repeat(200), "/abs/path"]) {
            const out = await h.exec(`$try[$dbBackup[${name}];$env[error;message];error]`)
            assert.match(out.output, /is not a plain file name/, name)
        }
        assert.deepEqual(fs.readdirSync(dir), outside, "nothing was written next to the database")
    })

    test("client.db.backup() never writes over the database itself, and takes a consistent copy during writes", async () => {
        await assert.rejects(DB.backup(DB.dataSource.options.database), /cannot be written over the database itself|already exists/)
        let writing = true
        let written = 0
        const writer = (async () => {
            while (writing) await DB.set({ name: "w", id: String(written++), type: "custom", value: "x" })
        })()
        const file = await DB.backup(path.join(tmpDir(), "during.db"))
        writing = false
        await writer
        const copy = new (require("better-sqlite3"))(file, { readonly: true })
        assert.equal(copy.prepare("pragma integrity_check").get().integrity_check, "ok")
        assert.ok(copy.prepare("select count(*) n from record where name = 'w'").get().n <= written)
        copy.close()
    })
} else {
    test("backups are SQLite only: elsewhere a catchable error names export()", async () => {
        const out = await h.exec("$try[$dbBackup;$env[error;message];error]")
        assert.match(out.output, /client\.db\.export\(\)/)
    })
}
