import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$deleteGlobalCooldown",
    aliases: ["$dbDeleteGlobalCooldown"],
    version: "2.0.0",
    description: "Ends a global cooldown",
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
        return guarded(this, async () => {
            await DataBase.cdDelete(DataBase.make_cdIdentifier({ name }))
            return this.success()
        })
    },
})
