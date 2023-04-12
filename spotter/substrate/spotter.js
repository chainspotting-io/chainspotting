'use strict';

import { workerData, parentPort } from 'node:worker_threads';
import { WebSocketServer } from 'ws';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { MongoClient, ObjectId } from 'mongodb';
import Herald from './Herald.js';
import { getBlock } from './chain.js';
import { range } from './util.js';

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

const herald = new Herald();

const chunk = {
  size: 100
};

const spotter = {
  api: {
    uri: undefined,
    singleton: undefined,
  },
  database: {
    name: undefined,
    singleton: undefined,
  },
  server: {
    port: undefined,
    singleton: undefined,
  },
};

const init = async () => {
  const { port, uri, database } = workerData;
  if (!spotter.api.singleton || (spotter.api.uri != uri)) {
    spotter.api = {
      uri,
      singleton: await ApiPromise.create({ provider: new WsProvider(uri) }),
    };
    await spotter.api.singleton.isReady;
  }
  if (!spotter.database.singleton || (spotter.database.name != database)) {
    const mongoClient = new MongoClient(`${db.scheme}://${db.host}/${database}?authMechanism=${db.auth.mechanism}&authSource=${encodeURIComponent(db.auth.source)}&tls=${db.tls}&tlsCertificateKeyFile=${encodeURIComponent(db.cert)}`);
    spotter.database = {
      name: database,
      singleton: await mongoClient.db(database).collection(db.collection.block),
    };
    /*
    todo: implement either
    - a mechanism for dropping the collection for a clean start
    - a mechanism for processing any missing blocks in any order

    if (database === 'cs-polkadot-manta') {
      await collection.drop();
    }
    */
  }
  if (!spotter.server.singleton || (spotter.server.port != port)) {
    spotter.server = {
      port,
      singleton: new WebSocketServer({ port }),
    };
    spotter.server.singleton.on('connection', (client, request) => {
      const { 'x-real-ip': ip, 'sec-websocket-key': key } = request.headers;
      herald.subscribe({ ip, key }, client);
    });
  }
  return {
    api: spotter.api.singleton,
    collection: spotter.database.singleton,
  };
};

const spot = async () => {
  const { api, collection } = await init();
  while (!!api && !!api.isReady && !!collection) {
    try {
      const zero = await getBlock(api, 0);
      await collection.updateOne({ _id: zero._id }, { $set: zero, }, { upsert: true });
      const latest = {
        block: {
          chain: parseInt((await api.rpc.chain.getHeader()).number, 10),
          spot: (await collection.find().sort({ number: -1 }).limit(1).toArray())[0].number,
        }
      };
      herald.send(JSON.stringify({ latest }));
      while (latest.block.spot < latest.block.chain) {
        if (!!latest.insert) {
          delete latest.insert;
        }
        const blocks = await Promise.all(range((latest.block.spot + 1), Math.min((latest.block.spot + 1 + chunk.size), latest.block.chain)).map((n) => getBlock(api, n)));
        if (!!blocks && !!blocks.length) {
          const update = await collection.insertMany(blocks, { ordered: true });
          if (!!update.insertedCount) {
            latest.block.spot += update.insertedCount;
            const insertedIds = Object.values(update.insertedIds);
            latest.insert = {
              first: {
                number: parseInt(insertedIds[0].toHexString().slice(18, 24), 16),
                timestamp: insertedIds[0].getTimestamp().toISOString(),
              },
              last: {
                number: parseInt(insertedIds.slice(-1)[0].toHexString().slice(18, 24), 16),
                timestamp: insertedIds.slice(-1)[0].getTimestamp().toISOString(),
              },
            };
          }
        } else {
          await new Promise(r => setTimeout(r, 3000));
        }
        latest.block.chain = parseInt((await api.rpc.chain.getHeader()).number, 10);
        herald.send(JSON.stringify({ latest }));
      }
    } catch (error) {
      console.error(error);
      herald.send(`{"error":${JSON.stringify(error, Object.getOwnPropertyNames(error))}}`);
    }
  }
};

spot().catch((error) => {
  console.error(error);
  process.exit(-1);
});
