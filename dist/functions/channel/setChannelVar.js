"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$setChannelVar",
    version: "2.0.0",
    description: "Assigns a value to a variable associated with a channel",
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to set the value in",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "value",
            description: "The value to be assigned",
            rest: false,
            required: true,
            type: forgescript_1.ArgType.String,
        },
        {
            name: "channel ID",
            description: "The channel ID, defaults to the channel of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    brackets: true,
    async execute(ctx, [name, value, channel]) {
        return (0, functions_1.guarded)(this, async () => {
            const { id, guildId } = await (0, functions_1.channelScope)(ctx, channel);
            await util_1.DataBase.set({ name, id, value, type: "channel", guildId });
            return this.success();
        });
    },
});
//# sourceMappingURL=setChannelVar.js.map