import { Interpreter } from "@tryforge/forgescript"
import { ReForgeDB } from ".."
import { ReForgeDBEventHandler } from "../structures/eventManager"
import { ReForgeDBLogger } from "../util/logger"

export default new ReForgeDBEventHandler({
    name: "variableDelete",
    version: "2.0.0",
    description: "This event is triggered when a variable gets deleted.",
    listener(extras) {
        const commands = this.getExtension(ReForgeDB, true).commands.get("variableDelete")

        for (const command of commands) {
            Interpreter.run({
                obj: {},
                client: this,
                command,
                data: command.compiled.code,
                extras,
            }).catch((err) => ReForgeDBLogger.error(`The variableDelete command "${command.name ?? "unnamed"}" failed:`, err))
        }
    },
})
