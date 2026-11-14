import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$dbDeleteMemberCooldown",
    version: "3.0.0",
    description: "Ends a member cooldown started with $dbMemberCooldown",
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
    async execute(ctx, [name, id, guild]) {
        return guarded(this, async () => {
            await DataBase.cdDelete(
                DataBase.make_cdIdentifier({ name: `${name}-${requireId(guild, ctx.guild?.id, "guild ID")}`, id: requireId(id, ctx.member?.id ?? (ctx.guild ? ctx.user?.id : undefined), "member ID") })
            )
            return this.success()
        })
    },
})
