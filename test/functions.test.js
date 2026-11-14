"use strict"
// Every function, run as ForgeScript code through the real interpreter.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { boot, ids, snowflake } = require("./fixtures/harness")

let h, run, exec, DB
before(async () => {
    h = await boot({ logLevel: "warn" })
    ;({ run, exec, DataBase: DB } = h)
})
after(async () => {
    await DB.close()
})

/** The error message a piece of code produces, via $try. */
const errorOf = async (code, opts) => run(`$try[${code};$env[e;message];e]`, opts)

test("user variables: set, get, delete, default, explicit and empty user ID", async () => {
    assert.equal(await run("$getUserVar[coins]"), "")
    assert.equal(await run("$getUserVar[coins;;0]"), "0")
    assert.equal(await run("$setUserVar[coins;5]$getUserVar[coins]"), "5")
    // An empty user field means "the user of the command", not a user with an empty ID.
    assert.equal(await run("$getUserVar[coins;;0]"), "5")
    assert.equal(await run("$setUserVar[coins;7;]$getUserVar[coins]"), "7")
    assert.equal(await run(`$setUserVar[coins;99;${ids.user2}]$getUserVar[coins;${ids.user2}]`), "99")
    assert.equal(await run("$getUserVar[coins]"), "7", "another user's value is separate")
    assert.equal(await run("$deleteUserVar[coins;]$getUserVar[coins;;gone]"), "gone")
    assert.equal(await run(`$getUserVar[coins;${ids.user2}]`), "99")
    assert.equal(await run(`$deleteUserVar[coins;${ids.user2}]$getUserVar[coins;${ids.user2};gone]`), "gone")
    assert.deepEqual((await DB.getAll()).map((r) => r.identifier), [])
})

test("values round-trip unchanged: JSON, unicode, quotes, long text, zero and empty", async () => {
    const values = ['{"a":[1,2,{"b":null}]}', "héllo 🎉 日本語", `it's "quoted" \\ back\\slash`, "0", "", "  spaced  ", "x".repeat(100_000), "line1\nline2", "%_wild%", "$notAFunction"]
    for (const [i, value] of values.entries()) {
        await DB.set({ name: `rt${i}`, id: ids.user, type: "user", value })
        assert.equal((await DB.get({ name: `rt${i}`, id: ids.user, type: "user" })).value, value, `value #${i}`)
    }
    assert.equal(await run("$getUserVar[rt0]"), values[0])
    assert.equal(await run("$getUserVar[rt1]"), values[1])
    assert.equal(await run("$getUserVar[rt3]"), "0")
    // An empty stored value is a value: the default is not used.
    assert.equal(await run("$getUserVar[rt4;;fallback]"), "")
    // Non-string values given through the JS API are stored as text.
    await DB.set({ name: "num", id: ids.user, type: "user", value: 42 })
    await DB.set({ name: "obj", id: ids.user, type: "user", value: { a: 1 } })
    await DB.set({ name: "nul", id: ids.user, type: "user", value: null })
    assert.equal(await run("$getUserVar[num]|$getUserVar[obj]|$getUserVar[nul;;d]"), '42|{"a":1}|')
    await DB.deleteMatching({ type: "user" })
})

test("overwriting keeps one row per variable", async () => {
    for (let i = 0; i < 20; i++) await run(`$setUserVar[same;${i}]`)
    const rows = await DB.find({ name: "same", type: "user" })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].value, "19")
    await run("$deleteUserVar[same]")
})

test("defaults declared with variables(): values, code, per-call default first", async () => {
    h.lib.ReForgeDB.variables({ level: 1, greeting: "Hello $username!", settings: { theme: "dark" }, flag: false, nothing: null, sum: "$math[2+3]" })
    assert.equal(await run("$getUserVar[level]"), "1")
    assert.equal(await run("$getUserVar[greeting]"), "Hello alice!")
    assert.equal(await run("$getUserVar[flag]"), "false")
    assert.equal(await run("$getUserVar[nothing]"), "")
    assert.equal(await run("$getUserVar[sum]"), "5")
    assert.equal(JSON.parse(await run("$getUserVar[settings]")).theme, "dark")
    assert.equal(await run("$getUserVar[level;;7]"), "7", "the default in the call wins")
    assert.equal(await run("$setUserVar[level;3]$getUserVar[level]"), "3", "a stored value wins")
    assert.equal(await run("$getUserVar[undeclared]"), "")
    // Defaults apply to every variable type.
    assert.equal(await run("$getGlobalVar[level]|$getGuildVar[level]|$getMemberVar[level]|$getChannelVar[level]|$getMessageVar[level]|$getVar[level;x]"), "1|1|1|1|1|1")
    // Names of Object.prototype are not defaults (ForgeDB matched them with `in`).
    assert.equal(await run("$getUserVar[toString]|$getUserVar[constructor]"), "|")
    await run("$deleteUserVar[level]")
    h.lib.ReForgeDB.variables({})
})

