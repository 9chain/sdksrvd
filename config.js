const winston = require("winston")
const moment = require("moment")

const [Console, File] = [winston.transports.Console, winston.transports.File]

// https://www.npmjs.com/package/winston
// { error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5 }

function timestamp() {
    return moment().format("YYYYMMDD HH:mm:ss")
}

const logdir = "logs"
const WinstonCfg = {
    transports: [
        new Console({
            level: "silly",
            timestamp: timestamp
        }),
        
        new File({
            json: false,
            filename: `${logdir}/debug.log`,
            name: "debug-file",
            maxFiles: 8,
            maxsize: 1024 * 1024,
            // zippedArchive: true,
            level: "debug",
            tailable: true,
            timestamp: timestamp
        }),

        new File({
            json: false,
            filename: `${logdir}/warn.log`,
            name: "warn-file",
            maxFiles: 8,
            maxsize: 1024 * 1024,
            // zippedArchive: true,
            level: "warn",
            tailable: true,
            timestamp: timestamp
        })
    ],
    exceptionHandlers: [
        new File({
            filename: `${logdir}/exceptions.log`,
        })
    ]
}

//////////////////////////////////////////////////////////////////


let apiKeyMap = new Map()
apiKeyMap.set("1234567890", {})

const ApiKeyMap = apiKeyMap
const AppCfg = {
    Port: 8080,
    ListenAddr: "localhost:8081"
}

module.exports = { ApiKeyMap, AppCfg, WinstonCfg }
