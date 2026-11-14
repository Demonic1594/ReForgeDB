import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$dbGetChannelCooldownTime",
    version: "3.0.0",
    description: "Returns the ms left of a channel cooldown started with $dbChannelCooldown, or 0",
    output: ArgType.Number,
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
            name: "channel ID",
            description: "The channel ID, defaults to the channel of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, id]) {
        return guarded(this, async () => {
            const key = { name: name, id: requireId(id, ctx.channel?.id, "channel ID") }
            return this.success((await DataBase.cdTimeLeft(DataBase.make_cdIdentifier(key))).left)
        })
    },
})
