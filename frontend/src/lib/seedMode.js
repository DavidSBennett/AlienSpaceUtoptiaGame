/**
 * SEED_MODE — true only in the seed/lab build.
 *
 * The seed deployment is built with VITE_SEED_MODE=1 (see the seed deploy
 * workflow). The live build never sets it, so every seed-only branch below this
 * flag is dead code in production and the normal game is byte-for-byte unchanged.
 */
export const SEED_MODE = import.meta.env.VITE_SEED_MODE === '1';
