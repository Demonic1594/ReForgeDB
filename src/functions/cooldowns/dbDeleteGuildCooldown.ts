import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$dbDeleteGuildCooldown",
    version: "3.0.0",
    description: "Ends a guild cooldown started with $dbGuildCooldown",
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
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, id]) {
        return guarded(this, async () => {
            await DataBase.cdDelete(DataBase.make_cdIdentifier({ name: name, id: requireId(id, ctx.guild?.id, "guild ID") }))
            return this.success()
        })
    },
})
