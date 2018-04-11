
const log = require("winston")

//const { Sdk } = require("./sdk.js")
const { ApiKeyMap, AppCfg, WinstonCfg, FabricCfg } = require("./config")
const { MethodNotFoundError, InvalidParamsError, InvalidRequestError, InternalError, SDKError } = require("./exception")


class Dispatcher {
    constructor(sdk) {
        this.sdk = sdk
    }

    dispatch(ctx, method, params) {
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

        for (let i = 0; i < result.length; ++i) {
            delete result.value
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
