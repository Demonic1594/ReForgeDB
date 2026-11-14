import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { guarded, readVariable, requireId } from "../../util/functions"

export default new NativeFunction({
    name: "$getGuildVar",
    version: "2.0.0",
    description: "Retrieves the value of a variable associated with a guild",
    aliases: ["$getServerVar"],
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
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
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
    async execute(ctx, [name, guild, def]) {
        return guarded(this, () => readVariable(this, ctx, { name, id: requireId(guild, ctx.guild?.id, "guild ID"), type: "guild" }, def))
    },
})
