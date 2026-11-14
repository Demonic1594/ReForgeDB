"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const forgescript_1 = require("@tryforge/forgescript");
const util_1 = require("../../util");
const functions_1 = require("../../util/functions");
/*
 * Kept for old code. ForgeScript's in-memory $channelCooldown has no working
 * getter (its file registers itself as $getCooldownTime), so this function
 * answers for both: a $dbChannelCooldown of that name for the channel, or
 * else ForgeScript's in-memory channel cooldown of this command, where the
 * first argument is the channel ID.
 */
exports.default = new forgescript_1.NativeFunction({
    name: "$getChannelCooldownTime",
    version: "2.0.0",
    description: "Returns the ms left of a channel cooldown, or 0: one started with $dbChannelCooldown[name], or ForgeScript's $channelCooldown[channel ID] of this command",
    output: forgescript_1.ArgType.Number,
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The cooldown name ($dbChannelCooldown), or the channel ID (ForgeScript's $channelCooldown)",
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
            const id = (0, functions_1.pickId)(channel) ?? ctx.channel?.id;
            const stored = (await util_1.DataBase.cdTimeLeft(util_1.DataBase.make_cdIdentifier({ name, id }))).left;
            if (stored > 0)
                return this.success(stored);
            const cooldowns = ctx.client.cooldowns;
            const command = ctx.cmd?.id;
            if (command !== undefined && cooldowns?.getTimeLeft && cooldowns.identifier) {
                return this.success(cooldowns.getTimeLeft(cooldowns.identifier(command, "channel", (0, functions_1.pickId)(name) ?? id)) || 0);
            }
            return this.success(0);
        });
    },
});
//# sourceMappingURL=getChannelCooldownTime.js.map