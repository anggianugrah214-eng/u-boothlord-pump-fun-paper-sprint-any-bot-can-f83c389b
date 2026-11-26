// Launch sniper with a rug filter, for agent-fun/replay/v2 (pump.fun bonding curves).
//
// Written for the Pump.fun Paper Sprint. The bot watches every coin from its
// CreateEvent and, in the coin's first slots, reads the opening tape: how much
// the creator bought, how many outside wallets bought alongside, and whether
// the creator has already sold. It buys only launches with real but uncrowded
// demand, then exits fast and asymmetrically.
//
// Tuning (grid sweeps on the kit's dev window with the local sim): the kit's
// pilot defaults lost money (-0.138 SOL). Requiring exactly the demand window
// below (3 distinct outside buyers, no more) flipped the sign; a +25%
// take-profit, a -9% stop and a 30-slot maximum hold improved it further, and
// a 0.25 SOL target stake (each buy still capped at 1% of the curve's real
// reserve) scaled it to about +0.044 SOL with max drawdown under 0.5% across
// 43 coins — inside the guardrails (>= 20 coins with a >= 0.01 SOL round trip,
// drawdown <= 50%). Neighbouring settings (tp 20-30%, sl 6-9%, maxAge 3-5,
// maxHold 30-60) all stayed positive, so the chosen point sits on a plateau,
// not a spike.
//
// A pure function of the batches it is fed: no clock, no randomness, no I/O,
// so the harness's two executions agree byte for byte.

import { BPS, type BotState, type Batch, type OrderInput, type Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  /** A first buy may be decided at most this many slots after the create. */
  maxAge: number;
  /** Lamports to aim for per coin (each buy is still capped at 1% of real reserve). */
  stakeLamports: number;
  /** Smallest buy worth paying the transaction fee for. */
  minBuyLamports: number;
  /** Real SOL reserve window at decision time (lamports). */
  minRealSol: number;
  maxRealSol: number;
  /** The creator's own create-slot buys must not exceed this (lamports). */
  maxDevBuy: number;
  /** Distinct non-creator buyers in the opening tape: at least, and at most. */
  minBuyers: number;
  maxBuyers: number;
  /** Take profit / stop loss, in bps of value over / under cost. */
  tpBps: number;
  slBps: number;
  /** Never hold a position longer than this many slots. */
  maxHold: number;
  /** Leave at once when the creator sells while the coin is held. */
  exitOnDevSell: boolean;
  /** Never buy a coin whose creator has already sold. */
  skipDevSold: boolean;
}

export const DEFAULT_PARAMS: Params = {
  maxAge: 3,
  stakeLamports: 250_000_000,
  minBuyLamports: 5_000_000,
  minRealSol: 300_000_000,
  maxRealSol: 30_000_000_000,
  maxDevBuy: 2_500_000_000,
  minBuyers: 3,
  maxBuyers: 3,
  tpBps: 2_500,
  slBps: 900,
  maxHold: 30,
  exitOnDevSell: true,
  skipDevSold: true,
};

interface Coin {
  createSlot: number;
  creator: Pubkey;
  devBuy: bigint;
  buyers: Set<Pubkey>;
  devSold: boolean;
  complete: boolean;
  /** Decided: bought, filtered out for good, or too old. */
  done: boolean;
}

interface Held {
  openedSlot: number;
  /** Transaction fees paid on this position's fills so far. */
  txPaid: bigint;
  devSoldAtOpen: boolean;
}

export interface Strategy {
  onBatch(state: BotState, batch: Batch): OrderInput[];
}

const FEE_BPS = 125n; // protocol 95 bps + creator 30 bps

