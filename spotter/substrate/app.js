'use strict';

import { WebSocketServer } from 'ws';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { encodeAddress } from '@polkadot/util-crypto';
import { MongoClient, ObjectId } from 'mongodb';
import SubscriptionManager from './SubscriptionManager.js'

const uri = {
  scheme: 'mongodb+srv',
  host: 'chaincluster.oulrzox.mongodb.net',
  database: 'cs-kusama-calamari',
  collection: {
    block: 'block',
  },
  auth: {
    mechanism: 'MONGODB-X509',
    source: '$external',
  },
  tls: 'true',
  cert: '/etc/pki/tls/certs/mongo.pem',
};
const webSocketServer = new WebSocketServer({ port: 8080 });
const subscriptionManager = new SubscriptionManager();
const provider = new WsProvider('wss://ws.archive.calamari.systems');
const mongo = new MongoClient(`${uri.scheme}://${uri.host}/${uri.database}?authMechanism=${uri.auth.mechanism}&authSource=${encodeURIComponent(uri.auth.source)}&tls=${uri.tls}&tlsCertificateKeyFile=${encodeURIComponent(uri.cert)}`);
const chunk = {
  size: 1000
};
const range = (start, end) => Array.from({length: (end - start)}, (v, k) => k + start);

const getSealerByProtocol = async (api, header, protocol = 'babe') => {
  let sealer;
  try {
    const apiAt = await api.at(header.hash);
    await apiAt.isReady;
    return encodeAddress(JSON.parse(JSON.stringify(await apiAt.query.session.nextKeys(header.author)))[protocol], apiAt.registry.chainSS58);
  } catch (_) {
    return null;
  }
}

const getSealer = async (api, header) => {
  const { logs: [log] } = header.digest;
  const sealer = (log && (
    (log.isConsensus && log.asConsensus[0].isNimbus && log.asConsensus[1]) ||
    (log.isPreRuntime && log.asPreRuntime[0].isNimbus && log.asPreRuntime[1])
  ));
  return sealer || (await getSealerByProtocol(api, header, 'aura'));
};

const getBlock = async (api, number) => {
  const hash = await api.rpc.chain.getBlockHash(number);
  const timestamp = JSON.parse(JSON.stringify(await api.query.timestamp.now.at(hash)));
  const header = await api.derive.chain.getHeader(hash);
  const _id = ObjectId.createFromHexString(
    [
      // timestamp: 4 byte (8 hex char) - slice(0, 8)
      new Number(Math.floor(timestamp / 1000)).toString(16).padStart(8, '0').slice(-8),

      // machine: 3 byte (6 hex char) - slice(8, 14)
      new Number(0).toString(16).padStart(6, '0').slice(-6),

      // process: 2 byte (4 hex char) - slice(14, 18)
      new Number(0).toString(16).padStart(4, '0').slice(-4),

      // counter: 3 byte (6 hex char) - slice(18, 24)
      new Number(number).toString(16).padStart(6, '0').slice(-6),
    ].join('')
  );
  const seal = (number > 0) ? await getSealer(api, header) : undefined;
  return {
    _id,
    number,
    hash: hash.toHex(),
    ...(!!timestamp) && {
      timestamp,
    },
    ...(number > 0) && {
      author: {
        control: JSON.parse(JSON.stringify(header.author)),
        ...(!!seal) && {
          seal
        },
      },
    },
  };
};

webSocketServer.on('connection', (client, request) => subscriptionManager.subscribe(request.headers['sec-websocket-key'], client));

(async () => {
  const api = await ApiPromise.create({ provider });
  await api.isReady;
  const [ round, lastHeader, blockZero ] = await Promise.all([ api.query.parachainStaking.round(), api.rpc.chain.getHeader(), getBlock(api, 0) ]);
  const latestBlockNumberOnChain = parseInt(lastHeader.number, 10);
  await mongo.db(uri.database).collection(uri.collection.block).updateOne({ _id: blockZero._id }, { $set: blockZero, }, { upsert: true });
  let latestBlockNumberInMongo = (await mongo.db(uri.database).collection(uri.collection.block).find().sort({ number: -1 }).limit(1).toArray())[0].number;
  subscriptionManager.send(JSON.stringify({
    latestBlockNumberOnChain,
    latestBlockNumberInMongo,
  }));
  while (latestBlockNumberInMongo < latestBlockNumberOnChain) {
    const blocks = await Promise.all(range((latestBlockNumberInMongo + 1), Math.min((latestBlockNumberInMongo + 1 + chunk.size), latestBlockNumberOnChain)).map((n) => getBlock(api, n)));
    const update = await mongo.db(uri.database).collection(uri.collection.block).insertMany(blocks, { ordered: true });
    if (!!update.insertedCount) {
      latestBlockNumberInMongo += update.insertedCount;
      const insertedIds = Object.values(update.insertedIds);
      const inserted = {
        first: {
          number: parseInt(insertedIds[0].toHexString().slice(18, 24), 16),
          timestamp: insertedIds[0].getTimestamp().toISOString(),
        },
        last: {
          number: parseInt(insertedIds.slice(-1)[0].toHexString().slice(18, 24), 16),
          timestamp: insertedIds.slice(-1)[0].getTimestamp().toISOString(),
        },
      };
      subscriptionManager.send(`processed blocks ${inserted.first.number} (${inserted.first.timestamp}) to ${inserted.last.number} (${inserted.last.timestamp})`);
    }
  }
})();
