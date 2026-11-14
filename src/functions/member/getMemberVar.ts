import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { guarded, readVariable, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$getMemberVar",
    version: "2.0.0",
    description: "Retrieves the value of a variable associated with a member",
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
            name: "member ID",
            description: "The member ID, defaults to the member of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
        {
            name: "guild ID",
            description: "The guild ID to which the member belongs, defaults to the guild of the command",
            rest: false,
            type: ArgType.Guild,
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
    async execute(ctx, [name, member, guild, def]) {
        return guarded(this, () => {
            const id = requireId(member, ctx.member?.id ?? (ctx.guild ? ctx.user?.id : undefined), "member ID")
            return readVariable(this, ctx, { name, id, type: "member", guildId: requireId(guild, ctx.guild?.id, "guild ID") }, def)
        })
    },
})
