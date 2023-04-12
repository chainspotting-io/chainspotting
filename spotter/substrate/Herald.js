'use strict';

export default class Herald {
  constructor() {
    this.maxMessages = 30;
    this.messages = [];
    this.subscribers = {};
    this.subscribe = this.subscribe.bind(this);
    this.send = this.send.bind(this);
  }
  subscribe(id, subscriber) {
    console.log(`creating subscription for ${id.key}@${id.ip}`);
    subscriber.on('close', () => {
      if (!!this.subscribers[id.key]) {
        delete this.subscribers[id.key];
        console.log(`deleted subscription for ${id.key}@${id.ip}`);
      }
    });
    this.subscribers[id.key] = subscriber;
    console.log(`created subscription for ${id.key}@${id.ip}`);
    this.messages.map((message) => this.subscribers[id.key].send(message));
  }
  send(message) {
    if (this.messages.length === 0 || (this.messages.slice(-1)[0] !== message)) {
      console.log(message);
      this.messages.push(message);
      Object.keys(this.subscribers).map((key) => this.subscribers[key].send(message));
      while (this.messages.length > this.maxMessages) {
        this.messages.shift();
      }
    }
  }
}
