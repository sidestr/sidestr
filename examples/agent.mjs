// An agent on a sidestr chain in forty lines. Its key is a Nostr secret (32 bytes of hex): the same
// key is its chain address on every sidestr chain and its Ethereum account on the EVM ones.
//   SIDESTR_KEY=<hex> node examples/agent.mjs [chain id]      (default sidestr:txbt4-evm)
import { openWallet } from 'sidestr';
const key = process.env.SIDESTR_KEY; if (!/^[0-9a-f]{64}$/i.test(key ?? '')) throw new Error('SIDESTR_KEY: 32 bytes of hex');
const chain = process.argv[2] ?? 'sidestr:txbt4-evm';
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const w = await openWallet({ chain, onProgress: (s) => say('…', s) });     // finds a mirror from the relays, validates every block
const me = w.identity(key); const v = await w.judgeMirror();
say(`${w.chain.id} at block ${w.tip.height} · mirror ${v.ok ? 'agrees with' : 'differs from'} the signer's announcement`);
say(`I am ${me.address} · ${w.balance(me.script).spendable.toLocaleString()} sats spendable`);
if (w.evm) { const eth = w.ethAddress(key); say(`in the EVM I am ${eth} · ${(await w.evmBalance(eth)) / 1000000000n} gwei`); }
if (w.balance(me.script).total === 0) { const r = await w.requestFaucet(me.address); say(`asked a faucet for coins: ${r.accepted ? 'a relay took it' : 'no relay accepted'}`); }
// to spend: const b = w.build({ key, to: '<address>', amount: 1000 }); await w.publish(b.hex);   (a dry run happens in build)
// to use a contract on an EVM chain: const c = await w.buildEvm({ key, to: '0x…', data: '0x…' }); await w.publish(c.hex);
process.exit(0);