test("defaults can use other defaults, and one that reads itself is stopped", async () => {
    h.lib.ReForgeDB.variables({ full: "$getUserVar[first] $getUserVar[last]", first: "Ada", last: "Lovelace", loop: "$getUserVar[loop]", ping: "$getUserVar[pong]", pong: "$getUserVar[ping]" })
    assert.equal(await run("$getUserVar[full]"), "Ada Lovelace")
    // ForgeDB recursed until the process ran out of memory.
    const before = h.logsOf("error").length
    assert.equal(await run("$getUserVar[loop]done"), null, "the command stops")
    assert.equal(await run("$getUserVar[ping]done"), null)
    const errors = h.logsOf("error").slice(before).join("\n")
    assert.match(errors, /default of variable "loop" reads the variable itself \(loop -> loop\)/)
    assert.match(errors, /default of variable "ping" reads the variable itself \(ping -> pong -> ping\)/)
    // Still usable afterwards, and concurrent reads do not see each other's chain.
    assert.deepEqual(await Promise.all([run("$getUserVar[full]"), run("$getUserVar[first]"), run("$getUserVar[full]")]), ["Ada Lovelace", "Ada", "Ada Lovelace"])
    h.lib.ReForgeDB.variables({})
})

test("an invalid default reports a clear error instead of crashing", async () => {
    h.lib.ReForgeDB.variables({ broken: "$if[unclosed" })
    assert.match(await errorOf("$getUserVar[broken]"), /default of variable "broken" is not valid ForgeScript/)
    h.lib.ReForgeDB.variables({})
})

test("member variables are per guild", async () => {
    assert.equal(await run("$setMemberVar[xp;10]$getMemberVar[xp]"), "10")
    assert.equal(await run(`$setMemberVar[xp;20;${ids.user};${ids.guild2}]$getMemberVar[xp;${ids.user};${ids.guild2}]`), "20")
    assert.equal(await run("$getMemberVar[xp]"), "10")
    assert.equal(await run(`$setMemberVar[xp;30;${ids.user2}]$getMemberVar[xp;${ids.user2}]`), "30")
    assert.equal(await run("$getMemberVar[xp;;;5]"), "10", "empty member and guild fields use the command's")
    assert.equal(await run(`$getMemberVar[xp;${ids.user3};;5]`), "5")
    const keys = (await DB.find({ name: "xp" })).map((r) => r.identifier).sort()
    assert.deepEqual(keys, [`member_xp_${ids.guild2}_${ids.user}`, `member_xp_${ids.guild}_${ids.user}`, `member_xp_${ids.guild}_${ids.user2}`].sort())
    assert.equal(await run(`$deleteMemberVar[xp;${ids.user};${ids.guild2}]$getMemberVar[xp;${ids.user};${ids.guild2};none]`), "none")
    // The guild of $deleteMemberVar is plain text: data of a guild the bot left can be removed.
    await DB.set({ name: "xp", id: ids.user, type: "member", guildId: "777777777777777777", value: "1" })
    await run(`$deleteMemberVar[xp;${ids.user};777777777777777777]`)
    assert.equal(await DB.get({ name: "xp", id: ids.user, type: "member", guildId: "777777777777777777" }), null)
    await DB.deleteMatching({ name: "xp" })
})

test("guild variables and their server aliases", async () => {
    assert.equal(await run("$setGuildVar[prefix;?]$getGuildVar[prefix]"), "?")
    assert.equal(await run("$getServerVar[prefix]"), "?")
    assert.equal(await run(`$setServerVar[prefix;!;${ids.guild2}]$getGuildVar[prefix;${ids.guild2}]`), "!")
    assert.equal(await run("$getGuildVar[prefix;;x]"), "?")
    // Plain-text guild ID: a guild the bot is not in works too.
    assert.equal(await run("$setGuildVar[prefix;#;888888888888888888]$getGuildVar[prefix;888888888888888888]"), "#")
    assert.equal(await run("$deleteServerVar[prefix]$getGuildVar[prefix;;none]"), "none")
    await DB.deleteMatching({ name: "prefix" })
})

test("channel variables: current, explicit, deleted and DM channels", async () => {
    assert.equal(await run("$setChannelVar[topic;a]$getChannelVar[topic]"), "a")
    assert.equal(await run(`$setChannelVar[topic;b;${ids.channel2}]$getChannelVar[topic;${ids.channel2}]`), "b")
    assert.equal(await run("$getChannelVar[topic;;x]"), "a")
    assert.equal((await DB.get({ identifier: `channel_topic_${ids.guild}_${ids.channel2}` })).value, "b")
    // A channel that no longer exists: ForgeDB's Channel argument made the command die uncatchably.
    const gone = "311111111111111111"
    assert.equal(await run(`$setChannelVar[topic;c;${gone}]$getChannelVar[topic;${gone}]`), "c")
    assert.equal(await run(`$deleteChannelVar[topic;${gone}]$getChannelVar[topic;${gone};deleted]`), "deleted")
    // In a DM there is no guild; the key keeps ForgeDB's "undefined" guild part.
    assert.equal(await run("$setChannelVar[topic;dm]$getChannelVar[topic]", { obj: h.cache.dmMessage }), "dm")
    assert.ok(await DB.get({ identifier: `channel_topic_undefined_${ids.dm}` }))
    assert.equal(await run("$deleteChannelVar[topic]$getChannelVar[topic;;none]"), "none")
    await DB.deleteMatching({ name: "topic" })
})

