const { MethodNotFoundError, InvalidParamsError, InvalidRequestError, InternalError } = require("./exception")

class Dispatcher {
    constructor() { }

    dispatch(ctx, method, params) {
        switch (method) {
            case "invoke":
                return this.invoke(ctx, params)
            case "query":
                return this.query(ctx, params)
            default:
                throw new MethodNotFoundError(method)
        }

        throw new InternalError("impossible")
    }

    invoke(ctx, params) {
        const promise = new Promise((resolve, reject) => {
            setTimeout(() => {  // invoke callback 
                return resolve(new Date())
            }, 2000)
        })
        return promise
    }
    query(ctx, params) {
        return { "xx": 2 }
    }
}


module.exports = { Dispatcher }
