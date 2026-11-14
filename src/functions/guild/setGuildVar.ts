import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$setGuildVar",
    version: "2.0.0",
    description: "Assigns a value to a variable associated with a guild",
    aliases: ["$setServerVar"],
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
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, value, guild]) {
        return guarded(this, async () => {
            await DataBase.set({ name, id: requireId(guild, ctx.guild?.id, "guild ID"), value, type: "guild" })
            return this.success()
        })
    },
})