test("role variables", async () => {
    assert.equal(await run(`$setRoleVar[color;red;${ids.role}]$getRoleVar[color;${ids.role}]`), "red")
    assert.equal(await run(`$getRoleVar[other;${ids.role};fallback]`), "fallback")
    assert.ok(await DB.get({ identifier: `role_color_${ids.guild}_${ids.role}` }))
    // Missing or unknown role: a normal, catchable ForgeScript error.
    assert.match((await exec("$getRoleVar[color]")).sent[0], /missing argument.*role ID/)
    assert.match(await errorOf("$setRoleVar[color;x;123456789012345678]"), /role ID/)
    // Deleting takes a plain ID, so a deleted role's data can be removed.
    assert.equal(await run(`$deleteRoleVar[color;${ids.role}]$getRoleVar[color;${ids.role};none]`), "none")
    await DB.set({ name: "color", id: "455555555555555555", type: "role", guildId: ids.guild2, value: "blue" })
    await run(`$deleteRoleVar[color;455555555555555555;${ids.guild2}]`)
    assert.equal(await DB.get({ identifier: `role_color_${ids.guild2}_455555555555555555` }), null)
})

test("message, global and legacy variables", async () => {
    assert.equal(await run("$setMessageVar[poll;open]$getMessageVar[poll]"), "open")
    assert.equal(await run("$setMessageVar[poll;closed;599999999999999999]$getMessageVar[poll;599999999999999999]"), "closed")
    assert.equal(await run("$getMessageVar[poll;;x]"), "open")
    assert.equal(await run("$deleteMessageVar[poll]$getMessageVar[poll;;none]"), "none")

    assert.equal(await run("$setGlobalVar[motd;hi]$getGlobalVar[motd]"), "hi")
    assert.equal(await run("$getGlobalVar[unset;default]"), "default")
    assert.ok(await DB.get({ identifier: "custom_motd_undefined" }), "ForgeDB's key for global variables")
    assert.equal(await run("$deleteGlobalVar[motd]$getGlobalVar[motd;none]"), "none")

    assert.equal(await run("$setVar[legacy;abc;v]$getVar[legacy;abc]"), "v")
    assert.equal(await run("$getVar[legacy;other;d]"), "d")
    assert.equal(await run("$deleteVar[legacy;abc]$getVar[legacy;abc;none]"), "none")
    await DB.wipe()
})

test("a missing context gives a catchable error, not a crash", async () => {
    const dm = { obj: h.cache.dmMessage }
    assert.match(await errorOf("$getMemberVar[xp]", dm), /No member ID was given/)
    assert.match(await errorOf("$setMemberVar[xp;1]", dm), /No member ID was given/)
    assert.match(await errorOf(`$getMemberVar[xp;${ids.user}]`, dm), /No guild ID was given/)
    assert.match(await errorOf("$setGuildVar[a;1]", dm), /No guild ID was given/)
    assert.match(await errorOf("$guildLeaderboard[a]$memberLeaderboard[a]", dm), /No guild ID was given/)
    assert.match(await errorOf("$dbGuildCooldown[a;1s]", dm), /No guild ID was given/)
    // The same code works in a DM once the IDs are given.
    assert.equal(await run(`$setMemberVar[xp;1;${ids.user};${ids.guild}]$getMemberVar[xp;${ids.user};${ids.guild}]`, dm), "1")
    // And without $try the user is told what is wrong.
    assert.match((await exec("$getMemberVar[xp]", dm)).sent[0], /\[ReForgeDB\] No member ID was given/)
    await DB.wipe()
})

async function seedUsers(name, values) {
    for (const [id, value] of Object.entries(values)) await DB.set({ name, id, type: "user", value: String(value) })
}

test("user leaderboard: order, pages, separator, both sort types", async () => {
    await seedUsers("lb", { [ids.user]: 30, [ids.user2]: 10, [ids.user3]: 20 })
    assert.equal(await run("$userLeaderboard[lb]"), "1. alice ~ 30\n2. carol ~ 20\n3. bob ~ 10")
    assert.equal(await run("$userLeaderboard[lb;asc]"), "1. bob ~ 10\n2. carol ~ 20\n3. alice ~ 30")
    assert.equal(await run("$userLeaderboard[lb;desc;2;1; | ]"), "1. alice ~ 30 | 2. carol ~ 20")
    assert.equal(await run("$userLeaderboard[lb;desc;2;2]"), "3. bob ~ 10")
    assert.equal(await run("$userLeaderboard[lb;desc;2;9]"), "")
    assert.equal(await run("$userLeaderboard[nothing]"), "")
    // Bad page sizes and pages fall back to 10 and 1 (ForgeDB sliced with negative numbers).
    assert.equal(await run("$userLeaderboard[lb;desc;-5;-2]"), "1. alice ~ 30\n2. carol ~ 20\n3. bob ~ 10")
    assert.equal(await run("$userLeaderboard[lb;desc;abc;xyz]"), "1. alice ~ 30\n2. carol ~ 20\n3. bob ~ 10")
    // A user who is not cached is shown by ID instead of "undefined".
    await seedUsers("lb", { [snowflake(1)]: 5 })
    assert.equal((await run("$userLeaderboard[lb;desc;1;4]")).trim(), `4. ${snowflake(1)} ~ 5`)
})

