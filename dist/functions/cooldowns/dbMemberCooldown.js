"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Persistent cooldown, stored in the database: it survives restarts.
// ForgeScript has an in-memory $memberCooldown with other arguments. ForgeDB replaced it
// with its own of the same name; ReForgeDB leaves the name to ForgeScript and uses the "db" prefix.
const forgescript_1 = require("@tryforge/forgescript");
const functions_1 = require("../../util/functions");
exports.default = new forgescript_1.NativeFunction({
    name: "$dbMemberCooldown",
    version: "3.0.0",
    description: "Starts a member cooldown stored in the database, or, while it is running, sends the code and stops the command ($env[time] holds the ms left)",
    brackets: true,
    unwrap: false,
    args: [
        {
            name: "name",
            description: "The name of the cooldown, e.g. the command name",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: true,
        },
        {
            name: "duration",
            description: "The duration of the cooldown",
            rest: false,
            type: forgescript_1.ArgType.Time,
            required: true,
        },
        {
            name: "code",
            description: "The code to send while the cooldown is running; $env[time] holds the ms left",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
        {
            name: "member ID",
            description: "The member ID, defaults to the member of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
        {
            name: "guild ID",
            description: "The guild ID, defaults to the guild of the command",
            rest: false,
            type: forgescript_1.ArgType.String,
            required: false,
        },
    ],
    async execute(ctx) {
        return (0, functions_1.guarded)(this, async () => {
            const args = await (0, functions_1.resolveArgs)(this, ctx, [0, 1, 3, 4]);
            if ("fail" in args)
                return args.fail;
            const [name, duration, id, guild] = args.values;
            return (0, functions_1.cooldownGate)(this, ctx, { ...{ name: `${name}-${(0, functions_1.requireId)(guild, ctx.guild?.id, "guild ID")}`, id: (0, functions_1.requireId)(id, ctx.member?.id ?? (ctx.guild ? ctx.user?.id : undefined), "member ID") }, duration }, 2);
        });
    },
});
//# sourceMappingURL=dbMemberCooldown.js.map