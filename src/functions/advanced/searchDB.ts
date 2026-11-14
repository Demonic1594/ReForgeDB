import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase, VariableType } from "../../util"
import { guarded, pickId, pickText, variableTypeOf } from "../../util/functions"

export default new NativeFunction({
    name: "$searchDB",
    aliases: ["$searchRecords", "$searchDataBase"],
    version: "2.0.0",
    description: "Returns the variables matching your inputs as JSON. Name and value accept % (any text) and _ (one character)",
    output: ArgType.Json,
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
            description: "The guild to which the member, channel, or role belongs.",
            rest: false,
            type: ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(_ctx, [name, id, type, value, guild]) {
        return guarded(this, async () => {
            const rows = await DataBase.search({
                name: pickText(name),
                id: pickId(id),
                type: variableTypeOf(type),
                value: pickText(value),
                guildId: pickId(guild),
            })
            return this.successJSON(rows)
        })
    },
})
