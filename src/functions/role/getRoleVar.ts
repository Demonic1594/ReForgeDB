import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { guarded, readVariable } from "../../util/functions"

export default new NativeFunction({
    name: "$getRoleVar",
    version: "2.0.0",
    description: "Retrieves the value of a variable associated with a role",
    output: ArgType.Unknown,
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
            description: "The ID of a role of the current guild",
            rest: false,
            type: ArgType.Role,
            required: true,
        },
        {
            name: "default",
            description: "The value to return when the variable was never set",
            rest: false,
            required: false,
            type: ArgType.String,
        },
    ],
    async execute(ctx, [name, role, def]) {
        return guarded(this, () => readVariable(this, ctx, { name, id: role.id, type: "role", guildId: role.guild.id }, def))
    },
})
