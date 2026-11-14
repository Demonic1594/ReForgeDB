"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DBEventHandler = exports.EVENT_HANDLER_NAME = void 0;
const forgescript_1 = require("@tryforge/forgescript");
const __1 = require("..");
/** Name of ReForgeDB's event handler in ForgeScript's EventManager. */
exports.EVENT_HANDLER_NAME = "ReForgeDBEvents";
class DBEventHandler extends forgescript_1.BaseEventHandler {
    register(client) {
        //@ts-ignore emitter is typed per event name
        client.getExtension(__1.ReForgeDB, true)["emitter"].on(this.name, this.listener.bind(client));
    }
}
exports.DBEventHandler = DBEventHandler;
//# sourceMappingURL=eventManager.js.map