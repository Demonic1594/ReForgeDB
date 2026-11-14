import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { channelScope, guarded, readVariable } from "../../util/functions"

export default new NativeFunction({
    name: "$getChannelVar",
    version: "2.0.0",
    description: "Retrieves the value of a variable associated with a channel",
    output: ArgType.Unknown,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to query",
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
        {
            name: "default",
            description: "The value to return when the variable was never set",
            rest: false,
            required: false,
            type: ArgType.String,
        },
    ],
    brackets: true,
    async execute(ctx, [name, channel, def]) {
        return guarded(this, async () => {
            const { id, guildId } = await channelScope(ctx, channel)
            return readVariable(this, ctx, { name, id, type: "channel", guildId }, def)
        })
    },
})
