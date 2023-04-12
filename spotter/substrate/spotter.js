'use strict';

import { workerData, parentPort } from 'worker_threads';
import { WebSocketServer } from 'ws';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { MongoClient, ObjectId } from 'mongodb';
import SubscriptionManager from './SubscriptionManager.js'
import { getBlock } from './chain.js'
import { range } from './util.js'

const db = {
  scheme: 'mongodb+srv',
  host: 'chaincluster.oulrzox.mongodb.net',
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

const subscriptionManager = new SubscriptionManager();

const chunk = {
  size: 100
};

const spot = async () => {
  const { port, uri, database } = workerData;
  const provider = new WsProvider(uri);
  const mongo = new MongoClient(`${db.scheme}://${db.host}/${database}?authMechanism=${db.auth.mechanism}&authSource=${encodeURIComponent(db.auth.source)}&tls=${db.tls}&tlsCertificateKeyFile=${encodeURIComponent(db.cert)}`);
  const webSocketServer = new WebSocketServer({ port });
  webSocketServer.on('connection', (client, request) => subscriptionManager.subscribe(request.headers['sec-websocket-key'], client));
  while (true) {
    try {
      const api = await ApiPromise.create({ provider });
      await api.isReady;
      /*
      todo: implement a mechanism for dropping the collection for a clean start
      if (database === 'cs-polkadot-manta') {
        await mongo.db(database).collection(db.collection.block).drop();
      }
      */
      const blockZero = await getBlock(api, 0);
      await mongo.db(database).collection(db.collection.block).updateOne({ _id: blockZero._id }, { $set: blockZero, }, { upsert: true });
      let latestBlockNumberInMongo = (await mongo.db(database).collection(db.collection.block).find().sort({ number: -1 }).limit(1).toArray())[0].number;
      let latestBlockNumberOnChain = parseInt((await api.rpc.chain.getHeader()).number, 10);
      subscriptionManager.send(JSON.stringify({ latestBlockNumberInMongo, latestBlockNumberOnChain }));
      while (latestBlockNumberInMongo < latestBlockNumberOnChain) {
        const blocks = await Promise.all(range((latestBlockNumberInMongo + 1), Math.min((latestBlockNumberInMongo + 1 + chunk.size), latestBlockNumberOnChain)).map((n) => getBlock(api, n)));
        const update = await mongo.db(database).collection(db.collection.block).insertMany(blocks, { ordered: true });
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
          latestBlockNumberOnChain = parseInt((await api.rpc.chain.getHeader()).number, 10);
          subscriptionManager.send(JSON.stringify({ latestBlockNumberInMongo, latestBlockNumberOnChain, inserted }));
        }
      }
    } catch (error) {
      console.error(error);
      subscriptionManager.send(JSON.stringify({ error }));
    }
  }
};

spot().catch((error) => {
  console.error(error);
  process.exit(-1);
});
