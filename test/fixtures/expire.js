"use strict"
// One bot process that listens to cooldownExpire for a while and prints the
// identifiers it fired. Usage: node expire.js <options JSON> <listen ms>
const path = require("path")
const { ForgeClient, Logger } = require("@tryforge/forgescript")
const { ReForgeDB } = require(path.join(__dirname, "..", ".."))
const [optionsJson, listenMs] = process.argv.slice(2)
Logger.log = () => {}
const db = new ReForgeDB({ ...JSON.parse(optionsJson), logLevel: "silent", cooldownSweepInterval: 0, cooldownExpireInterval: 50, events: ["cooldownExpire"] })
const client = new ForgeClient({ intents: ["Guilds"], extensions: [db] })
const fired = []
db.emitter.on("cooldownExpire", ({ cooldown }) => fired.push(cooldown.identifier))
;(async () => {
    try {
        await ReForgeDB.ready(20_000)
        await new Promise((r) => setTimeout(r, Number(listenMs)))
        console.log(JSON.stringify({ fired }))
    } catch (err) {
        console.log(JSON.stringify({ error: err.message }))
    }
    await client.db.close().catch(() => undefined)
    process.exit(0)
})()
