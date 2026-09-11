import type { Network } from '@omni-bridge/core'

const params = new URLSearchParams(location.search)

export const NETWORK: Network = params.get('network') === 'testnet' ? 'testnet' : 'mainnet'

/** TORN on Ethereum mainnet. On testnet, pass ?token=0x... (the MockTORN deployed on Sepolia). */
export const TORN_ETH: `0x${string}` =
  NETWORK === 'mainnet'
    ? '0x77777FeDdddFfC19Ff86DB637967013e6C6A116C'
    : ((params.get('token') as `0x${string}`) || '0x0000000000000000000000000000000000000000')

export const ETH_CHAIN_ID = NETWORK === 'mainnet' ? 1 : 11155111
export const ETH_RPC = NETWORK === 'mainnet' ? 'https://ethereum-rpc.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com'
export const SOL_RPC = NETWORK === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com'

export const ETH_DECIMALS = 18
export const SOL_DECIMALS = 9 // Omni Bridge caps wrapped mints at 9 decimals

export const EXPLORER = {
  eth: NETWORK === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io',
  sol: (sig: string) => `https://solscan.io/tx/${sig}${NETWORK === 'mainnet' ? '' : '?cluster=devnet'}`,
  solToken: (m: string) => `https://solscan.io/token/${m}${NETWORK === 'mainnet' ? '' : '?cluster=devnet'}`,
}
