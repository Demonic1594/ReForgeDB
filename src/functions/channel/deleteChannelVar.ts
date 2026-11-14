import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { channelScope, guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$deleteChannelVar",
    version: "2.0.0",
    description: "Removes a value from a variable associated with a channel (also works for a deleted channel)",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the variable.",
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
    async execute(ctx, [name, channel]) {
        return guarded(this, async () => {
            const { id, guildId } = await channelScope(ctx, channel)
            await DataBase.delete({ name, id, type: "channel", guildId })
            return this.success()
        })
    },
})
