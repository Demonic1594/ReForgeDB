"use strict"
// SQLite: which file is opened when ForgeDB's forge.db is in the folder, and
// the forgeDBFile option (use, copy, rename, ignore). Runs on SQLite only.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { DataSource, EntitySchema } = require("typeorm")
const { boot, lib, kind, tmpDir } = require("./fixtures/harness")

if (kind === "sqlite") {
    let h
    before(async () => {
        h = await boot({ logLevel: "info" })
    })
    after(async () => {
        await h.DataBase.close()
    })

    const Note = new EntitySchema({ name: "RfdbFileNote", tableName: "note", columns: { id: { type: String, primary: true } } })
    const seed = async (file, ids) => {
        const db = await new DataSource({ type: "sqlite", database: file, entities: [Note], synchronize: true }).initialize()
        for (const id of ids) await db.getRepository(Note).save({ id })
        await db.destroy()
    }
    const notes = async (db) => (await db.getRepository(Note).find()).map((r) => r.id).sort()

    let n = 0
    /** A manager whose file is `new<n>.db`, previously `old<n>.db`, like ReForgeDB's own. */
    function manager(action) {
        n++
        const names = { previous: `old${n}.db`, current: `new${n}.db` }
        class Moved extends lib.DataBaseManager {
            database = names.current
            previousDatabase = names.previous
            entityManager = { sqlite: [Note], mysql: [Note], postgres: [Note], mongodb: [Note] }
            connect() {
                return this.getDB()
            }
        }
        const m = new Moved()
        if (action) m.previousDatabaseAction = action
        return { m, ...names, at: (name) => path.join(h.dir, name) }
    }

    test("ReForgeDB's own file is reforge.db, created when nothing is there", () => {
        assert.ok(fs.existsSync(path.join(h.dir, "reforge.db")))
        assert.ok(!fs.existsSync(path.join(h.dir, "forge.db")))
        assert.equal(h.DataBase.dataSource.options.database, path.join(h.dir, "reforge.db"))
    })

    test("use (the default): the old file is opened where it is, nothing is moved", async () => {
        const { m, previous, current, at } = manager()
        assert.equal(m.previousDatabaseAction, "use")
        await seed(at(previous), ["kept"])
        const db = await m.connect()
        assert.equal(db.options.database, at(previous))
        assert.deepEqual(await notes(db), ["kept"])
        assert.ok(!fs.existsSync(at(current)), "no new file")
        assert.ok(h.logsOf("info").some((l) => l.includes(`Using ${at(previous)}. To move it to ${at(current)}, see the forgeDBFile option.`)))
    })

    test("copy: the data is copied, the old file is kept as it was", async () => {
        const { m, previous, current, at } = manager("copy")
        await seed(at(previous), ["kept"])
        const before = fs.readFileSync(at(previous))
        const db = await m.connect()
        assert.equal(db.options.database, at(current))
        assert.deepEqual(await notes(db), ["kept"])
        await db.getRepository(Note).save({ id: "new" })
        assert.ok(fs.readFileSync(at(previous)).equals(before), "the old file is untouched")
        assert.ok(h.logsOf("info").some((l) => l.includes(`Copied ${at(previous)} to ${at(current)}; ${at(previous)} is kept as it was`)))
    })

    test("copy: side files are copied too, and leftovers of an interrupted copy are replaced", async () => {
        const { m, previous, current, at } = manager("copy")
        await seed(at(previous), ["kept"])
        fs.writeFileSync(at(previous + "-journal"), "")
        fs.writeFileSync(at(current + "-journal"), "left over")
        const db = await m.connect()
        assert.deepEqual(await notes(db), ["kept"])
        assert.ok(fs.existsSync(at(previous + "-journal")), "the old side file stays")
    })

    test("rename: the file and its side files move", async () => {
        const { m, previous, current, at } = manager("rename")
        await seed(at(previous), ["kept"])
        fs.writeFileSync(at(previous + "-wal"), "")
        fs.writeFileSync(at(previous + "-journal"), "")
        const db = await m.connect()
        assert.equal(db.options.database, at(current))
        assert.deepEqual(await notes(db), ["kept"])
        for (const f of [previous, previous + "-wal", previous + "-journal"]) assert.ok(!fs.existsSync(at(f)), f)
        assert.ok(h.logsOf("info").some((l) => l.includes(`Renamed ${at(previous)} to ${at(current)}`)))
    })

    test("rename: an interrupted rename (side files already moved) is finished", async () => {
        const { m, previous, current, at } = manager("rename")
        await seed(at(previous), ["kept"])
        fs.writeFileSync(at(current + "-journal"), "")
        const db = await m.connect()
        assert.deepEqual(await notes(db), ["kept"])
        assert.ok(!fs.existsSync(at(previous)))
    })

    test("ignore: a new, empty file is used and the old one is left alone", async () => {
        const { m, previous, current, at } = manager("ignore")
        await seed(at(previous), ["kept"])
        const before = fs.readFileSync(at(previous))
        const db = await m.connect()
        assert.equal(db.options.database, at(current))
        assert.deepEqual(await notes(db), [])
        assert.ok(fs.readFileSync(at(previous)).equals(before))
    })

    test("when both files exist, the new one is used whatever the setting", async () => {
        for (const action of ["use", "copy", "rename", "ignore"]) {
            const { m, previous, current, at } = manager(action)
            await seed(at(current), ["current"])
            fs.writeFileSync(at(previous), "the old file")
            const db = await m.connect()
            assert.equal(db.options.database, at(current), action)
            assert.deepEqual(await notes(db), ["current"], action)
            assert.equal(fs.readFileSync(at(previous), "utf8"), "the old file", action)
        }
        assert.ok(h.logsOf("warn").some((l) => /Both .* and .* exist\. Using/.test(l)))
    })

    test("a copy or rename that fails is reported with what to do, and nothing is lost", async () => {
        for (const action of ["copy", "rename"]) {
            const { m, previous, current, at } = manager(action)
            await seed(at(previous), ["kept"])
            const real = { renameSync: fs.renameSync, copyFileSync: fs.copyFileSync }
            const denied = () => {
                throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
            }
            fs.renameSync = denied
            fs.copyFileSync = denied
            try {
                await assert.rejects(m.connect(), (err) => err.name === "ReForgeDBError" && err.message.includes(`Could not ${action} ${at(previous)} to ${at(current)}: EACCES`) && err.message.includes(`or ${action} it yourself`))
            } finally {
                Object.assign(fs, real)
            }
            assert.ok(fs.existsSync(at(previous)), "the old file is still there")
            assert.ok(!fs.existsSync(at(current)))
        }
    })

    // The forgeDBFile option itself, end to end. ReForgeDB's configuration is
    // per process, so each case runs in a fresh one.
    function startWith(forgeDBFile, files = { "forge.db": ["150"] }) {
        const folder = tmpDir()
        return (async () => {
            for (const [file, values] of Object.entries(files)) {
                const db = await new DataSource({ type: "sqlite", database: path.join(folder, file), entities: [require("../dist/util/types").SQLiteRecord], synchronize: true }).initialize()
                for (const value of values) await db.getRepository(require("../dist/util/types").SQLiteRecord).save({ identifier: "user_coins_1", name: "coins", id: "1", type: "user", value })
                await db.destroy()
            }
            const out = spawnSync(process.execPath, [path.join(__dirname, "fixtures", "boot-file.js"), folder, forgeDBFile ?? ""], { encoding: "utf8", timeout: 30_000 })
            const result = JSON.parse(out.stdout.trim().split("\n").pop())
            return { ...result, folder, exists: (f) => fs.existsSync(path.join(folder, f)) }
        })()
    }

    test("forgeDBFile not set: ForgeDB's data is used in forge.db, nothing is moved", async () => {
        const r = await startWith(undefined)
        assert.equal(r.file, "forge.db")
        assert.equal(r.coins, "150")
        assert.ok(!r.exists("reforge.db"))
        assert.ok(r.logs.some((l) => l.includes("To move it to") && l.includes("see the forgeDBFile option")))
    })

    test('forgeDBFile: "copy" / "rename" / "ignore"', async () => {
        const copy = await startWith("copy")
        assert.deepEqual([copy.file, copy.coins, copy.exists("forge.db")], ["reforge.db", "150", true])
        const rename = await startWith("rename")
        assert.deepEqual([rename.file, rename.coins, rename.exists("forge.db")], ["reforge.db", "150", false])
        const ignore = await startWith("ignore")
        assert.deepEqual([ignore.file, ignore.coins, ignore.exists("forge.db")], ["reforge.db", null, true])
    })

    test("a new install creates reforge.db; an existing reforge.db is always used", async () => {
        const fresh = await startWith(undefined, {})
        assert.deepEqual([fresh.file, fresh.coins, fresh.exists("forge.db")], ["reforge.db", null, false])
        const both = await startWith("rename", { "forge.db": ["150"], "reforge.db": ["300"] })
        assert.deepEqual([both.file, both.coins, both.exists("forge.db")], ["reforge.db", "300", true])
    })

    test("an unknown forgeDBFile is refused at start-up", () => {
        assert.throws(() => new lib.ReForgeDB({ type: "sqlite", forgeDBFile: "move" }), /Unknown forgeDBFile "move"\. Use use, copy, rename or ignore\./)
    })
}
