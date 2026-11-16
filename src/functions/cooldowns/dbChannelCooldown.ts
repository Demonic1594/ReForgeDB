// Persistent cooldown, stored in the database: it survives restarts.
// ForgeScript has an in-memory $channelCooldown with other arguments. ForgeDB replaced it
// with its own of the same name; ReForgeDB leaves the name to ForgeScript and uses the "db" prefix.
import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { cooldownGate, guarded, requireId, resolveArgs } from "../../util/functions"

export default new NativeFunction({
    name: "$dbChannelCooldown",
    version: "3.0.0",
    description: "Starts a channel cooldown stored in the database, or, while it is running, sends the code and stops the command ($env[time] holds the ms left)",
    brackets: true,
    unwrap: false,
    args: [
        {
            name: "name",
            description: "The name of the cooldown, e.g. the command name",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "duration",
            description: "The duration of the cooldown",
            rest: false,
            type: ArgType.Time,
            required: true,
        },
        {
            name: "code",
            description: "The code to send while the cooldown is running; $env[time] holds the ms left",
            rest: false,
            type: ArgType.String,
            required: false,
        },
        {
            name: "channel ID",
            description: "The channel ID, defaults to the channel of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx) {
        return guarded(this, async () => {
            const args = await resolveArgs(this, ctx, [0, 1, 3])
            if ("fail" in args) return args.fail
            const [name, duration, id] = args.values as [string, number, unknown]
            return cooldownGate(this, ctx, { ...{ name: name, id: requireId(id, ctx.channel?.id, "channel ID") }, duration }, 2)
        })
    },
})
