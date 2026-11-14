"use strict"
// Database events: what is emitted, when, and the event commands.
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { NativeFunction, ArgType, FunctionManager } = require("@tryforge/forgescript")
const { boot, ids } = require("./fixtures/harness")

let h, run, DB
const emitted = []
const recorded = []
let connects = 0

before(async () => {
    // A test-only function, so event commands can report what they saw.
    FunctionManager.add(
        new NativeFunction({
            name: "$testRecord",
            description: "Records a value for the tests",
            unwrap: true,
            brackets: true,
            args: [{ name: "value", description: "The value", type: ArgType.String, required: true, rest: false }],
            execute(_ctx, [value]) {
                recorded.push(value)
                return this.success()
            },
        })
    )
    h = await boot({
        logLevel: "warn",
        events: ["connect", "variableCreate", "variableUpdate", "variableDelete"],
        onExtension(ext) {
            ext.emitter.on("connect", () => connects++)
        },
    })
    ;({ run, DataBase: DB } = h)
    for (const name of ["variableCreate", "variableUpdate", "variableDelete"]) {
        h.extension.emitter.on(name, (payload) => emitted.push({ name, payload }))
    }
})
after(async () => {
    await DB.close()
})

const take = () => emitted.splice(0)
const plain = (r) => r && { identifier: r.identifier, name: r.name, id: r.id, type: r.type, value: r.value }

test("connect is emitted once the database is connected", () => {
    assert.equal(connects, 1)
    assert.ok(DB.connected)
})

test("create, update and delete emit the right event with the right data", async () => {
    take()
    await run("$setUserVar[coins;5]")
    let ev = take()
    assert.equal(ev.length, 1)
    assert.equal(ev[0].name, "variableCreate")
    assert.deepEqual(plain(ev[0].payload.data), { identifier: `user_coins_${ids.user}`, name: "coins", id: ids.user, type: "user", value: "5" })

    await run("$setUserVar[coins;8]")
    ev = take()
    assert.equal(ev.length, 1)
    assert.equal(ev[0].name, "variableUpdate")
    assert.equal(ev[0].payload.oldData.value, "5")
    assert.equal(ev[0].payload.newData.value, "8")
    assert.equal(ev[0].payload.newData.identifier, `user_coins_${ids.user}`)

    await run("$deleteUserVar[coins]")
    ev = take()
    assert.equal(ev.length, 1)
    assert.equal(ev[0].name, "variableDelete")
    assert.equal(ev[0].payload.data.value, "8")
})

test("deleting a variable that does not exist emits nothing", async () => {
    take()
    await run("$deleteUserVar[never-set]")
    await DB.delete({ identifier: "user_nope_1" })
    // ForgeDB emitted variableDelete with `data: null` here.
    assert.deepEqual(take(), [])
})

test("the event is emitted after the write: a listener reads the new state", async () => {
    // Each listener reads the variable back. The next write waits for that
    // read: on a database with a connection pool the read and a following
    // write could otherwise finish in either order.
    const seen = []
    let pending = []
    const read = (label, identifier, pick) => pending.push(DB.get({ identifier }).then((r) => seen.push([label, pick(r)])))
    const onCreate = ({ data }) => read("create", data.identifier, (r) => r?.value)
    const onUpdate = ({ newData }) => read("update", newData.identifier, (r) => r?.value)
    const onDelete = ({ data }) => read("delete", data.identifier, (r) => r)
    h.extension.emitter.on("variableCreate", onCreate).on("variableUpdate", onUpdate).on("variableDelete", onDelete)
    try {
        for (const code of ["$setGlobalVar[order;1]", "$setGlobalVar[order;2]", "$deleteGlobalVar[order]"]) {
            await run(code)
            assert.equal(pending.length, 1, `one event for ${code}`)
            await Promise.all(pending)
            pending = []
        }
    } finally {
        h.extension.emitter.off("variableCreate", onCreate).off("variableUpdate", onUpdate).off("variableDelete", onDelete)
    }
    // ForgeDB emitted before writing: listeners saw undefined, "1" and the still-present row.
    assert.deepEqual(seen, [
        ["create", "1"],
        ["update", "2"],
        ["delete", null],
    ])
    take()
})

