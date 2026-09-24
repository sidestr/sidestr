# A paywall paid in SHELL, walked through by hand

What happened on 24 September 2026 on `sidestr:tally`, a chain beside BLAKE2b testnet4 with the
`assets` and `pool` rules, done from a browser by someone who is not the chain's operator. Every
step below is a transaction on the chain; the txids are real and any validating client can check them.

The point of the exercise: a service can sell something for a chain asset with no account, no
payment processor and no oracle. It validates the chain itself, watches its own address, and
believes a payment because it saw it in a block, not because someone told it.

## The pieces

| piece | what it is |
|---|---|
| tally | a sidestr chain whose document names the `assets` and `pool` rules (SPEC 12) |
| SHELL | an asset issued on tally at block 217: 1,000,000 units, 2 decimals |
| the pool | SHELL/sats, opened at block 218 with 10 BTC of sats against 500,000 SHELL |
| the faucet | a process that pays 100,000 sats to any address that asks on the relays (kind 23501) |
| the exchange | a page over the pool: candles from the chain's trades, depth from the curve, market orders |
| the paywall | `paywall.mjs` in this directory: one route, opened by a payment of 0.01 SHELL |

## The walk

1. **Coins.** Open the phone wallet on tally, press *get test coins*. The faucet answers over the
   relays and the producer mines it: 100,000 sats at the new key, block 796.
2. **SHELL.** Open the exchange, spend 2,020 sats. The page quotes the swap with the pool rule's own
   arithmetic (1.01 SHELL, impact 0.36%, fee 0.3%), checks the transaction against the chain's
   rules in the browser, publishes it. Filled in block 797. The candle is on the chart.
3. **Pay.** On the pool page, *Assets → Send*: 0.01 SHELL to the paywall's address. The transaction
   carries the asset on a 1,000-sat output, as the rule requires. Mined in block 802:
   `a5959373ae1099c776f1af48502687c251dd738fdfc4993c20e9baa1e22957a7`.
4. **Sign.** On the paywall's page, paste that txid and the key that paid. The page signs the txid
   with Schnorr in the browser; the key is never sent.
5. **Open.** The service checks three things against the chain it validated: the transaction paid
   at least 0.01 SHELL to its script, the signing key is one that funded the payment, and this
   payment has not opened the door before. Then it answers with the text.

Pressing again answers `that payment was already used`. Signing with a different key answers
`that key did not fund the payment`. Both are what the chain says, not a database.

## What the service trusts

Nothing but the chain. It opens tally from a mirror named in the signer's announcement on the
relays, validates every block including the assets and pool rules, and reads its own coins. The
request's signature is checked against the key that funded the payment, which the chain also
shows. The service keeps one thing in memory, the set of payments it has already honoured, and if
it restarts that set is empty: a payment may open the door once more, which is the price of
storing nothing. A service that minds can write the set to a file.

## What it costs the payer

0.01 SHELL, about 20 sats at the day's price; plus the 1,000-sat carrier the asset output rides on
(which the recipient keeps as part of the coin) and a transaction fee of a few hundred sats. On an
asset-rule chain the unit of account is the transaction, not the token: cheap, but not free, and
not for streaming. A per-call balance is what the EVM-rule chain is for.

## A wart met on the way

Browsers keep storage per site. The plain wallet at sidestr.com and the play-grounds pages each
held their own key for tally, so the SHELL bought on the exchange (play-grounds) was not at the key
the sidestr.com wallet showed, and the first signing attempt used the wrong key. The phone
wallet's *More* tab shows the key a site holds; paste it into the other. One origin for all the
pages is the real fix.

## Run it yourself

```
node examples/paywall/paywall.mjs --chain sidestr:tally --port 8402
```

It prints its address. Pay it, then open `http://127.0.0.1:8402/` and sign there. `/status` is the
same information as plain text. Delete the directory when you are done: nothing else references it.
