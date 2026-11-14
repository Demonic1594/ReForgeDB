import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { guarded, readVariable, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$getUserVar",
    version: "2.0.0",
    description: "Retrieves the value of a specified variable for a user",
    output: ArgType.Unknown,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable.",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "user ID",
            description: "The user ID, defaults to the user of the command.",
            rest: false,
            type: ArgType.String,
            required: false,
        },
        {
            name: "default value",
            description: "The value to return when the variable was never set.",
            rest: false,
            required: false,
            type: ArgType.String,
        },
    ],
    brackets: true,
    async execute(ctx, [name, user, def]) {
        return guarded(this, () => readVariable(this, ctx, { name, id: requireId(user, ctx.user?.id, "user ID"), type: "user" }, def))
    },
})
