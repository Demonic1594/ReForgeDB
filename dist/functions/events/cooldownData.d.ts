import { ArgType, NativeFunction } from "@tryforge/forgescript";
/** The properties of an expired cooldown $cooldownData can read. */
export declare enum CooldownDataType {
    identifier = 0,
    name = 1,
    id = 2,
    startedAt = 3,
    duration = 4,
    expiredAt = 5
}
declare const _default: NativeFunction<[{
    name: string;
    description: string;
    rest: false;
    type: ArgType.Enum;
    enum: typeof CooldownDataType;
    required: true;
}], true>;
export default _default;
//# sourceMappingURL=cooldownData.d.ts.map