test("user leaderboard: custom row code, $env variables, $return, $continue, $break", async () => {
    assert.equal(await run("$userLeaderboard[lb;desc;3;1;, ;row;pos;$return[#$env[pos] $env[row;username]=$env[row;value]]]"), "#1 alice=30, #2 carol=20, #3 bob=10")
    assert.equal(await run("$userLeaderboard[lb;desc;3;1;,;row;pos;$return[$env[row;id]:$env[row;type]:$env[row;name]]]"), `${ids.user}:user:lb,${ids.user3}:user:lb,${ids.user2}:user:lb`)
    // Code without $return adds its output as the row.
    assert.equal(await run("$userLeaderboard[lb;desc;2;1;-;row;pos;$env[pos]]"), "1-2")
    // Rows that return nothing are skipped.
    assert.equal(await run("$userLeaderboard[lb;desc;3;1;,;row;pos;$if[$env[pos]==2;;$return[$env[pos]]]]"), "1,3")
    assert.equal(await run("$userLeaderboard[lb;desc;4;1;,;row;pos;$if[$env[pos]==2;$continue]$return[$env[pos]]]"), "1,3,4")
    assert.equal(await run("$userLeaderboard[lb;desc;4;1;,;row;pos;$if[$env[pos]==3;$break]$return[$env[pos]]]"), "1,2")
    // Without env names nothing leaks into the environment under an empty key.
    assert.equal(await run("$userLeaderboard[lb;desc;1]$env[]"), "1. alice ~ 30")
    // An error inside the row code is reported, not printed as a row.
    assert.match((await exec("$userLeaderboard[lb;desc;3;1;,;row;pos;$getRoleVar[x]]")).sent[0], /missing argument/)
})

test("user leaderboard lookups: ID at a position, position of a user, page count", async () => {
    assert.equal(await run("$getUserLeaderboardID[lb;desc;1]"), ids.user)
    assert.equal(await run("$getUserLeaderboardID[lb;desc;3]"), ids.user2)
    assert.equal(await run("$getUserLeaderboardID[lb;asc;1]"), snowflake(1))
    assert.equal(await run("$getUserLeaderboardID[lb;;2]"), ids.user3, "desc is the default")
    assert.equal(await run("$getUserLeaderboardID[lb;desc;99]"), "")
    assert.equal(await run("$getUserLeaderboardID[lb;desc;0]"), "")
    assert.equal(await run("$getUserLeaderboardID[lb;desc;-1]"), "")
    assert.equal(await run("$getUserLeaderboardValue[lb;desc]"), "1")
    assert.equal(await run("$getUserLeaderboardPosition[lb;asc]"), "4")
    assert.equal(await run(`$getUserLeaderboardValue[lb;desc;${ids.user2}]`), "3")
    assert.equal(await run("$getUserLeaderboardValue[lb;desc;]"), "1", "an empty user field is the command's user")
    assert.equal(await run("$getUserLeaderboardValue[lb;desc;123456789012345678]"), "0")
    assert.equal(await run("$getUserLeaderboardLength[lb]"), "4")
    assert.equal(await run("$getUserLeaderboardLength[lb;3]"), "2")
    assert.equal(await run("$getUserLeaderboardLength[lb;3;true]"), String(4 / 3))
    assert.equal(await run("$getUserLeaderboardLength[lb;4]"), "1")
    assert.equal(await run("$getUserLeaderboardLength[nothing;10]"), "0")
    assert.match(await errorOf("$getUserLeaderboardLength[lb;0]"), /page length must be a number above 0/)
    assert.match(await errorOf("$getUserLeaderboardLength[lb;-1]"), /page length must be a number above 0/)
})

