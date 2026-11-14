"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DBCommandManager = void 0;
const forgescript_1 = require("@tryforge/forgescript");
const eventManager_1 = require("./eventManager");
class DBCommandManager extends forgescript_1.BaseCommandManager {
    handlerName = eventManager_1.EVENT_HANDLER_NAME;
}
exports.DBCommandManager = DBCommandManager;
//# sourceMappingURL=commandManager.js.map