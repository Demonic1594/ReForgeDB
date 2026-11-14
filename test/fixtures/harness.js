"use strict"
/*
 * Boots a real ForgeClient (it never logs in) with ReForgeDB, fills the
 * discord.js caches with real Guild/User/Member/Channel/Role/Message
 * structures, and runs ForgeScript code through the real compiler and
 * interpreter. Nothing in ReForgeDB is mocked.
 *
 * SQLite in a temp folder by default. To run against another database, put
 * the ReForgeDB options in REFORGEDB_TEST_DB, for example
 *   REFORGEDB_TEST_DB='{"type":"postgres","host":"127.0.0.1","username":"postgres","password":"postgres","database":"reforgedb_test"}'
 * (use a database made for the tests: it is wiped; its driver, e.g. `pg`,
 * must be installed).
 */
const fs = require("fs")
const os = require("os")
const path = require("path")
const { ForgeClient, Compiler, Interpreter, Logger, Container } = require("@tryforge/forgescript")
const { ChannelType } = require("discord.js")

const root = path.join(__dirname, "..", "..")
const lib = require(root)

const ids = {
    guild: "100000000000000001",
    guild2: "100000000000000002",
    user: "200000000000000001",
    user2: "200000000000000002",
    user3: "200000000000000003",
    channel: "300000000000000001",
    channel2: "300000000000000002",
    dm: "300000000000000009",
    role: "400000000000000001",
    message: "500000000000000001",
}

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "reforgedb-test-"))
}

/** The database the tests run on, when it is not the default SQLite file. */
const external = process.env.REFORGEDB_TEST_DB ? JSON.parse(process.env.REFORGEDB_TEST_DB) : null

const fileBased = (type) => type === "sqlite" || type === "better-sqlite3"

function dbOptions(dir, extra = {}) {
    // A file database in the environment (e.g. better-sqlite3) still gets its own temp folder.
    if (external) return fileBased(external.type) ? { folder: dir, ...external, ...extra } : { ...external, ...extra }
    return { type: "sqlite", folder: dir, ...extra }
}

/** Whether the tests run on a database server (shared between test files, so wiped at boot). */
const server = !!external && !fileBased(external.type)

/** The entity family the tests run on: sqlite, mysql, postgres or mongodb. */
const kind = !external || fileBased(external.type) ? "sqlite" : ["mysql", "mariadb"].includes(external.type) ? "mysql" : external.type

/** Captures ForgeScript Logger output (ReForgeDB logs through Logger.log). */
const logs = []
let captured = false
function captureLogs() {
    if (captured) return logs
    captured = true
    const { LogType } = require("@tryforge/forgescript")
    const orig = Logger.log
    Logger.log = function (priority, type, ...args) {
        const text = args.map((a) => (a instanceof Error ? a.stack : typeof a === "string" ? a : require("util").inspect(a))).join(" ")
        logs.push({ level: String(LogType[type] ?? type).toLowerCase(), text })
        if (process.env.REFORGEDB_TEST_VERBOSE) return orig.call(this, priority, type, ...args)
    }
    return logs
}

function fillCache(client) {
    const user = (id, username, bot = false) => client.users._add({ id, username, discriminator: "0", bot, avatar: null })
    const u1 = user(ids.user, "alice")
    const u2 = user(ids.user2, "bob")
    const u3 = user(ids.user3, "carol")
    const guildRaw = (id, name) => ({
        id,
        name,
        owner_id: ids.user,
        icon: null,
        features: [],
        roles: [],
        channels: [],
        members: [],
        emojis: [],
        stickers: [],
        member_count: 3,
        unavailable: false,
    })
    const guild = client.guilds._add(guildRaw(ids.guild, "Test Guild"))
    const guild2 = client.guilds._add(guildRaw(ids.guild2, "Other Guild"))
    guild.roles._add({ id: ids.guild, name: "@everyone", permissions: "0", position: 0, color: 0, hoist: false, managed: false, mentionable: false })
    const role = guild.roles._add({ id: ids.role, name: "VIP", permissions: "0", position: 1, color: 0, hoist: false, managed: false, mentionable: false })
    const member = (g, u) => g.members._add({ user: { id: u.id, username: u.username, discriminator: "0" }, roles: [], joined_at: new Date().toISOString(), deaf: false, mute: false })
    const m1 = member(guild, u1)
    member(guild, u2)
    member(guild, u3)
    member(guild2, u1)
    const channel = client.channels._add({ id: ids.channel, type: ChannelType.GuildText, name: "general", guild_id: ids.guild, position: 0, permission_overwrites: [] }, guild)
    const channel2 = client.channels._add({ id: ids.channel2, type: ChannelType.GuildText, name: "random", guild_id: ids.guild, position: 1, permission_overwrites: [] }, guild)
    const dm = client.channels._add({ id: ids.dm, type: ChannelType.DM, last_message_id: null, recipients: [{ id: ids.user, username: "alice", discriminator: "0" }] })
    const message = channel.messages._add({
        id: ids.message,
        channel_id: ids.channel,
        guild_id: ids.guild,
        author: { id: ids.user, username: "alice", discriminator: "0" },
        member: { roles: [], joined_at: new Date().toISOString(), deaf: false, mute: false },
        content: "hi",
        timestamp: new Date().toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: 0,
    })
    const dmMessage = dm.messages._add({
        id: "500000000000000009",
        channel_id: ids.dm,
        author: { id: ids.user, username: "alice", discriminator: "0" },
        content: "hi",
        timestamp: new Date().toISOString(),
        edited_timestamp: null,
        tts: false,
        mention_everyone: false,
        mentions: [],
        mention_roles: [],
        attachments: [],
        embeds: [],
        pinned: false,
        type: 0,
    })
    return { guild, guild2, role, channel, channel2, dm, message, dmMessage, member: m1, users: [u1, u2, u3] }
}

