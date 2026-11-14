"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$oldData",
    version: "2.0.0",
    description: "Retrieves the old data of the variable in a variableUpdate event (the deleted data in variableDelete). Returns nothing outside these events",
    unwrap: true,
    args: [
        {
            name: "type",
            description: "The property to retrieve",
            rest: false,
            type: forgescript_1.ArgType.Enum,
            enum: util_1.DataType,
            required: true,
        },
    ],
    brackets: true,
    execute(ctx, [type]) {
        const record = (0, functions_1.eventRecord)(ctx, "oldData");
        const value = record?.[util_1.DataType[type]];
        return this.success(value === undefined ? null : value);
    },
});
//# sourceMappingURL=oldData.js.map