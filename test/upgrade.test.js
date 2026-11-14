"use strict"
// Opens a database exactly as ForgeDB 2.1.1 created it (same tables, same
// keys) and checks that ReForgeDB upgrades it in place without losing data.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const path = require("path")
const { DataSource } = require("typeorm")
const { boot, ids, tmpDir, dbOptions, kind } = require("./fixtures/harness")

// The tables ForgeDB 2.1.1 creates (captured from a database it made).
const SCHEMA = {
    sqlite: [
        `CREATE TABLE "record" ("identifier" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "id" varchar, "type" varchar NOT NULL, "value" varchar NOT NULL, "guildId" varchar)`,
        `CREATE TABLE "cooldown" ("identifier" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "id" varchar, "startedAt" integer NOT NULL, "duration" integer NOT NULL)`,
    ],
    postgres: [
        `CREATE TABLE "record" ("identifier" character varying NOT NULL, "name" character varying NOT NULL, "id" character varying, "type" character varying NOT NULL, "value" text NOT NULL, "guildId" character varying, CONSTRAINT "PK_bbe1563f22c52e5401ba26abc39" PRIMARY KEY ("identifier"))`,
        `CREATE TABLE "cooldown" ("identifier" character varying NOT NULL, "name" character varying NOT NULL, "id" character varying, "startedAt" integer NOT NULL, "duration" integer NOT NULL, CONSTRAINT "PK_3cdf37f16255af598e068be7f53" PRIMARY KEY ("identifier"))`,
    ],
    mysql: [
        "CREATE TABLE `record` (`identifier` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `id` varchar(255) DEFAULT NULL, `type` varchar(255) NOT NULL, `value` longtext NOT NULL, `guildId` varchar(255) DEFAULT NULL, PRIMARY KEY (`identifier`)) ENGINE=InnoDB",
        "CREATE TABLE `cooldown` (`identifier` varchar(255) NOT NULL, `name` varchar(255) NOT NULL, `id` varchar(255) DEFAULT NULL, `startedAt` int(11) NOT NULL, `duration` int(11) NOT NULL, PRIMARY KEY (`identifier`)) ENGINE=InnoDB",
    ],
}

// Rows as ForgeDB wrote them: [identifier, name, id, type, value, guildId].
const ROWS = [
    [`user_coins_${ids.user}`, "coins", ids.user, "user", "150", null],
    [`user_coins_${ids.user2}`, "coins", ids.user2, "user", "75", null],
    [`user_coins_${ids.user3}`, "coins", ids.user3, "user", "not a number", null],
    [`member_xp_${ids.guild}_${ids.user}`, "xp", ids.user, "member", "42", ids.guild],
    [`guild_prefix_${ids.guild}`, "prefix", ids.guild, "guild", "?", null],
    ["custom_motd_undefined", "motd", null, "custom", 'héllo 🎉 "quoted"', null],
    [`channel_topic_${ids.guild}_${ids.channel}`, "topic", ids.channel, "channel", '{"a":1}', ids.guild],
    [`channel_dm_undefined_${ids.dm}`, "dm", ids.dm, "channel", "in a DM", null],
    [`role_color_${ids.guild}_${ids.role}`, "color", ids.role, "role", "red", ids.guild],
    [`message_poll_${ids.message}`, "poll", ids.message, "message", "open", null],
    ["old_legacy_abc", "legacy", "abc", "old", "old-value", null],
    // What ForgeDB's empty-ID bug left behind: reachable and removable.
    ["user_coins_", "coins", "", "user", "orphan", null],
]

const dir = tmpDir()
const options = dbOptions(dir)
let h, DB

async function raw() {
    const o = { ...options }
    // ForgeDB's file name: ReForgeDB renames it to reforge.db on first start.
    if (kind === "sqlite") o.database = path.join(dir, "forge.db")
    delete o.folder
    return new DataSource({ ...o, entities: [], synchronize: false }).initialize()
}

/** The collections as ForgeDB wrote them on MongoDB (TypeORM save of MongoRecord / MongoCooldown). */
async function seedMongo(db) {
    const mongo = db.driver.queryRunner.databaseConnection.db(db.driver.database)
    for (const name of ["mongo_record", "mongo_cooldown"]) await mongo.collection(name).drop().catch(() => undefined)
    const docs = ROWS.map(([identifier, name, id, type, value, guildId]) => {
        const doc = { identifier, name, type, value }
        if (id !== null) doc.id = id
        if (guildId !== null) doc.guildId = guildId
        return doc
    })
    // ForgeDB read and then wrote, so two first writes at once could both
    // insert: a second document for a key that already has one.
    docs.push({ identifier: `user_coins_${ids.user}`, name: "coins", id: ids.user, type: "user", value: "999" })
    docs.push({ identifier: `user_coins_${ids.user}`, name: "coins", id: ids.user, type: "user", value: "998" })
    await mongo.collection("mongo_record").insertMany(docs)
    // Cooldowns worked on MongoDB (numbers are 64-bit floats there).
    await mongo.collection("mongo_cooldown").insertMany([
        { identifier: `daily_${ids.user}`, name: "daily", id: ids.user, startedAt: Date.now(), duration: 3_600_000 },
        { identifier: `daily_${ids.user}`, name: "daily", id: ids.user, startedAt: 0, duration: 1 },
    ])
}