test("leaderboards rank numbers only, and break ties the same way everywhere", async () => {
    await seedUsers("mix", { [snowflake(11)]: "abc", [snowflake(12)]: 5, [snowflake(13)]: "", [snowflake(14)]: "9", [snowflake(15)]: "1,000", [snowflake(16)]: "-3", [snowflake(17)]: "2.5", [snowflake(18)]: " 7 " })
    const order = (await run("$userLeaderboard[mix;desc;10;1;,;r;p;$return[$env[r;value]]]")).split(",")
    assert.deepEqual(order, ["9", " 7 ", "5", "2.5", "-3"], "text and empty values are left out")
    assert.equal(await run("$getUserLeaderboardLength[mix]"), "5")
    assert.equal(await run(`$getUserLeaderboardValue[mix;desc;${snowflake(11)}]`), "0")

    // Ties: lowest ID first, in every function and in both directions.
    await seedUsers("tie", { [snowflake(23)]: 5, [snowflake(21)]: 5, [snowflake(22)]: 5, [snowflake(20)]: 9 })
    const idsOf = async (sort) => (await run(`$userLeaderboard[tie;${sort};10;1;,;r;p;$return[$env[r;id]]]`)).split(",")
    assert.deepEqual(await idsOf("desc"), [snowflake(20), snowflake(21), snowflake(22), snowflake(23)])
    assert.deepEqual(await idsOf("asc"), [snowflake(21), snowflake(22), snowflake(23), snowflake(20)])
    for (let pos = 1; pos <= 4; pos++) {
        const id = await run(`$getUserLeaderboardID[tie;desc;${pos}]`)
        assert.equal(await run(`$getUserLeaderboardValue[tie;desc;${id}]`), String(pos), "ID and position functions agree")
    }
    await DB.deleteMatching({ type: "user" })
})

test("a leaderboard reflects writes immediately", async () => {
    await seedUsers("live", { [ids.user]: 1, [ids.user2]: 2 })
    assert.equal(await run("$getUserLeaderboardID[live;desc;1]"), ids.user2)
    assert.equal(await run(`$setUserVar[live;50]$getUserLeaderboardID[live;desc;1]`), ids.user)
    assert.equal(await run(`$deleteUserVar[live]$getUserLeaderboardID[live;desc;1]$getUserLeaderboardLength[live]`), ids.user2 + "1")
    assert.equal(await run(`$deleteRecords[live]$getUserLeaderboardLength[live]`), "0")
    await seedUsers("live", { [ids.user]: 1 })
    assert.equal(await run(`$getUserLeaderboardLength[live]$wipeDB$getUserLeaderboardLength[live]`), "10")
})

test("member leaderboards are per guild", async () => {
    const set = (id, guildId, value) => DB.set({ name: "mxp", id, type: "member", guildId, value: String(value) })
    await set(ids.user, ids.guild, 5)
    await set(ids.user2, ids.guild, 15)
    await set(ids.user3, ids.guild, 10)
    await set(ids.user, ids.guild2, 100)
    assert.equal(await run("$memberLeaderboard[mxp]"), "1. bob ~ 15\n2. carol ~ 10\n3. alice ~ 5")
    assert.equal(await run("$memberLeaderboard[mxp;;asc;2;1;/]"), "1. alice ~ 5/2. carol ~ 10")
    assert.equal(await run(`$memberLeaderboard[mxp;${ids.guild2}]`), "1. alice ~ 100")
    assert.equal(await run(`$memberLeaderboard[mxp;${ids.guild2};desc;5;1;,;r;p;$return[$env[p]:$env[r;guildId]:$env[r;username]]]`), `1:${ids.guild2}:alice`)
    assert.equal(await run("$getMemberLeaderboardID[mxp;desc;1]"), ids.user2)
    assert.equal(await run(`$getMemberLeaderboardID[mxp;desc;1;${ids.guild2}]`), ids.user)
    assert.equal(await run("$getMemberLeaderboardValue[mxp;desc]"), "3")
    assert.equal(await run("$getMemberLeaderboardPosition[mxp;asc]"), "1")
    assert.equal(await run(`$getMemberLeaderboardValue[mxp;desc;${ids.user};${ids.guild2}]`), "1")
    assert.equal(await run(`$getMemberLeaderboardValue[mxp;desc;${ids.user3}]`), "2")
    assert.equal(await run("$getMemberLeaderboardLength[mxp]"), "3")
    assert.equal(await run(`$getMemberLeaderboardLength[mxp;${ids.guild2}]`), "1")
    assert.equal(await run("$getMemberLeaderboardLength[mxp;;2]"), "2")
    assert.equal(await run("$getMemberLeaderboardLength[mxp;;2;true]"), "1.5")
})

test("guild leaderboards and their server aliases", async () => {
    await DB.set({ name: "gscore", id: ids.guild, type: "guild", value: "3" })
    await DB.set({ name: "gscore", id: ids.guild2, type: "guild", value: "8" })
    assert.equal(await run("$guildLeaderboard[gscore]"), "1. Other Guild ~ 8\n2. Test Guild ~ 3")
    assert.equal(await run("$serverLeaderboard[gscore;asc;1]"), "1. Test Guild ~ 3")
    assert.equal(await run("$guildLeaderboard[gscore;desc;5;1;,;r;p;$return[$env[r;guild_name]]]"), "Other Guild,Test Guild")
    assert.equal(await run("$getGuildLeaderboardID[gscore;desc;1]"), ids.guild2)
    assert.equal(await run("$getServerLeaderboardID[gscore;asc;1]"), ids.guild)
    assert.equal(await run("$getGuildLeaderboardValue[gscore;desc]"), "2")
    assert.equal(await run(`$getServerLeaderboardPosition[gscore;desc;${ids.guild2}]`), "1")
    assert.equal(await run("$getGuildLeaderboardLength[gscore]$getServerLeaderboardLength[gscore;2]"), "21")
})

