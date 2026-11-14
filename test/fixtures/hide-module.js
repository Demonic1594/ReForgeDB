"use strict"
// Preload (node -r) that makes the module named in HIDE_MODULE look not installed.
const Module = require("module")
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
    // TypeORM tries the name, then <cwd>/node_modules/<name>: hide both.
    const name = process.env.HIDE_MODULE
    if (name && (request === name || request.replace(/\\/g, "/").endsWith(`/node_modules/${name}`))) {
        const err = new Error(`Cannot find module '${request}'`)
        err.code = "MODULE_NOT_FOUND"
        throw err
    }
    return resolve.call(this, request, ...rest)
}
