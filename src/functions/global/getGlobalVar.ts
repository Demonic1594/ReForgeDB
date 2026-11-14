import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { guarded, readVariable } from "../../util/functions"

export default new NativeFunction({
    name: "$getGlobalVar",
    version: "2.0.0",
    description: "Retrieves the value of a global variable",
    output: ArgType.Unknown,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to query",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "default",
            description: "The value to return when the variable was never set",
            rest: false,
            required: false,
            type: ArgType.String,
        },
    ],
    brackets: true,
    async execute(ctx, [name, def]) {
        return guarded(this, () => readVariable(this, ctx, { name, type: "custom" }, def))
    },
})
