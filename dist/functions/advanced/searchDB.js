"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$searchDB",
    aliases: ["$searchRecords", "$searchDataBase"],
    version: "2.0.0",
    description: "Returns the variables matching your inputs as JSON. Name and value accept % (any text) and _ (one character)",
    output: forgescript_1.ArgType.Json,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The variable name; % matches any text, _ one character.",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
        {
            name: "id",
            description: "The ID of the user, guild, channel, or any other type.",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
        {
            name: "type",
            description: "The type of the variable.",
            rest: false,
            type: forgescript_1.ArgType.Enum,
            enum: util_1.VariableType,
            required: false,
        },
        {
            name: "value",
            description: "The value; % matches any text, _ one character.",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
        {
            name: "guild ID",
            description: "The guild to which the member, channel, or role belongs.",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(_ctx, [name, id, type, value, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            const rows = await util_1.DataBase.search({
                name: (0, functions_1.pickText)(name),
                id: (0, functions_1.pickId)(id),
                type: (0, functions_1.variableTypeOf)(type),
                value: (0, functions_1.pickText)(value),
                guildId: (0, functions_1.pickId)(guild),
            });
            return this.successJSON(rows);
        });
    },
});
//# sourceMappingURL=searchDB.js.map