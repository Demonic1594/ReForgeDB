"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$getChannelVar",
    version: "2.0.0",
    description: "Retrieves the value of a variable associated with a channel",
    output: forgescript_1.ArgType.Unknown,
    unwrap: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to query",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "channel ID",
            description: "The channel ID, defaults to the channel of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
        {
            name: "default",
            description: "The value to return when the variable was never set",
            rest: false,
            required: false,
            type: forgescript_1.ArgType.String,
        },
    ],
    brackets: true,
    async execute(ctx, [name, channel, def]) {
        return (0, functions_1.guarded)(this, async () => {
            const { id, guildId } = await (0, functions_1.channelScope)(ctx, channel);
            return (0, functions_1.readVariable)(this, ctx, { name, id, type: "channel", guildId }, def);
        });
    },
});
//# sourceMappingURL=getChannelVar.js.map