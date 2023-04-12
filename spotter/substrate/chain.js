'use strict';

import { encodeAddress } from '@polkadot/util-crypto';
import { ObjectId } from 'mongodb';

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
  return (!!sealer)
    ? encodeAddress(sealer, api.registry.chainSS58)
    : (await getSealerByProtocol(api, header, 'aura'));
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

export {
  getBlock,
  getSealer,
  getSealerByProtocol,
};
