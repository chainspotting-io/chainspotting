'use strict';

import { Worker } from 'worker_threads';

const runWorkers = (configs) => {
  return configs.map((workerData, worker) => {
    return new Promise((resolve, reject) => (
      new Worker(`./spotter.js`, { workerData })
        .on('message', console.log)
        .on('error', reject)
        .on('exit', (code) => ((code !== 0) ? reject(new Error(`exit code: ${code}`)) : resolve(`exit code: ${code}`)))
    ));
  });
}

async function run() {
  const workers = await Promise.all(runWorkers([
    {
      port: 8080,
      uri: 'wss://ws.archive.calamari.systems',
      database: 'cs-kusama-calamari',
    },
    {
      port: 8082,
      uri: 'wss://ws.archive.manta.systems',
      database: 'cs-polkadot-manta',
    },
  ]));
  process.exit(0);
}

run().catch(error => {
  console.error(error);
  process.exit(-1);
});
