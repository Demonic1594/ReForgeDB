import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$setVar",
    version: "1.0.0",
    description: "Sets an identifier's value in a variable (legacy: prefer the typed functions such as $setUserVar)",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the variable",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "id",
            description: "The identifier for the value (a user, guild, channel, message, etc)",
            rest: false,
            type: ArgType.String,
            required: true,
        },
        {
            name: "value",
            description: "The value",
            rest: false,
            type: ArgType.String,
            required: true,
        },
    ],
    async execute(_ctx, [name, id, value]) {
        return guarded(this, async () => {
            await DataBase.set({ name, id, value, type: "old" })
            return this.success()
        })
    },
})
