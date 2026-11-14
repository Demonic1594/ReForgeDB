import { Interpreter } from "@tryforge/forgescript"
import { ReForgeDB } from ".."
import { ReForgeDBEventHandler } from "../structures/eventManager"
import { ReForgeDBLogger } from "../util/logger"

export default new ReForgeDBEventHandler({
    name: "variableUpdate",
    version: "2.0.0",
    description: "This event is triggered when a variable gets updated.",
    listener(extras) {
        const commands = this.getExtension(ReForgeDB, true).commands.get("variableUpdate")

        for (const command of commands) {
            Interpreter.run({
                obj: {},
                client: this,
                command,
                data: command.compiled.code,
                extras,
            }).catch((err) => ReForgeDBLogger.error(`The variableUpdate command "${command.name ?? "unnamed"}" failed:`, err))
        }
    },
})
