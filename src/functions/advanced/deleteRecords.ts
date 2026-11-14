import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase, VariableType } from "../../util"
import { guarded, pickId, pickText, variableTypeOf } from "../../util/functions"

export default new NativeFunction({
    name: "$deleteRecords",
    version: "2.0.8",
    aliases: ["$deleteVars", "$deleteVariables"],
    description: "Deletes the variables matching your inputs. At least one input is required (use $wipeDB to delete everything). Name and value accept % (any text) and _ (one character)",
    output: ArgType.Unknown,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The variable name; % matches any text, _ one character.",
            rest: false,
            type: ArgType.String,
            required: false,
        },
        {
            name: "id",
            description: "The ID of the user, guild, channel, or any other type.",
            rest: false,
            type: ArgType.String,
            required: false,
        },
        {
            name: "type",
            description: "The type of the variable.",
            rest: false,
            type: ArgType.Enum,
            enum: VariableType,
            required: false,
        },
        {
            name: "value",
            description: "The value; % matches any text, _ one character.",
            rest: false,
            type: ArgType.String,
            required: false,
        },
        {
            name: "guild ID",
            description: "The guild to which the member, channel, or role belongs (also a guild the bot left).",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(_ctx, [name, id, type, value, guild]) {
        return guarded(this, async () => {
            const filter = {
                name: pickText(name),
                id: pickId(id),
                type: variableTypeOf(type),
                value: pickText(value),
                guildId: pickId(guild),
            }
            // An empty filter matched every variable: one unset $get[] wiped the database.
            if (Object.values(filter).every((v) => v === undefined)) {
                return this.customError("[ReForgeDB] $deleteRecords needs at least one filter; use $wipeDB to delete everything")
            }
            await DataBase.deleteMatching(filter)
            return this.success()
        })
    },
})
