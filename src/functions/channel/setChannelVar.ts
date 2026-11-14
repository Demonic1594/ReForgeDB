import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { channelScope, guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$setChannelVar",
    version: "2.0.0",
    description: "Assigns a value to a variable associated with a channel",
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to set the value in",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "value",
            description: "The value to be assigned",
            rest: false,
            required: true,
            type: ArgType.String,
        },
        {
            name: "channel ID",
            description: "The channel ID, defaults to the channel of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, value, channel]) {
        return guarded(this, async () => {
            const { id, guildId } = await channelScope(ctx, channel)
            await DataBase.set({ name, id, value, type: "channel", guildId })
            return this.success()
        })
    },
})
