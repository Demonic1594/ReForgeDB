import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$deleteGuildVar",
    version: "2.0.0",
    description: "Removes a value from a guild variable",
    aliases: ["$deleteServerVar"],
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
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    async execute(ctx, [name, guild]) {
        return guarded(this, async () => {
            await DataBase.delete({ name, id: requireId(guild, ctx.guild?.id, "guild ID"), type: "guild" })
            return this.success()
        })
    },
})
