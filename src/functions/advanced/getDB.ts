import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$getDB",
    version: "1.0.0",
    aliases: ["$getDataBase", "$getRecords"],
    description: "Returns every stored variable as JSON",
    output: ArgType.Json,
    unwrap: false,
    async execute() {
        return guarded(this, async () => this.successJSON(await DataBase.getAll()))
    },
})
