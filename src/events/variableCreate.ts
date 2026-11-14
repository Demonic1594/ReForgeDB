import { Interpreter } from "@tryforge/forgescript"
import { ReForgeDB } from ".."
import { DBEventHandler } from "../structures/eventManager"
import { DBLogger } from "../util/logger"

export default new DBEventHandler({
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
            }).catch((err) => DBLogger.error(`The variableCreate command "${command.name ?? "unnamed"}" failed:`, err))
        }
    },
})
