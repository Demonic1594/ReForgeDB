import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataType } from "../../util"
import { eventRecord } from "../../util/functions"

export default new NativeFunction({
    name: "$oldData",
    version: "2.0.0",
    description: "Retrieves the old data of the variable in a variableUpdate event (the deleted data in variableDelete). Returns nothing outside these events",
    unwrap: true,
    args: [
        {
            name: "type",
            description: "The property to retrieve",
            rest: false,
            type: ArgType.Enum,
            enum: DataType,
            required: true,
        },
    ],
    brackets: true,
    execute(ctx, [type]) {
        const record = eventRecord(ctx, "oldData")
        const value = record?.[DataType[type] as keyof typeof record]
        return this.success(value === undefined ? null : value)
    },
})
