import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$deleteMemberVar",
    version: "2.0.0",
    description: "Removes a value from a member variable",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the variable from which to remove the value",
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
            description: "The guild to which the member belongs, defaults to the guild of the command (also works for a guild the bot left)",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, member, guild]) {
        return guarded(this, async () => {
            const id = requireId(member, ctx.member?.id ?? (ctx.guild ? ctx.user?.id : undefined), "member ID")
            await DataBase.delete({ name, id, type: "member", guildId: requireId(guild, ctx.guild?.id, "guild ID") })
            return this.success()
        })
    },
})
