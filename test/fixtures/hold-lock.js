"use strict"
// Another program holding the write lock of an SQLite file: takes it, prints
// "locked", keeps it for <ms>, then commits and exits.
// Usage: node hold-lock.js <file> <ms>
const Database = require("better-sqlite3")
const [file, ms] = process.argv.slice(2)
const db = new Database(file)
db.exec("BEGIN IMMEDIATE")
process.stdout.write("locked\n")
setTimeout(() => {
    db.exec("COMMIT")
    db.close()
    process.exit(0)
}, Number(ms))