/** A container that records what would be sent to Discord instead of sending it. */
class CaptureContainer extends Container {
    constructor(sent) {
        super()
        this.sent = sent
    }
    async send(_obj, content) {
        this.sent.push(content ?? this.content ?? "")
        this.reset()
        return null
    }
}

/**
 * Boots ReForgeDB. `options` are passed to `new ReForgeDB()` (merged over the
 * database options), except:
 *  - `dir`: folder of the SQLite file (a new temp folder by default)
 *  - `wait: false`: return without waiting for the connection
 *  - `keep: true`: do not wipe an external test database first
 *  - `onExtension(ext)`: called before the connection is made
 *  - `counter`: a queryCounter() to count what the database runs
 */
async function boot(options = {}) {
    const { dir = tmpDir(), wait = true, keep = false, onExtension, counter, ...rest } = options
    if (counter) rest.typeorm = { ...rest.typeorm, ...counter.typeorm }
    const logs = captureLogs()
    const extension = new lib.ReForgeDB(dbOptions(dir, rest))
    // Runs before the connection is made, e.g. to listen for "connect".
    onExtension?.(extension)
    const client = new ForgeClient({ intents: ["Guilds"], extensions: [extension], prefixes: ["!"] })
    const cache = fillCache(client)
    const DataBase = client.db
    if (wait) {
        await DataBase.ready()
        counter?.attach(DataBase.dataSource)
        if (server && !keep) {
            await DataBase.wipe()
            await DataBase.cdWipe()
        }
    }

    /**
     * Runs ForgeScript code. Returns its output and what it sent (error
     * messages, cooldown messages). `obj` defaults to a message by alice in
     * #general of Test Guild.
     */
    async function exec(code, { obj = cache.message, extras, command = null } = {}) {
        const sent = []
        const output = await Interpreter.run({
            obj,
            client,
            data: Compiler.compile(code),
            command,
            doNotSend: true,
            extras,
            container: new CaptureContainer(sent),
        })
        return { output, sent }
    }
    /** Runs ForgeScript code and returns only its output (`null` when the command stopped). */
    const run = async (code, opts) => (await exec(code, opts)).output

    /** Log lines of the given levels captured since `mark`. */
    const logsOf = (...levels) => logs.filter((l) => levels.includes(l.level)).map((l) => l.text)

    return { client, extension, lib, DataBase, run, exec, cache, dir, logs, logsOf, ids, external: server }
}

/** MongoDB commands that are not the work of an operation (handshakes, cursors, sessions). */
const IGNORED_COMMANDS = new Set(["hello", "ismaster", "isMaster", "ping", "endSessions", "getMore", "killCursors", "buildInfo", "saslStart", "saslContinue", "listIndexes", "createIndexes", "listCollections"])

/**
 * Counts the statements (SQL) or commands (MongoDB) the database receives.
 * Pass it to boot() as `counter`. Read `count` relative to a mark, or use
 * `during(fn)`.
 */
function queryCounter() {
    const counter = {
        count: 0,
        queries: [],
        record(text) {
            counter.count++
            counter.queries.push(text)
        },
        /** TypeORM options that make the database report what it runs. */
        typeorm:
            kind === "mongodb"
                ? { monitorCommands: true }
                : {
                      logging: ["query"],
                      logger: {
                          logQuery(query) {
                              if (/^(BEGIN|COMMIT|START TRANSACTION|ROLLBACK|PRAGMA)/i.test(query)) return
                              counter.record(query)
                          },
                          logQueryError() {},
                          logQuerySlow() {},
                          logSchemaBuild() {},
                          logMigration() {},
                          log() {},
                      },
                  },
        /** Starts counting MongoDB commands on a connected DataSource. */
        attach(ds) {
            if (kind !== "mongodb") return
            ds.driver.queryRunner.databaseConnection.on("commandStarted", (event) => {
                if (!IGNORED_COMMANDS.has(event.commandName)) counter.record(JSON.stringify(event.command))
            })
        },
        /** Statements run by `fn`. */
        async during(fn) {
            const before = counter.count
            const mark = counter.queries.length
            await fn()
            return { count: counter.count - before, queries: counter.queries.slice(mark) }
        },
    }
    return counter
}

/** A Discord-like ID that is exact as a string (no float rounding). */
const snowflake = (n) => "9" + String(n).padStart(17, "0")

module.exports = { boot, ids, tmpDir, dbOptions, root, lib, snowflake, queryCounter, external: server, kind }
