"use strict"
// 3.3.0, forgeDBCooldownNames: true: ForgeDB's cooldown names are ReForgeDB's stored cooldowns, with
// ForgeDB's arguments, so a bot switching from ForgeDB keeps working without renaming.
// Fails on 3.2.0, where these names are always ForgeScript's in-memory cooldowns.
// Runs in its own process: ForgeScript's function list is shared by every client in a process.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { FunctionManager } = require("@tryforge/forgescript")

// As if another client in this process had loaded ForgeScript's own functions first:
// the option must still win over them.
FunctionManager.loadNative()

const { boot, tmpDir } = require("./fixtures/harness")

let h, DB
before(async () => {
    h = await boot({ dir: tmpDir(), logLevel: "info", cooldownSweepInterval: 0, forgeDBCooldownNames: true })
    DB = h.DataBase
    await DB.cdWipe()
})
after(async () => {
    await DB.cdWipe()
    await DB.close()
})

const NAMES = ["$userCooldown", "$memberCooldown", "$guildCooldown", "$channelCooldown", "$getUserCooldownTime", "$getMemberCooldownTime", "$getGuildCooldownTime", "$deleteUserCooldown", "$deleteMemberCooldown", "$deleteGuildCooldown", "$deleteChannelCooldown"]

test("the 11 names are ReForgeDB's stored cooldowns, with the same arguments as the $db functions", () => {
    for (const name of NAMES) {
        const fn = FunctionManager.get(name)
        assert.ok(fn, name)
        assert.match(fn.data.description, /forgeDBCooldownNames/, `${name} is still ForgeScript's`)
        const stored = FunctionManager.get(h.lib.FORGEDB_COOLDOWN_NAMES[name])
        assert.deepEqual(fn.data.args.map((a) => a.name), stored.data.args.map((a) => a.name), name)
    }
    assert.ok(h.logsOf("info").some((l) => /forgeDBCooldownNames: \$userCooldown/.test(l)))
})

test("$userCooldown[daily;...] is per user and stored, as with ForgeDB", async () => {
    const code = (user = "") => `$userCooldown[daily;1h;wait $env[time]${user ? `;${user}` : ""}]claimed`
    assert.equal(await h.run(code()), "claimed", "alice claims")
    const again = await h.exec(code())
    assert.equal(again.output, null, "alice is on cooldown")
    assert.match(again.sent[0], /^wait \d+/)
    assert.equal(await h.run(code(h.ids.user2)), "claimed", "bob has his own cooldown (ForgeScript's would share one keyed on 'daily')")
    const left = await DB.cdTimeLeft(DB.make_cdIdentifier({ name: "daily", id: h.ids.user }))
    assert.ok(left.left > 3_500_000, "stored in the database, so it survives a restart")
    assert.ok(Number(await h.run("$getUserCooldownTime[daily]")) > 3_500_000)
    assert.equal(await h.run(`$getUserCooldownTime[daily;${h.ids.user3}]`), "0")
    await h.run("$deleteUserCooldown[daily]")
    assert.equal(await h.run(code()), "claimed", "claimable again after $deleteUserCooldown")
})

test("member, guild and channel names work the same way", async () => {
    for (const [scope, get, del] of [
        ["$memberCooldown", "$getMemberCooldownTime", "$deleteMemberCooldown"],
        ["$guildCooldown", "$getGuildCooldownTime", "$deleteGuildCooldown"],
        ["$channelCooldown", "$getChannelCooldownTime", "$deleteChannelCooldown"],
    ]) {
        assert.equal(await h.run(`${scope}[x;1h;wait]ok`), "ok", scope)
        assert.equal(await h.run(`${scope}[x;1h;wait]ok`), null, `${scope} is running`)
        assert.ok(Number(await h.run(`${get}[x]`)) > 3_500_000, get)
        await h.run(`${del}[x]`)
        assert.equal(await h.run(`${get}[x]`), "0", del)
    }
})

test("with the option on, no start-up warning about ForgeDB-style calls", async () => {
    h.client.commands.add({ name: "daily", type: "messageCreate", code: "$userCooldown[daily;1d;wait]ok" })
    const before = h.logs.length
    h.client.emit(require("discord.js").Events?.ClientReady ?? "ready", h.client)
    await new Promise((r) => setImmediate(r))
    assert.deepEqual(h.logs.slice(before).filter((l) => /written for ForgeDB/.test(l.text)), [])
})
