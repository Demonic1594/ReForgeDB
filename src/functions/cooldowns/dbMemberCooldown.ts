// Persistent cooldown, stored in the database: it survives restarts.
// ForgeScript has an in-memory $memberCooldown with other arguments; ForgeDB's
// version of that name never loaded, so this one has the "db" prefix.
import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { cooldownGate, guarded, requireId, resolveArgs } from "../../util/functions"

export default new NativeFunction({
    name: "$dbMemberCooldown",
    version: "3.0.0",
    description: "Starts a member cooldown stored in the database, or, while it is running, sends the code and stops the command ($env[time] holds the ms left)",
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
            name: "member ID",
            description: "The member ID, defaults to the member of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
        {
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx) {
        return guarded(this, async () => {
            const args = await resolveArgs(this, ctx, [0, 1, 3, 4])
            if ("fail" in args) return args.fail
            const [name, duration, id, guild] = args.values as [string, number, unknown, unknown]
            return cooldownGate(
                this,
                ctx,
                { ...{ name: `${name}-${requireId(guild, ctx.guild?.id, "guild ID")}`, id: requireId(id, ctx.member?.id ?? (ctx.guild ? ctx.user?.id : undefined), "member ID") }, duration },
                2
            )
        })
    },
})