test("no event when the write fails", async () => {
    take()
    await assert.rejects(DB.set({ type: "user", id: "1", value: "x" }), /needs a name/)
    await assert.rejects(DB.set({ name: "x", id: "1", value: "x" }), /has no type/)
    assert.deepEqual(take(), [])
})

test("a listener that throws does not break the write or other listeners", async () => {
    const boom = () => {
        throw new Error("listener exploded")
    }
    h.extension.emitter.prependListener("variableCreate", boom)
    await run("$setGlobalVar[safe;1]")
    h.extension.emitter.off("variableCreate", boom)
    assert.equal(await run("$getGlobalVar[safe]"), "1")
    assert.ok(h.logsOf("error").some((l) => /variableCreate listener threw/.test(l)))
    await run("$deleteGlobalVar[safe]")
    take()
})

test("$deleteRecords emits variableDelete for each deleted variable; $wipeDB emits none", async () => {
    await run(`$setUserVar[bulk;1]$setUserVar[bulk;2;${ids.user2}]$setUserVar[bulk;3;${ids.user3}]`)
    take()
    await run("$deleteRecords[bulk]")
    const ev = take()
    assert.deepEqual(ev.map((e) => e.name), ["variableDelete", "variableDelete", "variableDelete"])
    assert.deepEqual(ev.map((e) => e.payload.data.value).sort(), ["1", "2", "3"])
    await run("$setUserVar[bulk;1]")
    take()
    await run("$wipeDB")
    assert.deepEqual(take(), [])
})

test("event commands read the data with $data, $newData and $oldData", async () => {
    const add = (type, code) => h.extension.commands.add({ type, code })
    add("variableCreate", "$testRecord[create:$data[name]:$data[id]:$data[type]:$data[value]:$data[identifier]:$newData[value]:$oldData[value]]")
    add("variableUpdate", "$testRecord[update:$oldData[value]->$newData[value]:$data[value]:$newData[name]]")
    add("variableDelete", "$testRecord[delete:$data[value]:$oldData[value]:$newData[value]:$data[guildId]]")
    recorded.length = 0
    await run("$setMemberVar[xp;1]")
    await run("$setMemberVar[xp;2]")
    await run("$deleteMemberVar[xp]")
    await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(recorded, [
        `create:xp:${ids.user}:member:1:member_xp_${ids.guild}_${ids.user}:1:`,
        "update:1->2:2:xp",
        `delete:2:2::${ids.guild}`,
    ])
})

test("$data, $newData and $oldData return nothing outside events", async () => {
    // ForgeDB threw a TypeError here, which silently stopped the command.
    assert.equal(await run("[$data[name]|$newData[value]|$oldData[id]]"), "[||]")
    assert.equal(await run("$data[value]", { extras: { data: null } }), "")
    assert.equal(await run("$data[value]", { extras: "not an object" }), "")
})

test("a failing event command is logged and never crashes the process", async () => {
    const before = h.logsOf("error").length
    let unhandled = 0
    const onUnhandled = () => unhandled++
    process.on("unhandledRejection", onUnhandled)
    h.extension.commands.add({ type: "variableCreate", code: "$getRoleVar[x]$testRecord[unreachable]" })
    recorded.length = 0
    await run("$setGlobalVar[trigger;1]")
    await new Promise((r) => setTimeout(r, 100))
    process.off("unhandledRejection", onUnhandled)
    assert.equal(unhandled, 0)
    assert.ok(!recorded.includes("unreachable"))
    assert.ok(h.logsOf("error").length >= before)
    assert.equal(await run("$getGlobalVar[trigger]"), "1", "the write itself succeeded")
})
