import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$deleteGlobalVar",
    version: "2.0.0",
    description: "Removes a global variable",
    unwrap: true,
    brackets: true,
    args: [
        {
            name: "name",
            description: "The name of the variable to remove",
            rest: false,
            type: ArgType.String,
            required: true,
        },
    ],
    async execute(_ctx, [name]) {
        return guarded(this, async () => {
            await DataBase.delete({ name, type: "custom" })
            return this.success()
        })
    },
})
