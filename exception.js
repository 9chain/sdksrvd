class Json2RPCError extends Error {
    constructor(code, message, data) {
        super()
        this.error = {
            "code": code, 
            "message": message, 
            "data": data 
        }
      }
}

class InvalidRequestError extends Json2RPCError {
    constructor(data) {
        super(-32600, "Invalid Request", data)
    }
}

class MethodNotFoundError extends Json2RPCError {
    constructor(data) {
        super(-32601, "Method not found", data)
    }
}


class InvalidParamsError extends Json2RPCError {
    constructor(data) {
        super(-32602, "Invalid params", data)
    }
}

class InternalError extends Json2RPCError {
    constructor(data) {
        super(-32603, "Internal error", data)
    }
}

class SDKError extends Json2RPCError {
    constructor(rid, data) {
        super(-32604, "Fabric sdk error", data)
        this.rid = rid
    }
}

module.exports = {Json2RPCError, InvalidRequestError, MethodNotFoundError, InvalidParamsError, InternalError}