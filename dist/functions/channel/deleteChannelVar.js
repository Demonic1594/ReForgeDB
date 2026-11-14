"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$deleteChannelVar",
    version: "2.0.0",
    description: "Removes a value from a variable associated with a channel (also works for a deleted channel)",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the variable.",
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
    ],
    async execute(ctx, [name, channel]) {
        return (0, functions_1.guarded)(this, async () => {
            const { id, guildId } = await (0, functions_1.channelScope)(ctx, channel);
            await util_1.DataBase.delete({ name, id, type: "channel", guildId });
            return this.success();
        });
    },
});
//# sourceMappingURL=deleteChannelVar.js.map