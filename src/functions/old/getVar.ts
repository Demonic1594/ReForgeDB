import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { guarded, readVariable } from "../../util/functions"

export default new NativeFunction({
    name: "$getVar",
    version: "1.0.0",
    description: "Returns an identifier's value in a variable (legacy: prefer the typed functions such as $getUserVar)",
    output: ArgType.Unknown,
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the variable",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "id",
            description: "The identifier for the value (a user, guild, channel, message, etc)",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "default",
            description: "The value to return when the variable was never set",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, id, def]) {
        return guarded(this, () => readVariable(this, ctx, { name, id, type: "old" }, def))
    },
})
