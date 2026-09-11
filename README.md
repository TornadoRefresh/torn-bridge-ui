# TORN Bridge UI

Single-page front end for moving TORN between Ethereum and Solana over NEAR Omni Bridge.
Styled after the Tornado Cash classic UI (PT Mono, `#94febf` on black, cut-corner tabs).

- No backend. Fee quotes, validation and unsigned transactions come from the official `@omni-bridge/*` SDK; the page only asks the wallet to sign.
- Ethereum side: MetaMask / Rabby (EIP-1193). Solana side: Phantom.
- Transfer status is polled from the public Omni Bridge indexer and kept in `localStorage`.
- Amount precision: 18 decimals on Ethereum, 9 on Solana. The page truncates the receive amount accordingly.

## Run

```bash
npm install
npm run dev          # http://localhost:5173  (mainnet)
```

Testnet (Sepolia ↔ Solana devnet), pointing at the MockTORN deployed by `../torn-solana-bridge/testnet-mock`:

```
http://localhost:5173/?network=testnet&token=0x<MockTORN address>
```

## Build

```bash
npm run build        # static files in dist/ — host anywhere (IPFS, Netlify, ENS)
```

## Notes

- Until TORN is registered on Omni Bridge (see `../torn-solana-bridge/`), the page shows a warning and fee quotes fail with "not registered". That is expected.
- The Wormhole SDK pulled in by `@omni-bridge/core` is stubbed out (`src/stubs/wormhole.ts`); the UI never needs to fetch VAAs.
- Bridge addresses are read from the SDK, not hardcoded. The TORN address lives in `src/config.ts`.

## Publishing

CI builds the site, prints the reproducible IPFS CID of `dist/` in the job summary and uploads it as an artifact.
Anyone can verify a deployment by building the same commit and comparing the CID.
Setting the `FLEEK_TOKEN` / `FLEEK_PROJECT_ID` secrets makes CI also publish through Fleek.
The ENS contenthash is updated manually by the name owner — no private keys live in CI.
