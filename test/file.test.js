"use strict"
// SQLite: renaming a database file of a previous name (ForgeDB's forge.db)
// on first start. Runs on the default SQLite database only.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const { EntitySchema } = require("typeorm")
const { boot, lib, kind } = require("./fixtures/harness")

if (kind === "sqlite") {
    let h
    before(async () => {
        h = await boot({ logLevel: "info" })
    })
    after(async () => {
        await h.DataBase.close()
    })

    const Note = new EntitySchema({ name: "RfdbFileNote", tableName: "note", columns: { id: { type: String, primary: true } } })
    let n = 0
    /** A manager whose file moves from `<old>.db` to `<new>.db`, like ReForgeDB's own. */
    function manager() {
        n++
        const names = { previous: `old${n}.db`, current: `new${n}.db` }
        class Renamed extends lib.DataBaseManager {
            database = names.current
            previousDatabase = names.previous
            entityManager = { sqlite: [Note], mysql: [Note], postgres: [Note], mongodb: [Note] }
            connect() {
                return this.getDB()
            }
        }
        return { m: new Renamed(), ...names, at: (name) => path.join(h.dir, name) }
    }

    test("ReForgeDB's own file is reforge.db", () => {
        assert.ok(fs.existsSync(path.join(h.dir, "reforge.db")))
        assert.ok(!fs.existsSync(path.join(h.dir, "forge.db")))
        assert.equal(h.DataBase.dataSource.options.database, path.join(h.dir, "reforge.db"))
    })

    test("the old file and its side files are renamed, and the data is kept", async () => {
        const { m, previous, current, at } = manager()
        // An old database with data, and a WAL file and a journal next to it.
        const { DataSource } = require("typeorm")
        const seed = await new DataSource({ type: "sqlite", database: at(previous), entities: [Note], synchronize: true }).initialize()
        await seed.getRepository(Note).save({ id: "kept" })
        await seed.destroy()
        fs.writeFileSync(at(previous + "-wal"), "")
        fs.writeFileSync(at(previous + "-journal"), "")
        const db = await m.connect()
        assert.deepEqual((await db.getRepository(Note).find()).map((r) => r.id), ["kept"])
        assert.ok(fs.existsSync(at(current)))
        assert.ok(!fs.existsSync(at(previous)))
        assert.ok(!fs.existsSync(at(previous + "-wal")))
        assert.ok(!fs.existsSync(at(previous + "-journal")))
        assert.ok(h.logsOf("info").some((l) => l.includes(`Renamed ${at(previous)} to ${at(current)}`)))
    })

    test("an interrupted rename (side files already moved) is finished", async () => {
        const { m, previous, current, at } = manager()
        const { DataSource } = require("typeorm")
        const seed = await new DataSource({ type: "sqlite", database: at(previous), entities: [Note], synchronize: true }).initialize()
        await seed.getRepository(Note).save({ id: "kept" })
        await seed.destroy()
        // As if the previous start stopped after moving the journal.
        fs.writeFileSync(at(current + "-journal"), "")
        const db = await m.connect()
        assert.deepEqual((await db.getRepository(Note).find()).map((r) => r.id), ["kept"])
        assert.ok(!fs.existsSync(at(previous)))
    })

    test("when both files exist, the new one is used and the old one is left alone", async () => {
        const { m, previous, current, at } = manager()
        const { DataSource } = require("typeorm")
        const existing = await new DataSource({ type: "sqlite", database: at(current), entities: [Note], synchronize: true }).initialize()
        await existing.getRepository(Note).save({ id: "current" })
        await existing.destroy()
        fs.writeFileSync(at(previous), "the old file")
        const db = await m.connect()
        assert.deepEqual((await db.getRepository(Note).find()).map((r) => r.id), ["current"])
        assert.ok(h.logsOf("warn").some((l) => l.includes(`Both ${at(previous)} and ${at(current)} exist`)))
        assert.equal(db.options.database, at(current))
        assert.equal(fs.readFileSync(at(previous), "utf8"), "the old file")
        // Starting again with both present: warned, nothing moved.
        const { m: again } = manager()
        again.database = current
        again.previousDatabase = previous
        assert.equal(await again.connect(), db, "same connection, the file is not touched")
    })

    test("a new install creates the new file only", async () => {
        const { m, previous, current, at } = manager()
        await m.connect()
        assert.ok(fs.existsSync(at(current)))
        assert.ok(!fs.existsSync(at(previous)))
    })

    test("a rename that fails is reported with what to do", async () => {
        const { m, previous, current, at } = manager()
        fs.writeFileSync(at(previous), "")
        // The file is in use or not writable.
        const realRename = fs.renameSync
        fs.renameSync = () => {
            throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
        }
        try {
            await assert.rejects(m.connect(), (err) => err.name === "ReForgeDBError" && err.message.includes(`Could not rename ${at(previous)} to ${at(current)}: EACCES`) && /rename it yourself/.test(err.message))
        } finally {
            fs.renameSync = realRename
        }
        assert.ok(fs.existsSync(at(previous)), "nothing was lost")
    })
}
