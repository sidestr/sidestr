// sidestr in a page: the same wallet library from jsDelivr, pinned to the commits this package was
// built against. A bundler that sees the "browser" export uses this file; a plain <script type=module>
// can import it from jsDelivr directly.
export * from 'https://cdn.jsdelivr.net/gh/sidestr/wallet@84cd14008ab37c645830c78a32e7ced81753462c/wallet.mjs';
export { openWallet as default } from 'https://cdn.jsdelivr.net/gh/sidestr/wallet@84cd14008ab37c645830c78a32e7ced81753462c/wallet.mjs';
