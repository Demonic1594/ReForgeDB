"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReForgeDBCommandManager = void 0;
const forgescript_1 = require("@tryforge/forgescript");
const eventManager_1 = require("./eventManager");
class ReForgeDBCommandManager extends forgescript_1.BaseCommandManager {
    handlerName = eventManager_1.EVENT_HANDLER_NAME;
}
exports.ReForgeDBCommandManager = ReForgeDBCommandManager;
//# sourceMappingURL=commandManager.js.map