/** What selling `tokens` against reserves (vq, vt) pays after curve fees. */
function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Strategy {
  const P = params;
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Mints with a sell already in flight. */
  const selling = new Set<Pubkey>();
  const stake = BigInt(P.stakeLamports);
  const minBuy = BigInt(P.minBuyLamports);

  function readEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          createSlot: e.slot,
          creator: e.creator,
          devBuy: 0n,
          buyers: new Set(),
          devSold: false,
          complete: false,
          done: false,
        });
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c === undefined) continue;
        if (e.is_buy) {
          if (e.user === c.creator) {
            if (e.slot === c.createSlot) c.devBuy += BigInt(e.sol_amount);
          } else {
            c.buyers.add(e.user);
          }
        } else if (e.user === c.creator) {
          c.devSold = true;
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) {
          c.complete = true;
          c.done = true;
        }
      }
    }
  }

  function hasPending(state: BotState, mint: Pubkey, side: string): boolean {
    for (const p of state.pending.values()) {
      if (p.order.mint === mint && p.order.side === side) return true;
    }
    return false;
  }

  return {
    onBatch(state, batch) {
      readEvents(batch);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const tx = state.txFeeLamports();

      // Marks for this batch, by mint: the freshest reserves to value exits on.
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) {
        marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });
      }

      // Track positions from fills: when a buy fills, the hold clock starts.
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          // A harness-initiated close: the position is gone.
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        const h = held.get(f.mint);
        if (f.status !== 'rejected' && h !== undefined) h.txPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          held.set(f.mint, {
            openedSlot: f.slot,
            txPaid: BigInt(f.tx_fee_lamports),
            devSoldAtOpen: coins.get(f.mint)?.devSold ?? false,
          });
        }
      }
      for (const mint of [...selling]) {
        if (!hasPending(state, mint, 'sell')) selling.delete(mint);
      }
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !hasPending(state, mint, 'buy')) {
          held.delete(mint);
        }
      }

      // Exits first: take profit, stop loss, time stop, creator-sell exit.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { openedSlot: state.slot, txPaid: tx, devSoldAtOpen: c?.devSold ?? false };
          held.set(mint, h);
        }
        let mk = marks.get(mint);
        if (mk === undefined) {
          const cv = state.curves.get(mint);
          if (cv === undefined) continue;
          mk = { vq: cv.virtual_quote_reserves, vt: cv.virtual_token_reserves };
        }
        const value = sellValue(pos.token_amount, mk.vq, mk.vt) - tx;
        const basis = pos.cost_lamports + h.txPaid;
        let exit = false;
        if (basis > 0n) {
          if (value * BPS >= basis * (BPS + BigInt(P.tpBps))) exit = true;
          if (value * BPS <= basis * (BPS - BigInt(P.slBps))) exit = true;
        }
        if (state.slot - h.openedSlot >= P.maxHold) exit = true;
        if (P.exitOnDevSell && c !== undefined && c.devSold && !h.devSoldAtOpen) exit = true;
        if (!exit) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        if (c !== undefined) c.done = true;
      }

      // Entries: fresh launches that pass the rug filter.
      let free = state.freeCashLamports() - tx * BigInt(orders.length);
      let open = state.committedPositionCount();
      for (const [mint, c] of coins) {
        if (orders.length >= cap) break;
        if (c.done || c.complete) continue;
        if (state.slot - c.createSlot > P.maxAge) {
          c.done = true;
          continue;
        }
        if (open >= state.hello.caps.max_open_positions) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        if (P.skipDevSold && c.devSold) {
          c.done = true;
          continue;
        }
        // The rug filter: real demand, but not a bundled crowd.
        if (c.buyers.size < P.minBuyers || c.buyers.size > P.maxBuyers) continue;
        if (c.devBuy > BigInt(P.maxDevBuy)) continue;
        const rq = curve.real_quote_reserves;
        if (rq < BigInt(P.minRealSol) || rq > BigInt(P.maxRealSol)) continue;
        const maxBuy = state.maxBuyLamports(mint);
        const amount = stake < maxBuy ? stake : maxBuy;
        if (amount < minBuy) continue;
        if (free < amount + tx) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: 10_000 });
        free -= amount + tx;
        open += 1;
        c.done = true;
      }
      return orders;
    },
  };
}
