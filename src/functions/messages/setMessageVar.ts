import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$setMessageVar",
    version: "2.0.0",
    description: "Sets a message's value in a variable",
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
            name: "value",
            description: "The value",
            rest: false,
            required: true,
            type: ArgType.String,
        },
        {
            name: "message ID",
            description: "The message ID, defaults to the message of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, value, message]) {
        return guarded(this, async () => {
            await DataBase.set({ name, id: requireId(message, ctx.message?.id, "message ID"), value, type: "message" })
            return this.success()
        })
    },
})
