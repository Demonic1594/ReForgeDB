import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$deleteMessageVar",
    version: "2.0.0",
    description: "Deletes a value from a message variable",
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
    ],
    async execute(ctx, [name, message]) {
        return guarded(this, async () => {
            await DataBase.delete({ name, id: requireId(message, ctx.message?.id, "message ID"), type: "message" })
            return this.success()
        })
    },
})
