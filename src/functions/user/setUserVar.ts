import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$setUserVar",
    version: "2.0.0",
    description: "Sets a user's value in a variable",
    unwrap: true,
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
            name: "user ID",
            description: "The user ID, defaults to the user of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, value, user]) {
        return guarded(this, async () => {
            await DataBase.set({ name, id: requireId(user, ctx.user?.id, "user ID"), value, type: "user" })
            return this.success()
        })
    },
})
