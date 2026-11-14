import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { join } from "path"
import { DataBase } from "../../util"
import { guarded } from "../../util/functions"
import { ReForgeDBError } from "../../util/logger"

/** A plain file name: no folders, no leading dot, letters, digits, `-`, `_` and `.` only. */
const SAFE_NAME = /^(?!\.)[\w.-]{1,100}$/

export default new NativeFunction({
    name: "$dbBackup",
    version: "3.2.0",
    description: "SQLite: writes a consistent copy of the database into the backups folder next to it while the bot runs, and returns its path. Never overwrites a file. Other databases: an error that names client.db.export()",
    unwrap: true,
    args: [
        {
            name: "file name",
            description: "Name of the copy in the backups folder (a plain file name; .db is added). Defaults to reforge-<date>.db",
            rest: false,
            type: ArgType.String,
        },
    ],
    brackets: false,
    output: ArgType.String,
    async execute(ctx, [name]) {
        return guarded(this, async () => {
            let file: string | undefined
            if (name) {
                const base = name.endsWith(".db") ? name : `${name}.db`
                if (!SAFE_NAME.test(base) || base.includes("..")) {
                    throw new ReForgeDBError(`"${name}" is not a plain file name: use letters, digits, "-", "_" and "." only, without folders`)
                }
                const db = DataBase.dataSource
                const folder = db ? join(String(db.options.database), "..", "backups") : "backups"
                file = join(folder, base)
            }
            return this.success(await DataBase.backup(file))
        })
    },
})
