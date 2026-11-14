import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$dbPing",
    aliases: ["$dbLatency"],
    version: "2.0.9",
    description: "Returns the database round trip in ms (works on every database type, MongoDB included)",
    output: ArgType.Number,
    unwrap: true,
    brackets: false,
    args: [
        {
            name: "full",
            description: "Return every decimal instead of 2",
            type: ArgType.Boolean,
            required: false,
            rest: false,
        },
    ],
    async execute(_ctx, [full]) {
        return guarded(this, async () => {
            const ms = await DataBase.ping()
            return this.success(full ? ms : Number(ms.toFixed(2)))
        })
    },
})
