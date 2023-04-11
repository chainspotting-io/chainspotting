'use strict';

import WebSocket from 'ws';

const ws = new WebSocket('wss://calamari.kusama.spotter.chainspotting.io');
//const ws = new WebSocket('ws://kusama-calamari.eba-ugd2bmwe.eu-central-1.elasticbeanstalk.com');
//const ws = new WebSocket('ws://localhost:8080');

ws.on('error', console.error);

ws.on('open', function open() {
  ws.send('something');
});

ws.on('message', function message(data) {
  console.log('received: %s', data);
});