before(async () => {
    const db = await raw()
    if (kind === "mongodb") {
        await seedMongo(db)
        await db.destroy()
        h = await boot({ dir, keep: true, logLevel: "info" })
        DB = h.DataBase
        return
    }
    const q = (name) => db.driver.escape(name)
    await db.query(`DROP TABLE IF EXISTS ${q("record")}`)
    await db.query(`DROP TABLE IF EXISTS ${q("cooldown")}`)
    for (const ddl of SCHEMA[kind]) await db.query(ddl)
    const p = (i) => db.driver.createParameter("p", i)
    for (const row of ROWS) {
        await db.query(`INSERT INTO ${q("record")} (${["identifier", "name", "id", "type", "value", "guildId"].map(q).join(", ")}) VALUES (${row.map((_, i) => p(i)).join(", ")})`, row)
    }
    if (kind === "sqlite") {
        // Only SQLite could store a cooldown in ForgeDB (64-bit integers).
        await db.query(`INSERT INTO "cooldown" ("identifier", "name", "id", "startedAt", "duration") VALUES (?, ?, ?, ?, ?)`, [`daily_${ids.user}`, "daily", ids.user, Date.now(), 3_600_000])
    }
    if (kind === "mysql") {
        // A MySQL server without strict mode clamped the timestamp instead of failing.
        await db.query("SET SESSION sql_mode = ''")
        await db.query("INSERT INTO `cooldown` (`identifier`, `name`, `id`, `startedAt`, `duration`) VALUES ('clamped_1', 'clamped', '1', 2147483647, 2147483647)")
    }
    await db.destroy()
    h = await boot({ dir, keep: true, logLevel: "info" })
    DB = h.DataBase
})
after(async () => {
    await DB?.wipe()
    await DB?.cdWipe()
    await DB?.close()
})

if (kind === "sqlite") test("SQLite: ForgeDB's forge.db was renamed to reforge.db", () => {
    const fs = require("fs")
    assert.ok(fs.existsSync(path.join(dir, "reforge.db")))
    assert.ok(!fs.existsSync(path.join(dir, "forge.db")))
    assert.ok(h.logsOf("info").some((l) => l.includes(`Renamed ${path.join(dir, "forge.db")} to ${path.join(dir, "reforge.db")}`)))
})

test("every ForgeDB record is still there, unchanged", async () => {
    const all = await DB.getAll()
    assert.equal(all.length, ROWS.length)
    const byKey = new Map(all.map((r) => [r.identifier, r]))
    for (const [identifier, name, id, type, value, guildId] of ROWS) {
        const r = byKey.get(identifier)
        assert.ok(r, identifier)
        assert.deepEqual([r.name, r.id ?? null, r.type, r.value, r.guildId ?? null], [name, id, type, value, guildId], identifier)
    }
})

test("the functions find ForgeDB's data under the same keys", async () => {
    const { run } = h
    assert.equal(await run("$getUserVar[coins]"), "150")
    assert.equal(await run(`$getUserVar[coins;${ids.user2}]`), "75")
    assert.equal(await run("$getMemberVar[xp]"), "42")
    assert.equal(await run("$getGuildVar[prefix]"), "?")
    assert.equal(await run("$getGlobalVar[motd]"), 'héllo 🎉 "quoted"')
    assert.equal(await run("$getChannelVar[topic]"), '{"a":1}')
    assert.equal(await run("$getChannelVar[dm]", { obj: h.cache.dmMessage }), "in a DM")
    assert.equal(await run(`$getRoleVar[color;${ids.role}]`), "red")
    assert.equal(await run("$getMessageVar[poll]"), "open")
    assert.equal(await run("$getVar[legacy;abc]"), "old-value")
    assert.equal(await run("$userLeaderboard[coins]"), "1. alice ~ 150\n2. bob ~ 75")
    // Updating a ForgeDB row updates it in place.
    assert.equal(await run("$setUserVar[coins;200]$getUserVar[coins]"), "200")
    assert.equal((await DB.find({ name: "coins", id: ids.user })).length, 1)
})

test("rows written by ForgeDB's empty-ID bug can be found and removed", async () => {
    const orphans = JSON.parse(await h.run("$searchDB[coins;;user;orphan]"))
    assert.deepEqual(orphans.map((r) => r.identifier), ["user_coins_"])
    await h.run("$deleteRecords[coins;;user;orphan]")
    assert.equal(await DB.get({ identifier: "user_coins_" }), null)
})

