
const http = require('http')
const WebSocket = require('ws')
const assert = require("assert")
const express = require('express')
const log = require("winston")

const { Sdk } = require("./sdk.js")
const { Dispatcher } = require("./handlers")
const { Json2RPCError } = require("./exception")
const { ApiKeyMap, AppCfg, WinstonCfg, FabricCfg } = require("./config")

log.configure(WinstonCfg)

const app = express()
const server = http.createServer(app)

const bodyParser = require('body-parser')
var urlencodedParser = bodyParser.urlencoded({ extended: false })

const sdk = new Sdk()
const dispather = new Dispatcher(sdk)
const clients = new Map() // {[apikey]: {wsc: wsc, other = ...}}



const wsServer = new WebSocket.Server({
    server,
    path: "/v1/ws",
    verifyClient: (info, done) => {
        // 认证检查, apiKey
        const apiKey = info.req.headers["x-api-key"]
        if (!apiKey) {
            return done()
        }

        if (!ApiKeyMap.has(apiKey)) {
            return done()
        }

        if (clients.has(apiKey)) {
            // alreay exists 
            return done()
        }

        done(apiKey)
    },
})

// logical check
function checkApiKey(apiKey) {
    assert(apiKey)

    if (!clients.has(apiKey)) {
        console.error("why miss apiKey", apiKey)
        return false
    }

    const wsc = ctx.wsc
    assert(ctx.wsc)

    return true
}

function sendResult(ctx, resp) {
    if (!checkApiKey(ctx.apiKey)) {
        return
    }

    ctx.wsc.send(JSON.stringify(resp), err => {
        if (err) {  // 发送失败，关闭连接
            wsc.close()
            console.log("send fail", err)
        }
    })
}

async function onMessage(ctx, message, req) {

    if (!checkApiKey(ctx.apiKey)) {
        return
    }

    const wsc = ctx.wsc

    if (typeof message != "string") {   //　非法消息，关闭连接　
        return wsc.close()
    }

    let id, method, params

    // 解析参数
    try {
        const j = JSON.parse(message)

        id = j.id
        method = j.method
        params = j.params

        if (!(method && params)) {      //　非法消息，关闭连接　
            wsc.close()
            return
        }
    } catch (err) {     //　非法消息，关闭连接　
        console.error(err.message)
        return wsc.close()
    }

    try {
        // 处理消息
        const res = await dispather.dispatch(ctx, method, params)
        if (!id) {  //　没有发送id, 不回复
            return
        }

        // 回复结果　
        return sendResult(ctx, { "jsonrpc": "2.0", "id": id, "result": res })
    } catch (err) {
        if (err instanceof Json2RPCError) {
            // 回复可处理的异常
            return sendResult(ctx, { "jsonrpc": "2.0", "id": id, "error": err.error })
        }

        if (err instanceof SDKError) {
            return sendResult(ctx, { "jsonrpc": "2.0", "id": id, "error": err.error, "rid": err.rid })
        }

        //　其他异常，关闭连接　
        console.log("====", err)
        return wsc.close()
    }
}

// 新客户端连接上来，已经通过ApiKey认证
wsServer.on('connection', (wsc, req) => {
    const apiKey = req.headers["x-api-key"]
    if (!apiKey || clients.has(apiKey)) {   // verifyClient已经检查过，这里不应该进来　
        console.log("logical error!!!")
        return
    }

    // 缓存连接context
    ctx = { "apiKey": apiKey, "wsc": wsc, "active": new Date() }
    clients.set(apiKey, ctx)

    // 收到新消息
    wsc.on('message', message => { onMessage(ctx, message, req) })

    //　连接关闭，包括主动和被动关闭。删除缓存中的连接信息
    wsc.on('close', (code, reason) => {
        clients.delete(apiKey)
        console.log("close", apiKey, code, reason)
    })

    // 错误消息
    wsc.on('error', err => {
        console.log("error", apiKey, err)
    })
})

/*
curl localhost:8080/v1/test -H "X-Api-Key: apikey" -H 'content-type:application/json' -d '{       
  "id": 1,
  "jsonrpc": "2.0",
  "params": {
    "content": "caf975b8a8edfe8d24dc2f78c76711fcebcf00a5f198040c00a9cd892b40fd9"
  },
  "method": "invoke"
}'
*/
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
        await sdk.initChannel(FabricCfg.DefaultChannel, FabricCfg.UseOrg);
    } catch (err) {
        log.error(err);
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