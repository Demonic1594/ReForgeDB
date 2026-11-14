import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$setMemberVar",
    version: "2.0.0",
    description: "Sets a member's value in a variable",
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "value",
            description: "The value to set",
            rest: false,
            required: true,
            type: ArgType.String,
        },
        {
            name: "member ID",
            description: "The ID of the member, defaults to the member of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
        {
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: ArgType.Guild,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, value, member, guild]) {
        return guarded(this, async () => {
            const id = requireId(member, ctx.member?.id ?? (ctx.guild ? ctx.user?.id : undefined), "member ID")
            await DataBase.set({ name, id, value, type: "member", guildId: requireId(guild, ctx.guild?.id, "guild ID") })
            return this.success()
        })
    },
})
