import { generateMetadata } from "@tryforge/forgescript"
import { EVENT_HANDLER_NAME } from "./structures"

generateMetadata(`${__dirname}/functions`, "functions", EVENT_HANDLER_NAME, undefined, undefined, `${__dirname}/events`)
