// Sleep + randomized delay helpers shared across handlers.
//
// The monolith had two near-identical delay helpers (`getRandomDelay`, a
// float version, and `randomDelay`, an integer version via Math.floor) used
// interchangeably for human-timing simulation. Consolidated into one
// `randomDelay` here since the fractional-vs-integer distinction was never
// behaviorally meaningful for these call sites (setTimeout/page delays).
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const randomDelay = (min, max) => Math.random() * (max - min) + min;

module.exports = { wait, randomDelay };
