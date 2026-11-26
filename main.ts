// Pump.fun Paper Sprint entry: a launch sniper with a rug filter, tuned on the kit's dev window.
// Run by the grader as `node /bot/main.ts`; the strategy lives in strategy.ts, the protocol in the
// vendored SDK shim (vendor/agentfun-bot.ts, a byte-identical copy of the kit's pilot SDK file).
//
// Paper trading only: the bot runs inside the house replay harness on recorded market data.
// It never touches real funds, a wallet, or the network.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
