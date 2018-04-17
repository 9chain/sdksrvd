const log = require("winston")

//const { Sdk } = require("./sdk.js")
const { ApiKeyMap, AppCfg, WinstonCfg, FabricCfg } = require("./config")
const { MethodNotFoundError, InvalidParamsError, InvalidRequestError, InternalError, SDKError } = require("./exception")


class Dispatcher {
    constructor(sdk) {
        this.sdk = sdk
    }

    dispatch2(ctx, method, params) {
        switch (method) {
            case "transfer":
                return this.invoke_common(ctx, method, params)
            case "history":
                return this.query2(ctx, method, params)
            case "state":
                return this.query2(ctx, method, params)
            case "init_asset":
                return this.invoke_common(ctx, method, params)    
            default:
                throw new MethodNotFoundError(method)
        }
    }

    async invoke_common(ctx, method, params){
        const txId = this.sdk.newTransactionID();
        log.debug('New TransactionID = %s', txId.getTransactionID())
        const request = {
            chaincodeId : params["contract"],
            fcn: method,
            args: params["args"],
            txId: txId,
        };

        const result = await this.sdk.invokeChaincode2(params.rid, params.channel, request)
        return result
    }

    async invoke2(ctx, chaincodeId,  params) {
        const txId = this.sdk.newTransactionID();
        log.debug('New TransactionID = %s', txId.getTransactionID())
        console.log(params)
        const request = {
            chaincodeId,
            fcn: "transfer",
            args: params["args"],
            txId: txId,
        };

        const result = await this.sdk.invokeChaincode(params.rid, params.channel, request)
        return result
    }

    async query2(ctx, method, params) {
        console.log("key", params)

        const request = {
            chaincodeId : params["contract"],
            fcn: method,
            args: params["args"],
        }

            const r = await this.sdk.queryChaincode2(params.channel, request)
            var result = JSON.parse(r)
            return result  

    }

    dispatch(ctx, method, params) {
        if (params["contract"]) {
            return this.dispatch2(ctx, method, params)
        }

        switch (method) {
            case "create":
                return this.invoke(ctx, params)
            case "transactions":
                return this.query(ctx, params)
            case "state":
                return this.state(ctx, params)
            case "queryTransaction":
                return this.queryTransaction(ctx,params)
            default:
                throw new MethodNotFoundError(method)
        }

        throw new InternalError("impossible")
    }

    async invoke(ctx, params) {

        var records = [];
        for (var j = 0; j < params.records.length; j++) {
            records.push(params.records[j].key);
            records.push(params.records[j].value);
        }

        var txId = this.sdk.newTransactionID();
        console.log(txId);
        log.debug('New TransactionID = %s', txId.getTransactionID());

        var request = {
            chaincodeId: FabricCfg.ChaincodeId,
            fcn: FabricCfg.PutFcn,
            args: records,
            txId: txId,
        };

        var result = await this.sdk.invokeChaincode(params.rid, params.channel, request);
        return result
    }

    async query(ctx, params) {
        console.log("key", params.key)

        var request = {
            chaincodeId: FabricCfg.ChaincodeId,
            fcn: 'queryHistory',
            args: [params.key]
        };
        const r = await this.sdk.queryChaincode(params.channel, request)
        var result = JSON.parse(r)
        
        if (result && result instanceof Array) {
            for (let i = 0; i < result.length; ++i) {
                delete result.value
            }
        }

        return result
    }

    async state(ctx, params) {
        console.log("key", params.key)
        var request = {
            chaincodeId: FabricCfg.ChaincodeId,
            fcn: 'queryState',
            args: [params.key]
        };
        const r = await this.sdk.queryChaincode(params.channel, request)
        return JSON.parse(r)
    }

    async queryTransaction(ctx, params) {
        console.log("params: ", params)
        return await this.sdk.queryTransaction(params.channel, params.tx_id, params.key, params.sub_channel)
    }
}


module.exports = { Dispatcher }
