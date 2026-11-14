"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const path_1 = require("path");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
const logger_1 = require("../../util/logger");
/** A plain file name: no folders, no leading dot, letters, digits, `-`, `_` and `.` only. */
const SAFE_NAME = /^(?!\.)[\w.-]{1,100}$/;
exports.default = new forgescript_1.NativeFunction({
    name: "$dbBackup",
    version: "3.2.0",
    description: "SQLite: writes a consistent copy of the database into the backups folder next to it while the bot runs, and returns its path. Never overwrites a file. Other databases: an error that names client.db.export()",
    unwrap: true,
    args: [
        {
            name: "file name",
            description: "Name of the copy in the backups folder (a plain file name; .db is added). Defaults to reforge-<date>.db",
            rest: false,
            type: forgescript_1.ArgType.String,
        },
    ],
    brackets: false,
    output: forgescript_1.ArgType.String,
    async execute(ctx, [name]) {
        return (0, functions_1.guarded)(this, async () => {
            let file;
            if (name) {
                const base = name.endsWith(".db") ? name : `${name}.db`;
                if (!SAFE_NAME.test(base) || base.includes("..")) {
                    throw new logger_1.ReForgeDBError(`"${name}" is not a plain file name: use letters, digits, "-", "_" and "." only, without folders`);
                }
                const db = util_1.DataBase.dataSource;
                const folder = db ? (0, path_1.join)(String(db.options.database), "..", "backups") : "backups";
                file = (0, path_1.join)(folder, base);
            }
            return this.success(await util_1.DataBase.backup(file));
        });
    },
});
//# sourceMappingURL=dbBackup.js.map