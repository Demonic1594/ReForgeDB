"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$deleteRecords",
    version: "2.0.8",
    aliases: ["$deleteVars", "$deleteVariables"],
    description: "Deletes the variables matching your inputs. At least one input is required (use $wipeDB to delete everything). Name and value accept % (any text) and _ (one character)",
    output: forgescript_1.ArgType.Unknown,
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
            description: "The guild to which the member, channel, or role belongs (also a guild the bot left).",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(_ctx, [name, id, type, value, guild]) {
        return (0, functions_1.guarded)(this, async () => {
            const filter = {
                name: (0, functions_1.pickText)(name),
                id: (0, functions_1.pickId)(id),
                type: (0, functions_1.variableTypeOf)(type),
                value: (0, functions_1.pickText)(value),
                guildId: (0, functions_1.pickId)(guild),
            };
            // An empty filter matched every variable: one unset $get[] wiped the database.
            if (Object.values(filter).every((v) => v === undefined)) {
                return this.customError("[ReForgeDB] $deleteRecords needs at least one filter; use $wipeDB to delete everything");
            }
            await util_1.DataBase.deleteMatching(filter);
            return this.success();
        });
    },
});
//# sourceMappingURL=deleteRecords.js.map