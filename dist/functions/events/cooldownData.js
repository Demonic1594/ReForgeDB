"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CooldownDataType = void 0;
const forgescript_1 = require("@tryforge/forgescript");
/** The properties of an expired cooldown $cooldownData can read. */
var CooldownDataType;
(function (CooldownDataType) {
    CooldownDataType[CooldownDataType["identifier"] = 0] = "identifier";
    CooldownDataType[CooldownDataType["name"] = 1] = "name";
    CooldownDataType[CooldownDataType["id"] = 2] = "id";
    CooldownDataType[CooldownDataType["startedAt"] = 3] = "startedAt";
    CooldownDataType[CooldownDataType["duration"] = 4] = "duration";
    CooldownDataType[CooldownDataType["expiredAt"] = 5] = "expiredAt";
})(CooldownDataType || (exports.CooldownDataType = CooldownDataType = {}));
exports.default = new forgescript_1.NativeFunction({
    name: "$cooldownData",
    version: "3.2.0",
    description: "Retrieves data of the cooldown that ran out in a cooldownExpire event: its identifier, name, ID (empty for global cooldowns), start, duration and end in ms. Returns nothing outside this event",
    unwrap: true,
    args: [
        {
            name: "property",
            description: "The property to retrieve",
            rest: false,
            type: forgescript_1.ArgType.Enum,
            enum: CooldownDataType,
            required: true,
        },
    ],
    brackets: true,
    execute(ctx, [property]) {
        const extras = ctx.runtime.extras;
        const cooldown = extras && typeof extras === "object" && extras.event === "cooldownExpire" ? extras.cooldown : undefined;
        const value = cooldown?.[CooldownDataType[property]];
        return this.success(value === undefined ? null : value);
    },
});
//# sourceMappingURL=cooldownData.js.map