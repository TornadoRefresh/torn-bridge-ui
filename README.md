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

## Deployment (mainnet)

| | |
|---|---|
| TORN on Ethereum | `0x77777FeDdddFfC19Ff86DB637967013e6C6A116C` |
| TORN on Solana (Omni Bridge wrapped mint, 9 decimals) | `3mah3LRFDSJir7zggYPARamFi81qmfoYCDuU61hYtMZN` |
| NEAR mapped token | `77777feddddffc19ff86db637967013e6c6a116c.factory.bridge.near` |
| Bridge contracts | Ethereum `0xe00c629aFaCCb0510995A2B95560E446A24c85B9` · NEAR `omni.bridge.near` · Solana `dahPEoZGXfyV58JqqH85okdHmpN8U2q8owgPUXSCPxe` |

Registered on Omni Bridge on 2026-09-11 and verified with a 1 TORN round trip in both directions
(Ethereum → Solana ≈ 20 min, Solana → Ethereum < 2 min, relayer fees ≈ $0.26 / $0.02).
The mint address is derived deterministically by the bridge program; the page reads it from the bridge
contract on load and falls back to the value above.

## Notes

- Ethereum → Solana waits for the NEAR Ethereum light client (~16–20 min); Solana → Ethereum only needs Wormhole attestation.
- Amounts are truncated from 18 to 9 decimals on the way to Solana.
- The Wormhole SDK pulled in by `@omni-bridge/core` is stubbed out (`src/stubs/wormhole.ts`); the UI never needs to fetch VAAs.
- Bridge addresses are read from the SDK, not hardcoded. The TORN address lives in `src/config.ts`.

## Publishing

CI builds the site, prints the reproducible IPFS CID of `dist/` in the job summary and uploads it as an artifact.
Anyone can verify a deployment by building the same commit and comparing the CID.
Setting the `FLEEK_TOKEN` / `FLEEK_PROJECT_ID` secrets makes CI also publish through Fleek.
The ENS contenthash is updated manually by the name owner — no private keys live in CI.