test("channel leaderboards, including the position of a given channel", async () => {
    await run(`$setChannelVar[pts;10;${ids.channel}]$setChannelVar[pts;20;${ids.channel2}]`)
    assert.equal(await run("$channelLeaderboard[pts]"), "1. random ~ 20\n2. general ~ 10")
    assert.equal(await run("$channelLeaderboard[pts;;asc;1;1]"), "1. general ~ 10")
    assert.equal(await run("$channelLeaderboard[pts;;desc;5;1;,;r;p;$return[$env[r;channel_name]]]"), "random,general")
    assert.equal(await run("$getChannelLeaderboardID[pts;desc;1]"), ids.channel2)
    assert.equal(await run(`$getChannelLeaderboardID[pts;asc;1;${ids.guild}]`), ids.channel)
    assert.equal(await run(`$getChannelLeaderboardID[pts;desc;1;${ids.guild2}]`), "")
    // ForgeDB compared the stored ID with a channel object: an explicit channel always gave 0.
    assert.equal(await run(`$getChannelLeaderboardValue[pts;desc;${ids.channel2}]`), "1")
    assert.equal(await run(`$getChannelLeaderboardPosition[pts;desc;${ids.channel}]`), "2")
    assert.equal(await run("$getChannelLeaderboardValue[pts;desc]"), "2")
    assert.equal(await run("$getChannelLeaderboardLength[pts]"), "2")
    assert.equal(await run(`$getChannelLeaderboardLength[pts;${ids.guild2}]`), "0")
    await DB.wipe()
})

test("$searchDB filters by name, id, type, value and guild", async () => {
    await run(`$setUserVar[coins;5]$setUserVar[coins;9;${ids.user2}]$setUserVar[coupons;1]$setGuildVar[coins;7]$setMemberVar[xp;3]$setMemberVar[xp;4;${ids.user};${ids.guild2}]$setGlobalVar[motd;hello world]$setVar[legacy;k;v]`)
    const search = async (args) => JSON.parse(await run(`$searchDB[${args}]`)).map((r) => r.identifier).sort()
    assert.equal((await search("")).length, 8)
    assert.deepEqual(await search("coins"), [`guild_coins_${ids.guild}`, `user_coins_${ids.user}`, `user_coins_${ids.user2}`])
    assert.deepEqual(await search("co%"), [`guild_coins_${ids.guild}`, `user_coins_${ids.user}`, `user_coins_${ids.user2}`, `user_coupons_${ids.user}`])
    assert.deepEqual(await search("c_ins"), await search("coins"))
    // "user" is enum value 0, which ForgeDB dropped as "no filter".
    assert.deepEqual(await search(";;user"), [`user_coins_${ids.user}`, `user_coins_${ids.user2}`, `user_coupons_${ids.user}`])
    assert.deepEqual(await search(";;guild"), [`guild_coins_${ids.guild}`])
    assert.deepEqual(await search(";;custom"), ["custom_motd_undefined"])
    assert.deepEqual(await search(";;old"), ["old_legacy_k"])
    assert.deepEqual(await search(`coins;${ids.user2}`), [`user_coins_${ids.user2}`])
    assert.deepEqual(await search(`;${ids.user};member`), [`member_xp_${ids.guild2}_${ids.user}`, `member_xp_${ids.guild}_${ids.user}`].sort())
    assert.deepEqual(await search(`;;;;${ids.guild2}`), [`member_xp_${ids.guild2}_${ids.user}`])
    assert.deepEqual(await search(";;;hello%"), ["custom_motd_undefined"])
    assert.deepEqual(await search(";;;9"), [`user_coins_${ids.user2}`])
    assert.deepEqual(await search("nothing-like-this"), [])
    assert.equal(await run("$searchDataBase[coins;;guild]"), await run("$searchRecords[coins;;guild]"))
    const row = JSON.parse(await run(`$searchDB[coins;${ids.user}]`))[0]
    // (MongoDB rows also carry their document ID.)
    const { identifier, name, id, type, value, guildId = null } = row
    assert.deepEqual({ identifier, name, id, type, value, guildId }, { identifier: `user_coins_${ids.user}`, name: "coins", id: ids.user, type: "user", value: "5", guildId: null })
    assert.match(await errorOf("$searchDB[;;nonsense]"), /type/)
})

test("$getDB returns everything", async () => {
    const all = JSON.parse(await run("$getDB"))
    assert.equal(all.length, 8)
    assert.equal(JSON.parse(await run("$getRecords")).length, 8)
})

