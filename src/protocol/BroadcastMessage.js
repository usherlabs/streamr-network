import MessageFromServer from './MessageFromServer'
import StreamMessage from './StreamMessage'

const TYPE = 0

class BroadcastMessage extends MessageFromServer {
    constructor(streamMessage) {
        super(TYPE, streamMessage)
    }
    static getMessageName() {
        return 'BroadcastMessage'
    }
    static getPayloadClass() {
        return StreamMessage
    }
    static getConstructorArguments(message, payload) {
        return [payload]
    }
}

MessageFromServer.registerMessageClass(BroadcastMessage, TYPE)
module.exports = BroadcastMessage
