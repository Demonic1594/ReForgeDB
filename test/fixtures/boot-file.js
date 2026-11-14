"use strict"
// Boots ReForgeDB on SQLite in its own process (the configuration is per
// process) and prints which file it opened and what it read.
// Usage: node boot-file.js <folder> <forgeDBFile or "">
const path = require("path")
const { ForgeClient, Logger } = require("@tryforge/forgescript")
const { ReForgeDB } = require(path.join(__dirname, "..", ".."))
const [folder, forgeDBFile] = process.argv.slice(2)
const lines = []
Logger.log = (_p, _t, ...args) => lines.push(args.join(" "))
const options = { type: "sqlite", folder, logLevel: "info" }
if (forgeDBFile) options.forgeDBFile = forgeDBFile
const client = new ForgeClient({ intents: ["Guilds"], extensions: [new ReForgeDB(options)] })
;(async () => {
    try {
        await ReForgeDB.ready(10_000)
        const row = await client.db.get({ name: "coins", id: "1", type: "user" })
        await client.db.set({ name: "written", id: "1", type: "user", value: "yes" })
        console.log(JSON.stringify({ file: path.basename(client.db.dataSource.options.database), coins: row?.value ?? null, logs: lines.filter((l) => l.startsWith("[ReForgeDB]")) }))
        await client.db.close()
    } catch (err) {
        console.log(JSON.stringify({ error: err.message, logs: lines }))
    }
    process.exit(0)
})()