test("$deleteRecords deletes what matches, and refuses to run without a filter", async () => {
    // An empty call (or an unset $get) matched every variable in ForgeDB.
    for (const code of ["$deleteRecords[]", "$deleteRecords[;;;;]", "$deleteRecords[$get[unset]]"]) {
        assert.match(await errorOf(`$let[x;]${code}`), /needs at least one filter/, code)
    }
    assert.equal((await DB.getAll()).length, 8, "nothing was deleted")
    await run(`$deleteRecords[coins;${ids.user2}]`)
    assert.equal(await DB.get({ name: "coins", id: ids.user2, type: "user" }), null)
    await run("$deleteVars[;;user]")
    assert.deepEqual((await DB.find({ type: "user" })).length, 0)
    assert.equal((await DB.getAll()).length, 5)
    await run(`$deleteVariables[;;;;${ids.guild2}]`)
    assert.equal((await DB.getAll()).length, 4)
    await run("$deleteRecords[;;;hello%]")
    assert.equal((await DB.getAll()).length, 3)
    await run("$deleteRecords[%]")
    assert.equal((await DB.getAll()).length, 0)
})

test("$deleteRecords handles thousands of rows", async () => {
    const n = 2500
    for (let i = 0; i < n; i++) await DB.set({ name: "bulk", id: snowflake(1000 + i), type: "user", value: String(i) })
    await DB.set({ name: "keep", id: ids.user, type: "user", value: "1" })
    assert.equal(await DB.deleteMany(await DB.find({ name: "bulk" })), n)
    assert.deepEqual((await DB.getAll()).map((r) => r.name), ["keep"])
    assert.equal(await DB.deleteMany([]), 0)
    await assert.rejects(DB.deleteMatching({}), /at least one filter/)
})

test("$wipeDB deletes variables and cooldowns", async () => {
    await run("$setUserVar[a;1]$globalCooldown[w;1h]")
    assert.ok(Number(await run("$getGlobalCooldownTime[w]")) > 0)
    assert.equal(await run("$wipeDB"), "")
    assert.equal((await DB.getAll()).length, 0)
    assert.equal(await run("$getGlobalCooldownTime[w]"), "0")
    assert.equal(await run("$setUserVar[a;1]$clearDB$getUserVar[a;;gone]"), "gone")
    assert.equal(await run("$setUserVar[a;1]$deleteDB$getUserVar[a;;gone]"), "gone")
})

test("$dbPing returns a number of ms", async () => {
    const ms = Number(await run("$dbPing"))
    assert.ok(Number.isFinite(ms) && ms >= 0 && ms < 5000, String(ms))
    assert.match(await run("$dbPing"), /^\d+(\.\d{1,2})?$/)
    assert.ok(Number.isFinite(Number(await run("$dbLatency[true]"))))
    assert.ok((await DB.ping()) >= 0)
})

const near = (text, ms, slack = 5000) => {
    const n = Number(text)
    assert.ok(n <= ms && n > ms - slack, `${text} is not just under ${ms}`)
}

test("persistent cooldowns: first call passes, later calls send the code and stop", async () => {
    assert.deepEqual(await exec("$dbUserCooldown[daily;1h;Wait!]passed"), { output: "passed", sent: [] })
    assert.deepEqual(await exec("$dbUserCooldown[daily;1h;Wait!]passed"), { output: null, sent: ["Wait!"] })
    // $env[time] holds the ms left.
    const { sent } = await exec("$dbUserCooldown[daily;1h;$env[time]]")
    near(sent[0], 3_600_000)
    near(await run("$dbGetUserCooldownTime[daily]"), 3_600_000)
    // Without code the command stops silently.
    assert.deepEqual(await exec("$dbUserCooldown[daily;1h]passed"), { output: null, sent: [""] })
    assert.equal(await run("$dbDeleteUserCooldown[daily]$dbGetUserCooldownTime[daily]"), "0")
    assert.equal((await exec("$dbUserCooldown[daily;1h;Wait!]passed")).output, "passed")
    await DB.cdWipe()
})

