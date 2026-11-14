"use strict"
/*
 * Boots ReForgeDB in its own process (the configuration is per process) on
 * the SQLite file in <folder> with the given driver, runs one step of a test,
 * and prints its result as JSON on the last line.
 *
 * Usage: node driver.js <sqlite|better-sqlite3> <folder> <options JSON> <step>
 * <step> is the body of an async function receiving the booted harness `h`
 * (h.run, h.exec, h.DataBase, h.client, ...), `require`, `path` and `crash()`, which ends the
 * process at once, without closing the database, like a crash or a kill -9.
 */
const path = require("path")
const { boot } = require("./harness")

const [type, folder, optionsJson, body] = process.argv.slice(2)
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor

;(async () => {
    let h
    try {
        h = await boot({ dir: folder, type, logLevel: "warn", cooldownSweepInterval: 0, ...JSON.parse(optionsJson || "{}") })
        const crash = () => process.kill(process.pid, "SIGKILL")
        const out = await new AsyncFunction("h", "crash", "path", "require", body)(h, crash, path, require)
        const driver = h.DataBase.dataSource?.driver?.constructor?.name
        console.log(JSON.stringify({ ok: true, out, driver, logs: h.logsOf("warn", "error") }))
        await h.DataBase.close()
    } catch (err) {
        console.log(JSON.stringify({ ok: false, error: String(err?.message ?? err), logs: h ? h.logsOf("warn", "error") : [] }))
    }
    process.exit(0)
})()
