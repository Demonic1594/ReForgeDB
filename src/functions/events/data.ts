import { ArgType, NativeFunction } from "@tryforge/forgescript"
import { DataType } from "../../util"
import { eventRecord } from "../../util/functions"

export default new NativeFunction({
    name: "$data",
    version: "2.0.0",
    description: "Retrieves data of the variable created or deleted in a variableCreate or variableDelete event (the new data in variableUpdate). Returns nothing outside these events",
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
        const record = eventRecord(ctx, "data")
        const value = record?.[DataType[type] as keyof typeof record]
        return this.success(value === undefined ? null : value)
    },
})
