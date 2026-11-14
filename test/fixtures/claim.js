"use strict"
// One bot process that claims a cooldown many times at an agreed moment.
// Usage: node claim.js <options JSON> <start at (ms epoch)> <cooldown name> <claims>
const path = require("path")
const { ForgeClient, Logger } = require("@tryforge/forgescript")
const { ReForgeDB } = require(path.join(__dirname, "..", ".."))
const [optionsJson, startAt, name, claims] = process.argv.slice(2)
Logger.log = () => {}
const client = new ForgeClient({ intents: ["Guilds"], extensions: [new ReForgeDB({ ...JSON.parse(optionsJson), logLevel: "silent", cooldownSweepInterval: 0 })] })
;(async () => {
    try {
        await ReForgeDB.ready(20_000)
        await new Promise((r) => setTimeout(r, Math.max(0, Number(startAt) - Date.now())))
        const results = await Promise.all(Array.from({ length: Number(claims) }, () => client.db.cdClaim({ name, id: "1", duration: 3_600_000 })))
        console.log(JSON.stringify({ claimed: results.filter((left) => left === 0).length, blocked: results.filter((left) => left > 0).length }))
    } catch (err) {
        console.log(JSON.stringify({ error: err.message }))
    }
    await client.db.close().catch(() => undefined)
    process.exit(0)
})()
