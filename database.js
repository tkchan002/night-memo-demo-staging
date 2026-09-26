// Backwards-compatible public data facade. Existing auth/template modules can
// keep importing ./database.js while persistence is owned by data/ modules.
export * from './data/index.js';
