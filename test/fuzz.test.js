"use strict"
// Seeded random workloads (concurrent writes, reads, deletes, searches,
// leaderboards, 5% injected database failures), compared step by step with
// an in-memory model. Each run is its own process. Set FUZZ_SEED to replay
// one seed, FUZZ_STEPS for longer runs.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const path = require("path")
const { spawnSync } = require("child_process")

const seeds = process.env.FUZZ_SEED ? [Number(process.env.FUZZ_SEED)] : [1, 2, 3]
const steps = Number(process.env.FUZZ_STEPS || 250)

for (const cache of ["off", "on"]) {
    for (const seed of seeds) {
        test(`seed ${seed}, cache ${cache}: the database always matches the model`, { timeout: 120_000 }, () => {
            const out = spawnSync(process.execPath, [path.join(__dirname, "fixtures", "fuzz.js"), String(seed), String(steps), cache], { encoding: "utf8", timeout: 110_000 })
            const line = out.stdout.trim().split("\n").pop()
            let result
            try {
                result = JSON.parse(line)
            } catch {
                assert.fail(`no result: ${out.stdout}\n${out.stderr}`)
            }
            assert.ok(result.ok, `replay with FUZZ_SEED=${seed}: ${JSON.stringify(result.mismatch ?? result.error)}`)
            assert.ok(result.writes > 50 && result.leaderboards > 10 && result.searches > 10, JSON.stringify(result))
            assert.ok(result.failedWrites > 0, "failures were injected")
        })
    }
}
