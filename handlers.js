const log = require("winston")

const { ApiKeyMap, AppCfg, WinstonCfg, FabricCfg } = require("./config")
const { MethodNotFoundError, InvalidParamsError, InvalidRequestError, InternalError, SDKError } = require("./exception")

const INVOKE_PREFIX = "invoke-"
const QUERY_PREFIX = "query-"

function isInvoke(method) {
    if (method.length <= INVOKE_PREFIX.length) {
        return false 
    }
    
    return method.indexOf(INVOKE_PREFIX) == 0
}

function isQuery(method) {
    if (method.length <= QUERY_PREFIX.length) {
        return false 
    }
    
    return method.indexOf(QUERY_PREFIX) == 0
}

class Dispatcher {
    constructor(sdk) {
        this.sdk = sdk
    }

    dispatch(ctx, method, params) {
        switch (method) {
            case "query-transaction":
                const {contract, channel, subch, args} = params
                console.log(params)
                return this.query_transaction(ctx, channel, contract, method, ["1", subch, ...args])

            default:
                if (isQuery(method)) {
                    const {contract, channel, subch, args} = params
                    return this.query_common(ctx, channel, contract, method, ["1", subch, ...args])
                }

                if (isInvoke(method)) {
                    const {contract, channel, subch, args, rid} = params
                    console.log(["1", subch, ...args])
                    return this.invoke_common(ctx, channel, contract, method, ["1", subch, ...args], rid)
                }

                throw new MethodNotFoundError(method)
        }
    }

    async invoke_common(ctx, channel, chaincodeId, fcn, args, rid) {
        const txId = this.sdk.newTransactionID()
        const request = {chaincodeId, fcn, args, txId}
        return await this.sdk.invokeChaincode(rid, channel, request)
    }
    
    async query_common(ctx, channel, chaincodeId, fcn, args) {
        const request = {chaincodeId, fcn, args, targets: [this.sdk.getOnePeer()]}
        const r = await this.sdk.queryChaincode(channel, request)
        return JSON.parse(r)
    }

    async query_transaction(ctx, channel, chaincodeId, fcn, args) {
        const request = {chaincodeId, fcn, args}
        return await this.sdk.queryTransaction(channel, request)
    }
}

module.exports = { Dispatcher }