test("persistent cooldowns are scoped: user, member, guild, channel, global", async () => {
    // user: the ID argument is honoured (ForgeDB read `.id` of a text argument and ignored it)
    await run(`$dbUserCooldown[c;1h;;${ids.user2}]`)
    near(await run(`$dbGetUserCooldownTime[c;${ids.user2}]`), 3_600_000)
    assert.equal(await run("$dbGetUserCooldownTime[c]"), "0")
    assert.equal(await run(`$dbDeleteUserCooldown[c;${ids.user2}]$dbGetUserCooldownTime[c;${ids.user2}]`), "0")

    // member: per guild (ForgeDB ignored the guild argument)
    await run(`$dbMemberCooldown[c;1h;;${ids.user};${ids.guild2}]`)
    near(await run(`$dbGetMemberCooldownTime[c;${ids.user};${ids.guild2}]`), 3_600_000)
    assert.equal(await run("$dbGetMemberCooldownTime[c]"), "0", "the same member in the command's guild is not on cooldown")
    await run("$dbMemberCooldown[c;2h]")
    near(await run("$dbGetMemberCooldownTime[c;;]"), 7_200_000)
    assert.equal(await run(`$dbDeleteMemberCooldown[c;${ids.user};${ids.guild2}]$dbGetMemberCooldownTime[c;${ids.user};${ids.guild2}]`), "0")
    near(await run("$dbGetMemberCooldownTime[c]"), 7_200_000)

    // guild
    await run("$dbGuildCooldown[c;1h]")
    near(await run("$dbGetGuildCooldownTime[c]"), 3_600_000)
    assert.equal(await run(`$dbGetGuildCooldownTime[c;${ids.guild2}]`), "0")
    assert.equal((await exec(`$dbGuildCooldown[c;1h;busy;${ids.guild}]x`)).sent[0], "busy")
    assert.equal(await run("$dbDeleteGuildCooldown[c]$dbGetGuildCooldownTime[c]"), "0")

    // channel
    await run(`$dbChannelCooldown[c;1h;;${ids.channel2}]`)
    near(await run(`$dbGetChannelCooldownTime[c;${ids.channel2}]`), 3_600_000)
    assert.equal(await run("$dbGetChannelCooldownTime[c]"), "0")
    near(await run(`$getChannelCooldownTime[c;${ids.channel2}]`), 3_600_000)
    assert.equal(await run(`$dbDeleteChannelCooldown[c;${ids.channel2}]$dbGetChannelCooldownTime[c;${ids.channel2}]`), "0")

    // global, with its db-prefixed aliases
    assert.equal((await exec("$globalCooldown[c;1h;no]ok")).output, "ok")
    assert.equal((await exec("$dbGlobalCooldown[c;1h;no]ok")).sent[0], "no")
    near(await run("$getGlobalCooldownTime[c]"), 3_600_000)
    near(await run("$dbGetGlobalCooldownTime[c]"), 3_600_000)
    assert.equal(await run("$dbDeleteGlobalCooldown[c]$getGlobalCooldownTime[c]"), "0")
    await run("$globalCooldown[c;1h]")
    assert.equal(await run("$deleteGlobalCooldown[c]$getGlobalCooldownTime[c]"), "0")
    await DB.cdWipe()
})

test("cooldowns: durations of any length, expiry, and bad durations", async () => {
    // Longer than 24.8 days (2^31 ms), which overflowed ForgeDB's columns on MySQL and PostgreSQL.
    await run("$dbUserCooldown[year;365d]")
    near(await run("$dbGetUserCooldownTime[year]"), 365 * 86_400_000)
    // A short one runs out.
    await run("$dbUserCooldown[short;150]")
    assert.ok(Number(await run("$dbGetUserCooldownTime[short]")) > 0)
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(await run("$dbGetUserCooldownTime[short]"), "0")
    assert.equal((await exec("$dbUserCooldown[short;150;no]ok")).output, "ok", "an expired cooldown can be started again")
    // A zero duration never blocks.
    assert.equal((await exec("$dbUserCooldown[zero;0;no]$dbUserCooldown[zero;0;no]ok")).output, "ok")
    assert.match(await errorOf("$dbUserCooldown[bad;-5000]"), /duration must be a number of milliseconds of 0 or more/)
    assert.match(await errorOf("$dbUserCooldown[bad;abc]"), /duration/)
    await assert.rejects(DB.cdAdd({ name: "x", duration: NaN }), /duration/)
    await assert.rejects(DB.cdAdd({ name: "x", duration: 1e300 }), /too long/)
    // The ms left can be formatted in the cooldown message.
    await run("$dbUserCooldown[fmt;90m]")
    assert.equal((await exec("$dbUserCooldown[fmt;90m;Try again in $round[$math[$env[time]/60000]] minutes]")).sent[0], "Try again in 90 minutes")
    await DB.cdWipe()
})

test("expired cooldowns are swept from the database", async () => {
    await DB.cdAdd({ name: "old", id: "1", duration: 1 })
    await DB.cdAdd({ name: "old", id: "2", duration: 1 })
    await DB.cdAdd({ name: "running", id: "1", duration: 3_600_000 })
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(await DB.sweepCooldowns(), 2)
    assert.equal(await DB.sweepCooldowns(), 0)
    assert.ok((await DB.cdTimeLeft("running_1")).left > 0)
    assert.deepEqual(await DB.cdTimeLeft("old_1"), { left: 0 })
    await DB.cdWipe()
})

test("$getChannelCooldownTime also answers for ForgeScript's in-memory $channelCooldown", async () => {
    // ForgeScript's own getter registers under another name, so its $channelCooldown had no working getter.
    const command = { id: 4242, data: { type: "messageCreate", code: "" } }
    assert.equal((await exec(`$channelCooldown[${ids.channel};1h;no]ok`, { command })).output, "ok")
    near(await run(`$getChannelCooldownTime[${ids.channel}]`, { command }), 3_600_000)
    assert.equal(await run(`$getChannelCooldownTime[${ids.channel2}]`, { command }), "0")
    h.client.cooldowns.clear()
})
