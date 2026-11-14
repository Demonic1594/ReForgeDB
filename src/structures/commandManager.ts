import { BaseCommandManager } from "@tryforge/forgescript"
import { EVENT_HANDLER_NAME, IDBEvents } from "./eventManager"

export class DBCommandManager extends BaseCommandManager<keyof IDBEvents> {
    handlerName = EVENT_HANDLER_NAME
}
