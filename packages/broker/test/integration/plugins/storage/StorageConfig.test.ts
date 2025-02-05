import { Client } from 'cassandra-driver'
import StreamrClient, { Stream } from 'streamr-client'
import { Tracker } from '@streamr/network-tracker'
import cassandra from 'cassandra-driver'
import { Wallet } from 'ethers'
import { fastWallet, fetchPrivateKeyWithGas } from '@streamr/test-utils'
import {
    startBroker,
    createClient,
    STREAMR_DOCKER_DEV_HOST,
    createTestStream,
    startTestTracker,
    startStorageNode
} from '../../../utils'
import { Broker } from '../../../../src/broker'
import { StreamMessage } from '@streamr/protocol'
import { waitForCondition } from '@streamr/utils'

jest.setTimeout(30000)

const contactPoints = [STREAMR_DOCKER_DEV_HOST]
const localDataCenter = 'datacenter1'
const keyspace = 'streamr_dev_v2'

const HTTP_PORT = 17770
const TRACKER_PORT = 17772

describe('StorageConfig', () => {
    let cassandraClient: Client
    let tracker: Tracker
    let storageNode: Broker
    let broker: Broker
    let client: StreamrClient
    let stream: Stream
    let publisherAccount: Wallet
    let storageNodeAccount: Wallet
    let brokerAccount: Wallet

    beforeAll(async () => {
        publisherAccount = new Wallet(await fetchPrivateKeyWithGas())
        storageNodeAccount = new Wallet(await fetchPrivateKeyWithGas())
        brokerAccount = fastWallet()
        cassandraClient = new cassandra.Client({
            contactPoints,
            localDataCenter,
            keyspace,
        })
    })

    afterAll(async () => {
        await cassandraClient?.shutdown()
    })

    beforeEach(async () => {
        tracker = await startTestTracker(TRACKER_PORT)
        storageNode = await startStorageNode(storageNodeAccount.privateKey, HTTP_PORT, TRACKER_PORT)
        broker = await startBroker({
            privateKey: brokerAccount.privateKey,
            trackerPort: TRACKER_PORT,
            enableCassandra: false
        })
        client = await createClient(tracker, publisherAccount.privateKey)
    })

    afterEach(async () => {
        await client.destroy()
        await Promise.allSettled([
            storageNode?.stop(),
            broker?.stop(),
            tracker?.stop()
        ])
    })

    it('when client publishes a message, it is written to the store', async () => {
        stream = await createTestStream(client, module)
        await stream.addToStorageNode(storageNodeAccount.address)
        const publishMessage = await client.publish(stream.id, {
            foo: 'bar'
        })
        await waitForCondition(async () => {
            const result = await cassandraClient.execute('SELECT COUNT(*) FROM stream_data WHERE stream_id = ? ALLOW FILTERING', [stream.id])
            return (result.first().count > 0)
        })
        const result = await cassandraClient.execute('SELECT * FROM stream_data WHERE stream_id = ? ALLOW FILTERING', [stream.id])
        const storeMessage = StreamMessage.deserialize(JSON.parse(result.first().payload.toString()))
        expect(storeMessage.signature).toEqual(publishMessage.signature)
    })
})
