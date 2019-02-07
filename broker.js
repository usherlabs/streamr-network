const http = require('http')
const cors = require('cors')
const express = require('express')
const ws = require('ws')
let optimist = require('optimist')

const { startNetworkNode } = require('@streamr/streamr-p2p-network')

const { startCassandraStorage } = require('./src/Storage')
const StreamFetcher = require('./src/StreamFetcher')
const WebsocketServer = require('./src/WebsocketServer')
const Partitioner = require('./src/Partitioner')
const Publisher = require('./src/Publisher')
const VolumeLogger = require('./src/utils/VolumeLogger')

const createDataQueryEndpoints = require('./src/rest/DataQueryEndpoints')
const createDataProduceEndpoints = require('./src/rest/DataProduceEndpoints')
const createVolumeEndpoint = require('./src/rest/VolumeEndpoint')

module.exports = async (config) => {
    const storage = await startCassandraStorage([config.cassandraHost], 'datacenter1', config.cassandraKeyspace)
    const networkNode = await startNetworkNode(config.networkHostname, config.networkPort)
    await networkNode.addBootstrapTracker('ws://127.0.0.1:30300')

    networkNode.addMessageListener((streamId, streamPartition, timestamp, sequenceNo, publisherId, prevTimestamp, prevSequenceNo, payload) => {
        storage.store(streamId, streamPartition, timestamp, sequenceNo, publisherId, payload)
    })

    const historicalAdapter = null
    const latestOffsetFetcher = null

    // Create some utils
    const volumeLogger = new VolumeLogger()
    const streamFetcher = new StreamFetcher(config.streamr)
    const publisher = new Publisher(networkNode, Partitioner, volumeLogger)

    // Create HTTP server
    const app = express()
    const httpServer = http.Server(app)

    // Add CORS headers
    app.use(cors())

    // Websocket endpoint is handled by WebsocketServer
    const server = new WebsocketServer(
        new ws.Server({
            server: httpServer,
            path: '/api/v1/ws',
            /**
             * Gracefully reject clients sending invalid headers. Without this change, the connection gets abruptly closed,
             * which makes load balancers such as nginx think the node is not healthy.
             * This blocks ill-behaving clients sending invalid headers, as well as very old websocket implementations
             * using draft 00 protocol version (https://tools.ietf.org/html/draft-ietf-hybi-thewebsocketprotocol-00)
             */
            verifyClient: (info, cb) => {
                if (info.req.headers['sec-websocket-key']) {
                    cb(true)
                } else {
                    cb(
                        false,
                        400, // bad request
                        'Invalid headers on websocket request. Please upgrade your browser or websocket library!',
                    )
                }
            },
        }),
        networkNode,
        historicalAdapter,
        latestOffsetFetcher,
        streamFetcher,
        publisher,
        volumeLogger,
    )

    // Rest endpoints
    app.use('/api/v1', createDataQueryEndpoints(historicalAdapter, streamFetcher, volumeLogger))
    app.use('/api/v1', createDataProduceEndpoints(streamFetcher, publisher, volumeLogger))
    app.use('/api/v1', createVolumeEndpoint(volumeLogger))

    // Start the server
    httpServer.listen(config.port, () => {
        console.info(`Configured with Streamr: ${config.streamr}`)
        console.info(`Network node running on ${config.networkHostname}:${config.networkPort}`)
        console.info(`Listening on port ${config.port}`)
        httpServer.emit('listening')
    })

    return {
        httpServer,
        close: () => {
            httpServer.close()
            networkNode.close()
            volumeLogger.stop()
        },
    }
}

// Start the server if we're not being required from another module
if (require.main === module) {
    // Check command line args
    optimist = optimist.usage(`You must pass the following command line options:
        --networkHostname <networkHostname>
        --networkPort <networkPort>
        --cassandraHost <cassandraHost>
        --cassandraKeyspace <cassandraKeyspace>
        --streamr <streamr>
        --port <port>`)
    optimist = optimist.demand(['networkHostname', 'networkPort', 'cassandraHost', 'cassandraKeyspace', 'streamr', 'port'])

    module.exports(optimist.argv)
        .then(() => {})
        .catch((e) => {
            console.error(e)
            process.exit(1)
        })
}
