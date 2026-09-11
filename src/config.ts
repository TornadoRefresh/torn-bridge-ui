import type { Network } from '@omni-bridge/core'

const params = new URLSearchParams(location.search)

export const NETWORK: Network = params.get('network') === 'testnet' ? 'testnet' : 'mainnet'

/** TORN on Ethereum mainnet. On testnet, pass ?token=0x... (the MockTORN deployed on Sepolia). */
export const TORN_ETH: `0x${string}` =
  NETWORK === 'mainnet'
    ? '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C'
    : ((params.get('token') as `0x${string}`) || '0x0000000000000000000000000000000000000000')

/** Known bridge deployments (mainnet, 2026-09-11). The page still verifies these against the bridge contract on load. */
export const KNOWN = NETWORK === 'mainnet'
  ? {
      solMint: '3mah3LRFDSJir7zggYPARamFi81qmfoYCDuU61hYtMZN',
      nearToken: '77777feddddffc19ff86db637967013e6c6a116c.factory.bridge.near',
    }
  : { solMint: null as string | null, nearToken: null as string | null }

export const ETH_CHAIN_ID = NETWORK === 'mainnet' ? 1 : 11155111
export const ETH_RPC = NETWORK === 'mainnet' ? 'https://ethereum-rpc.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com'
/**
 * Public Solana RPCs, tried in order. api.mainnet-beta.solana.com rejects requests that carry a browser
 * Origin header (HTTP 403), so publicnode goes first; only non-indexed methods (getAccountInfo,
 * getLatestBlockhash) are used so free endpoints accept them.
 */
export const SOL_RPCS = NETWORK === 'mainnet'
  ? ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com']
  : ['https://api.devnet.solana.com']
export const SOL_RPC = SOL_RPCS[0]

export const ETH_DECIMALS = 18
export const SOL_DECIMALS = 9 // Omni Bridge caps wrapped mints at 9 decimals

export const EXPLORER = {
  eth: NETWORK === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io',
  sol: (sig: string) => `https://solscan.io/tx/${sig}${NETWORK === 'mainnet' ? '' : '?cluster=devnet'}`,
  solToken: (m: string) => `https://solscan.io/token/${m}${NETWORK === 'mainnet' ? '' : '?cluster=devnet'}`,
  nearAccount: (a: string) => `https://${NETWORK === 'mainnet' ? '' : 'testnet.'}nearblocks.io/address/${a}`,
}
