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

## Command line

`npx sidestr` (or `sidestr` once installed) is a thin command over the same library: every command is a wallet call plus formatting, and nothing is fetched at run time beyond the mirror and the relays.

```
sidestr info --chain sidestr:melchain                      the chain, its tip, the mirror judged against the announcement
sidestr whoami --key-file ~/.sidestr/me.key                 pubkey, address, did:nostr
sidestr balance | coins | history [addr]                    of the key's address, or of addr (no key needed)
sidestr tx <txid>                                           the block it was mined in
sidestr send <to> <amount> [--fee N] [--yes] [--wait]       prints the plan; --yes broadcasts; --wait blocks until mined
sidestr data <text> [--hex] [--yes] [--wait]                an OP_RETURN spend, change to self
sidestr publish <hex>                                       broadcast a signed transaction
sidestr faucet [--wait]                                     ask a faucet on the relays
sidestr sign <hex32>                                        Schnorr-sign a 32-byte message (a txid) with the key
```

The key comes from `--key-file`, `$SIDESTR_KEY_FILE`, `$SIDESTR_KEY`, or as a last resort `git config nostr.privkey` (plaintext, so warned about); never from an argument. `--chain` finds the mirror from the signer's announcement and remembers it; `--mirror` pins one. Read commands need no key, so an agent can be allowed them permanently and asked before each spend. `--json` for machines; exit 0 ok, 1 error, 2 not enough funds. Validated state is cached in `~/.cache/sidestr`, so a later run checks only the blocks since; `--no-cache` validates from genesis.

## A paywall in one file

`examples/paywall/paywall.mjs` is a service that trusts nothing but the chain: it validates tally itself, watches its own address, and opens one route to whoever paid it 0.01 SHELL and signs the payment's txid with the key that paid. No account, no oracle, no state beyond the chain, a key file it makes itself.

```
node examples/paywall/paywall.mjs --chain sidestr:tally --port 8402      prints its address and balance
sidestr sign <txid> --key-file <the key that paid>              -> pub and sig
curl "http://127.0.0.1:8402/text?txid=<txid>&pub=<pub>&sig=<sig>"
```

Pay it from the tally page (Assets → Send). A payment opens the door once; a replay, a payment below the price, or a signature from a key that did not fund the payment is refused with the reason.
