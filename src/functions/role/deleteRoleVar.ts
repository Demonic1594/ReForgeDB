import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$deleteRoleVar",
    version: "2.0.0",
    description: "Deletes a value from a role variable (also works for a deleted role)",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the variable",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "role ID",
            description: "The ID of the role",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "guild ID",
            description: "The guild of the role, defaults to the guild of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, role, guild]) {
        return guarded(this, async () => {
            await DataBase.delete({ name, id: requireId(role, undefined, "role ID"), type: "role", guildId: requireId(guild, ctx.guild?.id, "guild ID") })
            return this.success()
        })
    },
})
