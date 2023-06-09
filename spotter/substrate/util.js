'use strict';

const range = (start, end) => Array.from({length: (end - start)}, (v, k) => k + start);

export {
  range,
};
