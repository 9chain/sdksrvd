const http = require('http')
const assert = require("assert")
const express = require('express')
const log = require("winston")
const EventEmitter = require('events')

const { Sdk } = require("./sdk.js")
const { Dispatcher } = require("./handlers")
const { Json2RPCError, SDKError } = require("./exception")
const { ApiKeyMap, AppCfg, WinstonCfg, FabricCfg } = require("./config")

log.configure(WinstonCfg)

const app = express()
const server = http.createServer(app)

const bodyParser = require('body-parser')
const urlencodedParser = bodyParser.urlencoded({ extended: false })

const sdk = new Sdk()
const dispather = new Dispatcher(sdk)

const userMap = new Map()
const doneEmitter = new EventEmitter()

class ReqSt {
    constructor(id, ext) {
        this.id = id
        this.ext = ext
        this.start = uptime()
        this.done = undefined
        this.result = undefined
        this.error = undefined
    }
}

function uptime() {
    return process.hrtime()[0]
}

async function doPush(userKey, params) {
    const {id, channel, contract, method, args, ext} = params
    if (!userMap.has(userKey)) {
        userMap.set(userKey, [])
    }

    let obj = new ReqSt(id, ext)
    try {
        obj.result = await dispather.dispatch({}, method, params)
    } catch(e) {
        if (e instanceof Json2RPCError) {
            obj.error = e.error
        } else {
            obj.error = e.message
        }
    }
    obj.done = uptime()

    let arr = userMap.get(userKey) 
    arr.push(obj)
    userMap.set(userKey, arr)

    doneEmitter.emit(userKey)
}

function doPull(userKey, params) {
    let {max, timeout} = params
    timeout = timeout * 1000
    isEmpty = function() {
        let arr = userMap.get(userKey)
        return !(arr && arr.length > 0)
    }

    return new Promise(resolve => {
        let take, timer
        take = function() {
            if (isEmpty()) {
                return
            }

            const result = []
            let arr = userMap.get(userKey)
            const len = max > arr.length ? arr.length : max
            for (let i = 0 ; i < len; i++) {
                const obj = arr.shift()
                result.push(obj)
            }
        
            userMap.set(userKey, arr)

            if (timer) {
                clearTimeout(timer)
            }
            doneEmitter.removeListener(userKey, take)
            return resolve(result)
        }

        doneEmitter.on(userKey, take)

        if (!isEmpty()) {
            doneEmitter.emit(userKey)
        } else {
            timer = setTimeout(() => {
                doneEmitter.removeListener(userKey, take)
                return resolve([])
            }, timeout)
        }
    })
}

app.post('/sdk/v2', urlencodedParser, bodyParser.json(), async (request, response) => {
    const userKey = request.headers["x-api-key"]
    if (!userKey) {   // verifyClient已经检查过，这里不应该进来　
        return response.send("invalid apiKey").status(400)
    }

    const { id: jsid, method, params } = request.body
    if (!(jsid != undefined && method && params)) {
        return response.send("invalid json2rpc").status(400)
    }
    try {
        switch(method) {
            case "push":
                const {id, channel, contract, method, args, ext} = params
                if (!(id && channel && contract && method && args)) {
                    return response.send("invalid params").status(400)
                }

                doPush(userKey, params)
                return response.send({ "jsonrpc": "2.0", "id": jsid, "result": {"message": "cache ok"} }) 
            case "pull":
                let {max: originMax, timeout} = params
                let max = originMax

                if (!(originMax && (originMax >=1 && originMax <= 100))) {
                    max = 1
                }

                if (!(timeout && "number" == typeof originMax && (originMax >=1 && originMax <= 100 ))) {
                    timeout = 5
                }

                const arr = await doPull(userKey, {max, timeout})
                let resarr = []

                for (let obj of arr) {
                    console.log("resp", userKey, obj.id)
                    resarr.push({"id": obj.id, "result": obj.result, "error": obj.error})
                }
                return response.send({ "jsonrpc": "2.0", "id": jsid, "result": resarr })
            default:
                console.log("invalid method")
                return response.send("invalid param").status(400)
        }
    } catch(e) {
        console.log("invalid method", e.message)
        return response.send(e.message).status(400)
    }    
})

// 本地测试
app.post('/v1/test', urlencodedParser, bodyParser.json(), async (request, response) => {
    if (request.ip.indexOf("127.0.0.1") < 0) {   // 本地测试使用，禁止外部连接
        // return response.send("only allow local request. " + request.ip).status(400)
    }

    // 参数字段检查　
    const { id, method, params } = request.body
    if (!(method && params)) {
        return response.send("invalid param").status(400)
    }

    // 一次性连接，不用context
    try {
        const ctx = {}
        const res = await dispather.dispatch(ctx, method, params)
        const resp = { "jsonrpc": "2.0", "id": id, "result": res }
        return response.send(resp)
    } catch (err) {
        if (err instanceof Json2RPCError) {
            const resp = { "jsonrpc": "2.0", "id": id, "error": err.error }
            return response.send(resp)
        }

        return response.send(err.message).status(400)
    }
})

async function main() {
    try {
        await sdk.initChannel(FabricCfg.DefaultChannel, FabricCfg.UseOrg)
    } catch (err) {
        log.error(err)
        process.exit(1)
    }

    process.on('SIGINT', function () {
        console.log('Got SIGINT. start exit.');
        sdk.close();
        process.exit(0);
    });

    log.info("Start listening on %s", AppCfg.Port)

    server.listen(AppCfg.Port, "0.0.0.0", () => {
        log.info("listening on %s", AppCfg.Port)
        //console.log('Listening on ' + AppCfg.ListenAddr)
    })
}

main()