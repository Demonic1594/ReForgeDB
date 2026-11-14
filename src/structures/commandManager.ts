import { BaseCommandManager } from "@tryforge/forgescript"
import { EVENT_HANDLER_NAME, IReForgeDBEvents } from "./eventManager"

export class ReForgeDBCommandManager extends BaseCommandManager<keyof IReForgeDBEvents> {
    handlerName = EVENT_HANDLER_NAME
}
