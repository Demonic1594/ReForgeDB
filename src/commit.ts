import { execFileSync } from "child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { stdin, stdout } from "process"
import { createInterface } from "readline"

export async function prompt(q: string) {
    const itf = createInterface(stdin, stdout)
    return new Promise<string>((r) => {
        itf.question(q, (input) => {
            itf.close()
            r(input)
        })
    })
}

const path = "./metadata"
if (!existsSync(path)) mkdirSync(path)

const version = require("../package.json").version

async function main() {
    let skip = false

    const msg = (await prompt("Please write the commit message: "))
        .replace(/(--?(\w+))/gim, (match) => {
            const name = /(\w+)/.exec(match)![1].toLowerCase()

            switch (name) {
                case "hide": {
                    skip = true
                    break
                }

                default: {
                    throw new Error(`--${name} is not a valid flag.`)
                }
            }

            return ""
        })
        .trim()

    const fileName = join(path, "changelogs.json")
    const json: Record<string, object[]> = existsSync(fileName) ? JSON.parse(readFileSync(fileName, "utf-8")) : {}
    json[version] ??= []

    if (!skip) {
        json[version].unshift({
            message: msg,
            timestamp: new Date(),
            author: execFileSync("git", ["config", "user.name"]).toString().trim(),
        })
        writeFileSync(fileName, JSON.stringify(json), "utf-8")
    }

    const branch = (await prompt("Write the branch name to push to (defaults to dev): ")) || "dev"

    // Arguments go to git as they are, never through a shell: a commit
    // message or branch name with quotes, backticks or `$(...)` cannot run
    // commands (ForgeDB built one shell command line out of them).
    const git = (...args: string[]) => execFileSync("git", args, { stdio: "inherit" })
    git("branch", "-M", branch)
    git("add", ".")
    git("commit", "-m", msg)
    git("push", "-u", "origin", branch)
}

if (require.main === module) main()
