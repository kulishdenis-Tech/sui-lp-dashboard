import { ChannelCredentials } from '@grpc/grpc-js'
import { GrpcTransport } from '@protobuf-ts/grpc-transport'
import { SuiGrpcClient } from '@mysten/sui/grpc'

const transport = new GrpcTransport({
	host: 'fullnode.mainnet.sui.io:443',
	channelCredentials: ChannelCredentials.createSsl(),
})
const c = new SuiGrpcClient({ network: 'mainnet', transport })
const { response } = await c.ledgerService.getCheckpoint({
	checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber: '337052676' },
	readMask: { paths: ['sequence_number', 'digest', 'summary.timestamp'] },
})
console.log(JSON.stringify(response, null, 2).slice(0, 800))
