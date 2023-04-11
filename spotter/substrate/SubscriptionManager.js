'use strict';

export default class SubscriptionManager {
  constructor() {
    this.maxMessages = 30;
    this.messages = [];
    this.subscribers = {};
    this.subscribe = this.subscribe.bind(this);
    this.send = this.send.bind(this);
  }
  subscribe(id, subscriber) {
    console.log(`creating subscription for ${id}@${subscriber._socket.remoteAddress}`);
    subscriber.on('close', () => {
      if (!!this.subscribers[id]) {
        delete this.subscribers[id];
        console.log(`deleted subscription for ${id}@${subscriber._socket.remoteAddress}`);
      }
    });
    this.subscribers[id] = subscriber;
    console.log(`created subscription for ${id}@${subscriber._socket.remoteAddress}`);
    this.messages.map((message) => this.subscribers[id].send(message));
  }
  send(message) {
    console.log(message);
    this.messages.push(message);
    Object.keys(this.subscribers).map((id) => this.subscribers[id].send(message));
    while (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
  }
}
