import { Interpreter } from "@tryforge/forgescript"
import { ReForgeDB } from ".."
import { ReForgeDBEventHandler } from "../structures/eventManager"
import { ReForgeDBLogger } from "../util/logger"

export default new ReForgeDBEventHandler({
    name: "cooldownExpire",
    version: "3.2.0",
    description: "This event is triggered when a stored cooldown runs out ($cooldownData has its name, ID and times). Fires once, also with several bot processes on one database.",
    listener(extras) {
        const commands = this.getExtension(ReForgeDB, true).commands.get("cooldownExpire")

        for (const command of commands) {
            Interpreter.run({
                obj: {},
                client: this,
                command,
                data: command.compiled.code,
                extras,
            }).catch((err) => ReForgeDBLogger.error(`The cooldownExpire command "${command.name ?? "unnamed"}" failed:`, err))
        }
    },
})
