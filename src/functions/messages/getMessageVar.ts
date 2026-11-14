import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { guarded, readVariable, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$getMessageVar",
    version: "2.0.0",
    description: "Retrieves the value of a variable associated with a message",
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
            name: "message ID",
            description: "The message ID, defaults to the message of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
        {
            name: "default",
            description: "The value to return when the variable was never set",
            rest: false,
            required: false,
            type: ArgType.String,
        },
    ],
    async execute(ctx, [name, message, def]) {
        return guarded(this, () => readVariable(this, ctx, { name, id: requireId(message, ctx.message?.id, "message ID"), type: "message" }, def))
    },
})