test("cooldowns work after the upgrade, for any duration", async () => {
    if (kind === "sqlite" || kind === "mongodb") {
        // SQLite and MongoDB cooldowns made by ForgeDB keep running.
        const left = (await DB.cdTimeLeft(`daily_${ids.user}`)).left
        assert.ok(left > 3_500_000 && left <= 3_600_000, String(left))
        assert.equal((await h.exec("$dbUserCooldown[daily;1h;still running]x")).sent[0], "still running")
    }
    // On MySQL and PostgreSQL every cooldown write failed in ForgeDB
    // ("out of range for type integer"): the columns are 64-bit now.
    assert.equal((await h.exec("$dbUserCooldown[monthly;30d;no]ok")).output, "ok")
    const left = Number(await h.run("$dbGetUserCooldownTime[monthly]"))
    assert.ok(left > 30 * 86_400_000 - 5000 && left <= 30 * 86_400_000, String(left))
    const stored = await DB.cdTimeLeft(`monthly_${ids.user}`)
    assert.equal(typeof stored.startedAt, "number")
    assert.equal(typeof stored.duration, "number")
    assert.ok(Math.abs(stored.startedAt - Date.now()) < 5000)
    if (kind === "mysql") {
        // The clamped row was never a valid cooldown; it reads as expired and is swept.
        assert.equal((await DB.cdTimeLeft("clamped_1")).left, 0)
        assert.ok((await DB.sweepCooldowns()) >= 1)
    }
})

if (kind === "mongodb") {
    test("MongoDB: duplicate documents of a key are removed, keeping the one ForgeDB read", async () => {
        const mongo = DB.dataSource.driver.queryRunner.databaseConnection.db(DB.dataSource.driver.database)
        assert.equal(await mongo.collection("mongo_record").countDocuments({ identifier: `user_coins_${ids.user}` }), 1)
        assert.equal((await DB.get({ name: "coins", id: ids.user, type: "user" })).value, "200", "the kept document is the one that was updated")
        assert.equal(await mongo.collection("mongo_cooldown").countDocuments({ identifier: `daily_${ids.user}` }), 1)
        assert.ok(h.logsOf("warn").some((l) => /Removed 2 duplicate document\(s\) of 1 key\(s\) from mongo_record/.test(l)))
        assert.ok(h.logsOf("warn").some((l) => /Removed 1 duplicate document\(s\) of 1 key\(s\) from mongo_cooldown/.test(l)))
    })

    test("MongoDB: the keys have unique indexes, plus the leaderboard index", async () => {
        const mongo = DB.dataSource.driver.queryRunner.databaseConnection.db(DB.dataSource.driver.database)
        const records = await mongo.collection("mongo_record").indexes()
        const cooldowns = await mongo.collection("mongo_cooldown").indexes()
        const find = (list, name) => list.find((i) => i.name === name)
        assert.deepEqual(find(records, "UQ_mongo_record_identifier")?.key, { identifier: 1 })
        assert.equal(find(records, "UQ_mongo_record_identifier")?.unique, true)
        assert.deepEqual(find(records, "IDX_record_name_type_guild")?.key, { name: 1, type: 1, guildId: 1 })
        assert.equal(find(cooldowns, "UQ_mongo_cooldown_identifier")?.unique, true)
        // A second document for a key is refused by the database itself now.
        await assert.rejects(mongo.collection("mongo_record").insertOne({ identifier: `user_coins_${ids.user}`, name: "coins", type: "user", value: "x" }), /duplicate key/)
    })
}

if (kind !== "mongodb") test("the schema: same tables and columns, plus the leaderboard index", async () => {
    const db = DB.dataSource
    const runner = db.createQueryRunner()
    try {
        const record = await runner.getTable("record")
        const cooldown = await runner.getTable("cooldown")
        assert.deepEqual(record.columns.map((c) => c.name).sort(), ["guildId", "id", "identifier", "name", "type", "value"])
        assert.deepEqual(cooldown.columns.map((c) => c.name).sort(), ["duration", "id", "identifier", "name", "startedAt"])
        assert.ok(record.indices.some((i) => i.name === "IDX_record_name_type_guild" && i.columnNames.join() === "name,type,guildId"))
        const type = (name) => cooldown.columns.find((c) => c.name === name).type
        if (kind === "sqlite") assert.deepEqual([type("startedAt"), type("duration")], ["integer", "integer"], "SQLite columns are untouched")
        else assert.deepEqual([type("startedAt"), type("duration")], ["bigint", "bigint"])
        // The value column keeps its type: changing it would drop the data.
        const value = record.columns.find((c) => c.name === "value").type
        assert.equal(value, { sqlite: "varchar", postgres: "text", mysql: "longtext" }[kind])
    } finally {
        await runner.release()
    }
})

test("starting again changes nothing (the upgrade happens once)", async () => {
    const db = DB.dataSource
    const pending = await db.driver.createSchemaBuilder().log()
    assert.deepEqual(pending.upQueries.map((q) => q.query), [])
})
