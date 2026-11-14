import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$dbDeleteUserCooldown",
    version: "3.0.0",
    description: "Ends a user cooldown started with $dbUserCooldown",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the cooldown",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "user ID",
            description: "The user ID, defaults to the user of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, id]) {
        return guarded(this, async () => {
            await DataBase.cdDelete(DataBase.make_cdIdentifier({ name: name, id: requireId(id, ctx.user?.id, "user ID") }))
            return this.success()
        })
    },
})
