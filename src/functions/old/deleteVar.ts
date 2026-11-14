import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$deleteVar",
    version: "1.0.0",
    description: "Deletes a value from a variable (legacy: prefer the typed functions such as $deleteUserVar)",
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
            description: "The identifier of the value",
            rest: false,
            type: ArgType.String,
            required: true,
        },
    ],
    async execute(_ctx, [name, id]) {
        return guarded(this, async () => {
            await DataBase.delete({ name, id, type: "old" })
            return this.success()
        })
    },
})
