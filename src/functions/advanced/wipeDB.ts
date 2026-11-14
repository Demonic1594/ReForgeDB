import { NativeFunction } from "@tryforge/forgescript"
import { DataBase } from "../../util"
import { guarded } from "../../util/functions"

export default new NativeFunction({
    name: "$wipeDB",
    version: "2.0.8",
    aliases: ["$deleteDB", "$clearDB"],
    description: "Deletes every variable and every cooldown in the database",
    unwrap: false,
    async execute() {
        return guarded(this, async () => {
            await DataBase.wipe()
            await DataBase.cdWipe()
            return this.success()
        })
    },
})
