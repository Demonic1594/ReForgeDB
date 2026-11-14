import { BaseEventHandler, ForgeClient } from "@tryforge/forgescript";
import { SQLiteRecord } from "../util/types";
/** Name of ReForgeDB's event handler in ForgeScript's EventManager. */
export declare const EVENT_HANDLER_NAME = "ReForgeDBEvents";
export interface IReForgeDBEvents {
    connect: [];
    variableCreate: [
        {
            data: SQLiteRecord | null;
            event?: "variableCreate";
        }
    ];
    variableDelete: [
        {
            data: SQLiteRecord | null;
            event?: "variableDelete";
        }
    ];
    variableUpdate: [
        {
            newData: SQLiteRecord | null;
            oldData: SQLiteRecord | null;
            event?: "variableUpdate";
        }
    ];
}
export declare class ReForgeDBEventHandler<T extends keyof IReForgeDBEvents> extends BaseEventHandler<IReForgeDBEvents, T> {
    register(client: ForgeClient): void;
}
//# sourceMappingURL=eventManager.d.ts.map