"use strict"
// 3.3.0: without forgeDBCooldownNames, a command written for ForgeDB's stored cooldowns
// ($userCooldown[daily;1d;...]) runs ForgeScript's in-memory cooldown, which reads "daily" as the user ID:
// every user shares one cooldown. ReForgeDB says so at start-up, once the commands are loaded.
// Fails on 3.2.0, which says nothing. Runs in its own process (see forgedb-names.test.js).
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, tmpDir } = require("./fixtures/harness")

let h
before(async () => {
    h = await boot({ dir: tmpDir(), logLevel: "warn", cooldownSweepInterval: 0 })
})
after(async () => {
    await h.DataBase.close()
})

const ready = () => require("discord.js").Events?.ClientReady ?? "ready"

test("calls written for ForgeDB are reported once, with both fixes; ForgeScript-style calls are not", async () => {
    h.client.commands.add(
        { name: "daily", type: "messageCreate", code: "$userCooldown[daily;1d;wait]$getUserCooldownTime[daily]ok" },
        { name: "weekly", type: "messageCreate", code: "$USERCOOLDOWN[weekly;7d]$deleteMemberCooldown[weekly]" },
        { name: "mod", type: "messageCreate", code: "$userCooldown[$authorID;1h;x]$memberCooldown[123456789012345678;1h]$channelCooldown[<#123456789012345678>;1h]" },
        { name: "stored", type: "messageCreate", code: "$dbUserCooldown[daily;1d]$dbGetUserCooldownTime[daily]$getChannelCooldownTime[daily]" }
    )
    const found = h.lib.findLegacyCooldownCalls(h.client)
    assert.deepEqual(
        found.map((f) => [f.command, f.call, f.replacement]),
        [
            ['"daily"', "$userCooldown[daily;...]", "$dbUserCooldown"],
            ['"daily"', "$getUserCooldownTime[daily;...]", "$dbGetUserCooldownTime"],
            ['"weekly"', "$userCooldown[weekly;...]", "$dbUserCooldown"],
            ['"weekly"', "$deleteMemberCooldown[weekly;...]", "$dbDeleteMemberCooldown"],
        ]
    )

    const before = h.logs.length
    h.client.emit(ready(), h.client)
    h.client.emit(ready(), h.client)
    await new Promise((r) => setImmediate(r))
    const warnings = h.logs.slice(before).filter((l) => l.level === "warn" && /written for ForgeDB/.test(l.text)).map((l) => l.text)
    assert.equal(warnings.length, 4, "once per call, and only on the first ready")
    assert.match(warnings[0], /^\[ReForgeDB\] Command "daily" uses \$userCooldown\[daily;\.\.\.\]/)
    assert.match(warnings[0], /reads "daily" as the ID: every user shares one cooldown/)
    assert.match(warnings[0], /Rename it to \$dbUserCooldown\[daily;\.\.\.\], or set forgeDBCooldownNames: true/)
})

test("an option that is not true or false is refused at start-up", () => {
    assert.throws(() => new h.lib.ReForgeDB({ type: "sqlite", forgeDBCooldownNames: "yes" }), { name: "ReForgeDBError", message: 'Option "forgeDBCooldownNames" must be true or false.' })
})
