# u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/anggianugrah214-eng/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/anggianugrah214-eng/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A launch-sniper paper-trading bot for make.fun's "Pump.fun Paper Sprint: Any Bot Can Win" bounty. It paper-trades pump.fun bonding curves inside the house replay harness (`agent-fun/replay/v2`, Node 22) — no real funds, no wallet, no network.

## Strategy

Every coin is watched from its CreateEvent. In its first slots the bot reads the opening tape — the creator's own buy, how many outside wallets piled in, whether the creator has already sold, and how much real SOL the curve holds — and buys only launches that pass the rug filter:

- **Real demand, not a bundle:** at least 3 distinct non-creator buyers in the opening slots, and at most 3 — a launch crowded by many wallets at birth is usually the creator's cluster waiting to dump.
- **Fast, asymmetric exits:** take profit at +25%, stop loss at −9%, never hold past 30 slots, and exit at once when the creator sells.
- **Sizing:** target 0.25 SOL per coin, with every buy still capped at 1% of the curve's real SOL reserve and at most 5 open positions.

Settings were tuned by grid sweeps on the kit's dev window: the shipped pilot defaults lost −0.138 SOL there; this strategy made +0.044 SOL with max drawdown under 0.5% across 43 coins, and neighbouring settings all stayed positive — a plateau, not a spike.

## Layout

- `main.ts` — entry point the grader runs (`node /bot/main.ts`).
- `strategy.ts` — the strategy, a pure function of the batches it is fed (no clock, no randomness, no I/O), so the harness's two executions agree byte for byte.
- `vendor/agentfun-bot.ts` — the kit's SDK shim, vendored byte for byte.

---

<sub>Entered on [make.fun](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
