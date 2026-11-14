import { Interpreter } from "@tryforge/forgescript"
import { ReForgeDB } from ".."
import { DBEventHandler } from "../structures/eventManager"
import { DBLogger } from "../util/logger"

export default new DBEventHandler({
    name: "connect",
    version: "2.0.0",
    description: "This event is triggered when ReForgeDB has connected to the database",
    listener() {
        const commands = this.getExtension(ReForgeDB, true).commands.get("connect")

        for (const command of commands) {
            Interpreter.run({
                obj: {},
                client: this,
                command,
                data: command.compiled.code,
            }).catch((err) => DBLogger.error(`The connect command "${command.name ?? "unnamed"}" failed:`, err))
        }
    },
})
