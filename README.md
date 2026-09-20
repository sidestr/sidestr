# sidestr

The sidestr client as one package. Open a chain by its id, validate every block yourself, spend, peg in and out, use the EVM. The same code runs in Node and in a page.

```
npm install sidestr
```

```js
import { openWallet } from 'sidestr';
const w = await openWallet({ chain: 'sidestr:txbt4-evm' });   // a mirror is found from the relays; every block is validated here
const me = w.identity(key);                                     // key: 32 bytes of hex — a Nostr secret is one
console.log(w.balance(me.script), await w.evmBalance(w.ethAddress(key)));
const b = w.build({ key, to: 'ev1p…', amount: 1000 });          // signed and dry-run; nothing has left
await w.publish(b.hex);                                          // a kind 23500 event to the relays
```

`examples/agent.mjs` is an agent in forty lines. The API is the wallet library's: `identity`, `coins`, `balance`, `history`, `build` (with `pegout` or `evmDeposit`), `publish`, `mined`, `requestFaucet`, `judgeMirror`, `followTips`; on desk chains `lockedRewards`, `pledge`; on EVM chains `ethAddress`, `evmBalance`, `evmCall`, `buildEvm`, `buildWithdraw`, `token`, `buildTokenTransfer`, `evmActivity`. Read the [wallet](https://github.com/sidestr/wallet) for each.

## How it is put together

This package is thin. It installs the [spec](https://github.com/sidestr/spec) (the consensus library and every chain document), the [explorer](https://github.com/sidestr/explorer) (reads and validates a chain) and the [wallet](https://github.com/sidestr/wallet) (signs and publishes) as git dependencies at fixed commits, plus the [bitcoin-kernel schema](https://github.com/bitcoin-desktop/schema) they build on, and resolves them locally in Node. In a page, `browser.mjs` re-exports the wallet from jsDelivr at the same commit. The version number here is the one to move when the pins move. The EVM libraries (ethereumjs) are optional and only load on a chain that runs the EVM rule.

`npm test` opens a live chain by id and validates it.

## Licence

AGPL-3.0-or-later.
