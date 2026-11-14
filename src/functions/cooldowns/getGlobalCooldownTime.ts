import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$getGlobalCooldownTime",
    aliases: ["$dbGetGlobalCooldownTime"],
    version: "2.0.0",
    description: "Returns the ms left of a global cooldown, or 0",
    output: ArgType.Number,
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the cooldown",
            rest: false,
            type: ArgType.String,
            required: true,
        },
    ],
    async execute(_ctx, [name]) {
        return guarded(this, async () => this.success((await DataBase.cdTimeLeft(DataBase.make_cdIdentifier({ name }))).left))
    },
})
