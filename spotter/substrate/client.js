'use strict';

import WebSocket from 'ws';

const sockets = [
  {
    name: 'kusama-calamari',
    uri: 'wss://calamari.kusama.spotter.chainspotting.io',
    //uri: 'ws://localhost:8080',
    //uri: 'ws://kusama-calamari.eba-ugd2bmwe.eu-central-1.elasticbeanstalk.com',
  },
  {
    name: 'polkadot-manta',
    uri: 'wss://manta.polkadot.spotter.chainspotting.io',
    //uri: 'ws://localhost:8082',
  },
].map((socket) => {
  const ws = new WebSocket(socket.uri);
  ws.on('error', console.error);

  ws.on('open', function open() {
    console.log(`${socket.name} connection with ${socket.uri} opened`);
    //ws.send('something');
  });

  ws.on('close', function open() {
    console.log(`${socket.name} connection with ${socket.uri} closed`);
  });

  ws.on('message', function message(data) {
    console.log(`${socket.name}: ${data}`);
    //console.log('received: %s', data);
  });
});
