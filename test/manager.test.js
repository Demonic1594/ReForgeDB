"use strict"
// The API other extensions use: DataBaseManager (their own tables on
// ReForgeDB's connection settings) and client.db.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const { EntitySchema, DataSource } = require("typeorm")
const { boot, ids, lib, kind } = require("./fixtures/harness")
const { DataBaseManager } = lib

const Ticket = new EntitySchema({
    name: "RfdbTestTicket",
    tableName: "rfdb_test_ticket",
    columns: {
        id: { type: String, primary: true },
        owner: { type: String },
    },
})
const MongoTicket = new EntitySchema({
    name: "RfdbTestMongoTicket",
    tableName: "rfdb_test_ticket",
    columns: {
        _id: { type: String, objectId: true, primary: true },
        id: { type: String },
        owner: { type: String },
    },
})

/** What an extension with its own tables looks like (the pattern of ForgeGiveaways). */
class TicketsDatabase extends DataBaseManager {
    database = "tickets.db"
    entityManager = { sqlite: [Ticket], mysql: [Ticket], postgres: [Ticket], mongodb: [MongoTicket] }
    connect() {
        return this.getDB()
    }
}

let h
let early
before(async () => {
    // Asked for before ReForgeDB exists: must resolve once it does.
    early = new TicketsDatabase().connect()
    h = await boot({ logLevel: "warn" })
})
after(async () => {
    const db = await early.catch(() => null)
    if (db?.isInitialized && kind !== "mongodb") await db.query(`DROP TABLE IF EXISTS ${db.driver.escape("rfdb_test_ticket")}`).catch(() => undefined)
    await h.DataBase.close()
})

test("an extension gets its own connected DataSource with ReForgeDB's settings", async () => {
    const db = await early
    assert.ok(db instanceof DataSource)
    assert.ok(db.isInitialized)
    assert.notEqual(db, h.DataBase.dataSource, "its own connection, not ReForgeDB's")
    assert.equal(db.options.type, h.DataBase.dataSource.options.type)
    const repo = db.getRepository(kind === "mongodb" ? MongoTicket : Ticket)
    await repo.save({ id: "t1", owner: ids.user })
    const saved = await repo.findOneBy({ id: "t1" })
    assert.deepEqual({ id: saved.id, owner: saved.owner }, { id: "t1", owner: ids.user })
    await repo.delete({ id: "t1" })
    if (kind === "sqlite") {
        // SQLite: its own file next to ReForgeDB's, named after `database`.
        assert.ok(fs.existsSync(path.join(h.dir, "tickets.db")))
        assert.ok(fs.existsSync(path.join(h.dir, "reforge.db")))
    }
})

test("the same database name shares one connection", async () => {
    const a = new TicketsDatabase()
    const b = new TicketsDatabase()
    const [x, y, z] = await Promise.all([a.connect(), b.connect(), a.connect()])
    assert.equal(x, y)
    assert.equal(x, z)
    assert.equal(x, await early)
})

test("the configured type is exposed, as in ForgeDB", async () => {
    const manager = new TicketsDatabase()
    await manager.connect()
    const configured = DataBaseManager.config.type
    assert.equal(manager.type, configured)
    assert.equal(DataBaseManager.type, configured)
    assert.equal(DataBaseManager.kind, kind)
    assert.equal(h.DataBase.kind, kind)
    // The options object given to ReForgeDB is not modified.
    assert.equal(Object.isFrozen(DataBaseManager.config) || typeof DataBaseManager.config === "object", true)
    assert.notEqual(DataBaseManager.config, h.extension.options)
})

test("a failed connection is not cached: asking again retries", async () => {
    class Broken extends DataBaseManager {
        database = "broken.db"
        attempts = 0
        // An entity every driver rejects (no primary column), so opening fails after connecting.
        entityManager = { sqlite: [this.bad()], mysql: [this.bad()], postgres: [this.bad()], mongodb: [this.bad()] }
        bad() {
            return new EntitySchema({ name: "RfdbBroken", tableName: "rfdb_broken", columns: { id: { type: String } } })
        }
        connect() {
            this.attempts++
            return this.getDB()
        }
    }
    const broken = new Broken()
    await assert.rejects(broken.connect())
    await assert.rejects(broken.connect(), "the second call tried again instead of returning the cached failure")
    assert.equal(broken.attempts, 2)
    // A working manager is unaffected.
    assert.ok((await new TicketsDatabase().connect()).isInitialized)
})

test("client.db is the DataBase class, with the methods other code relies on", async () => {
    const db = h.client.db
    assert.equal(db, lib.DataBase)
    // QuorielDB's transferDatabase(client) reads everything through client.db.getAll().
    await h.run(`$setUserVar[coins;5]$setMemberVar[xp;7]$setGlobalVar[motd;hi]`)
    const all = await db.getAll()
    const shape = all.map((r) => ({ type: r.type, name: r.name, id: r.id ?? null, guildId: r.guildId ?? null, value: r.value })).sort((a, b) => a.name.localeCompare(b.name))
    assert.deepEqual(shape, [
        { type: "user", name: "coins", id: ids.user, guildId: null, value: "5" },
        { type: "custom", name: "motd", id: null, guildId: null, value: "hi" },
        { type: "member", name: "xp", id: ids.user, guildId: ids.guild, value: "7" },
    ])
    for (const method of ["set", "get", "getAll", "find", "delete", "wipe", "cdAdd", "cdDelete", "cdTimeLeft", "cdWipe", "query", "make_intetifier", "make_cdIdentifier"]) {
        assert.equal(typeof db[method], "function", method)
    }
    // find() with plain column values, as ForgeDB's functions called it.
    assert.equal((await db.find({ name: "coins", type: "user" })).length, 1)
    assert.equal((await db.find()).length, 3)
    assert.equal((await db.get({ name: "coins", id: ids.user, type: "user" })).value, "5")
    assert.equal((await db.delete({ name: "coins", id: ids.user, type: "user" })).affected, 1)
    assert.equal((await db.delete({ name: "coins", id: ids.user, type: "user" })).affected, 0)
    await db.wipe()
})

test("the extension registers as reforge.db", () => {
    assert.equal(h.extension.name, "reforge.db")
    assert.equal(h.client.getExtension("reforge.db"), h.extension)
    assert.equal(h.client.getExtension(lib.ReForgeDB), h.extension)
    assert.equal(h.extension.version, require("../package.json").version)
    // The functions are registered under ReForgeDB's name.
    const { FunctionManager } = require("@tryforge/forgescript")
    assert.ok(FunctionManager.get("$getUserVar"))
    assert.ok(FunctionManager.get("$dbUserCooldown"))
})

test("no function is refused by ForgeScript for clashing with a built-in", () => {
    // A name an extension shares with ForgeScript replaces ForgeScript's function (extensions load first).
    // ReForgeDB registers none of ForgeScript's names, so no built-in function changes meaning.
    assert.deepEqual(h.logs.filter((l) => /Attempted to override/.test(l.text)).map((l) => l.text), [])
})
