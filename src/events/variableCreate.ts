import { Interpreter } from "@tryforge/forgescript"
import { ReForgeDB } from ".."
import { ReForgeDBEventHandler } from "../structures/eventManager"
import { ReForgeDBLogger } from "../util/logger"

export default new ReForgeDBEventHandler({
    name: "variableCreate",
    version: "2.0.0",
    description: "This event is triggered when a new variable gets created.",
    listener(extras) {
        const commands = this.getExtension(ReForgeDB, true).commands.get("variableCreate")

        for (const command of commands) {
            Interpreter.run({
                obj: {},
                client: this,
                command,
                data: command.compiled.code,
                extras,
            }).catch((err) => ReForgeDBLogger.error(`The variableCreate command "${command.name ?? "unnamed"}" failed:`, err))
        }
    },
})
