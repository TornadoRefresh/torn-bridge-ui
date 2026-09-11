// The UI never fetches Wormhole VAAs (that is the relayer's job), so the heavy
// @wormhole-foundation/sdk dependency of @omni-bridge/core is stubbed out of the bundle.
export function serialize(): never { throw new Error('Wormhole SDK is not bundled in this UI') }
export function wormhole(): never { throw new Error('Wormhole SDK is not bundled in this UI') }
export default {}
