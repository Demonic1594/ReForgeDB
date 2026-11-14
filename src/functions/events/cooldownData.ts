import { ArgType, NativeFunction } from "@tryforge/forgescript"

/** The properties of an expired cooldown $cooldownData can read. */
export enum CooldownDataType {
    identifier,
    name,
    id,
    startedAt,
    duration,
    expiredAt,
}

export default new NativeFunction({
    name: "$cooldownData",
    version: "3.2.0",
    description: "Retrieves data of the cooldown that ran out in a cooldownExpire event: its identifier, name, ID (empty for global cooldowns), start, duration and end in ms. Returns nothing outside this event",
    unwrap: true,
    args: [
        {
            name: "property",
            description: "The property to retrieve",
            rest: false,
            type: ArgType.Enum,
            enum: CooldownDataType,
            required: true,
        },
    ],
    brackets: true,
    execute(ctx, [property]) {
        const extras = ctx.runtime.extras as { cooldown?: Record<string, unknown>; event?: string } | null | undefined
        const cooldown = extras && typeof extras === "object" && extras.event === "cooldownExpire" ? extras.cooldown : undefined
        const value = cooldown?.[CooldownDataType[property]]
        return this.success(value === undefined ? null : value)
    },
})
