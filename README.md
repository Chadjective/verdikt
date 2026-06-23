# Verdikt

**Pay-per-verdict crypto threat-intelligence, billed on Solana's native Subscriptions & Allowances.**
One paywall, two products: an **instant cached verdict** (pre-pay, x402-style) or a **freshly commissioned investigation** (pay-on-completion). Built for AI agents and humans — settled on-chain, no card processor, no accounts.

> Built for the Superteam Canada *Solana Subscriptions & Allowances* demo track.
> Runs end-to-end with **no validator** (mock mode) and against **real devnet** (chain mode) on the same code.

---

## The idea

[Avoid.net](https://avoid.net) is a crypto **threat-intelligence API**: give it a token, contract, or exchange and it returns a deterministic trust score and a verdict (`avoid` / `caution` / `clear`). Browsing is free; **API access is paid** — exactly what Solana's new [Subscriptions & Allowances](https://solana.com/news/subscriptions-and-allowances) primitive is for.

Behind one paywall, two products:

| Mode | Endpoint | Settlement | Delegatee | For |
|------|----------|------------|-----------|-----|
| **Cached verdict** | `GET /api/check` | **Pre-pay** (x402: `402 → pay → retry`) | the **agent** | already-investigated entities; cheap + instant |
| **On-demand investigation** | `GET /api/investigate` | **Pay-on-completion** (charged only if it succeeds) | **Avoid.net** | unknown entities; the premium price covers the compute |
| **Subscription** | `GET /api/check/subscription` | Recurring **plan** | merchant pulls | human/team API tier; lookups + investigations included |

The unknown-entity case is the interesting one. Instead of a dead-end "no data," the agent **commissions a fresh investigation on demand** and pays for the compute — "intelligence on demand, top of the queue." In production that maps onto Avoid.net's existing `investigation_requests` queue + `avoid-investigator` agent; a paid request jumps the queue.

### Why this needs the new primitive (not raw SPL `approve`)

The agent run uses **two live delegations off a single token account** — `user → agent` (cheap checks) and `user → Avoid.net` (investigations), each with its own cap, enforced independently. Raw SPL `approve` allows **one** delegate per token account; this is precisely the limit Subscriptions & Allowances removes.

### All three S&A constructs are exercised

Subscriptions & Allowances ships three delegation constructs — Verdikt uses **all three**:

- **Fixed delegation** (`createFixedDelegation` / `transferFixed`) — the agent's check + investigation budgets in the run above (one-shot caps).
- **Recurring delegation** (`createRecurringDelegation` / `transferRecurring`) — a budget that **refills every period**, the natural fit for a long-running agent's recurring spend. Demonstrated standalone in [`npm run recurring:demo`](#quickstart-mock-mode--no-validator).
- **Subscription plan** (`createPlan` / `subscribe` / `transferSubscription`) — the human/team API tier. Proven standalone on devnet in `npm run devnet:subscription`.

Raw SPL `approve` gives you one delegate with no expiry and no refill — this primitive gives all three.

---

## What it looks like (real output, mock mode)

Budgets: **0.05** for checks (5 @ 0.01) and **0.20** for investigations (2 @ 0.10):

```
Agent 2ph76FjZLz528KfGyE3WSmZiwfr2pchfMmKZJwj5BeYo
Budget owner (delegator): 4suGekXe6j36sqKTAXJsWhEHMFEQwCxVbmchDBTBeTkX
  check budget       (user -> agent)      : 0.05
  investigation budget (user -> Avoid.net): 0.2

  paid 0.01 [cache]          [CLEAR] Acme Exchange - trust 88/100 (none) ...
  paid 0.01 [cache]          [AVOID] DrainCoin (DRAIN) - trust 4/100 (critical) ...
    !! ABORTING interaction with "DrainCoin"
  paid 0.1  [investigation]  [CLEAR] (fresh) PhantomYield - trust 93/100 (none) - Fresh investigation ...
  paid 0.01 [cache]          [AVOID] GhostBridge - trust 23/100 (high) ...
    !! ABORTING interaction with "GhostBridge"
  paid 0.1  [investigation]  [AVOID] (fresh) NovaSwap - trust 22/100 (high) - Fresh investigation ...
    !! ABORTING interaction with "NovaSwap"
  ZyptoVault: investigation budget spent
  paid 0.01 [cache]          [AVOID] DrainCoin (DRAIN) - trust 4/100 (critical) ...

Remaining -- checks: 0.01, investigations: 0
```

The agent screened known tokens cheaply, **commissioned fresh investigations** for unknowns, **aborted every risky interaction**, and **stopped commissioning when its investigation budget ran out** — both caps enforced on-chain, no human in the loop. A re-`/api/check` on `PhantomYield` afterward returns the cheap `402` tier: the investigation result is now cached.

---

## How the two flows settle

**Cached verdict — pre-pay (x402):**
```
agent ─ GET /api/check ─▶ 402 + {price, payTo}
agent ─ transferFixed (agent pulls from user→agent budget) ─▶ Solana ─▶ signature
agent ─ GET /api/check (x-payment: sig) ─▶ verify ─▶ 200 + cached report
```

**On-demand investigation — pay-on-completion:**
```
agent ─ GET /api/investigate (x-budget: user) ─▶ server checks user→Avoid.net allowance
                                                  ├─ insufficient ─▶ 402 (no compute, no charge)
                                                  └─ ok ─▶ run investigation
                                                          ├─ fails ─▶ 500 (no charge)
                                                          └─ succeeds ─▶ transferFixed
                                                              (Avoid.net pulls) ─▶ 200 + fresh report
```
You only pay for compute that was actually delivered.

---

## Architecture

```
src/
  avoid/threatApi.ts     # the "product": lookup() (cache) + investigate() (on-demand). Pure, no Solana.
  config.ts              # env, mode (mock|chain), prices, mint, keypair paths
  payments/
    types.ts             # PaymentBackend interface
    mock.ts              # MockPayments  — file-backed, mirrors on-chain semantics, no validator
    chain.ts             # ChainPayments — real @solana/subscriptions calls
    index.ts             # factory (PAYMENTS=mock|chain)
  solana/client.ts       # @solana/kit client, keypair gen/load, plugins
  server/server.ts       # /api/check (pre-pay) · /api/investigate (pay-on-completion) · /api/check/subscription
  agent/agent.ts         # autonomous agent using both budgets
  scripts/               # setup, grant-allowance (2 delegations), grant-recurring, recurring-demo, devnet-recurring, create-plan, subscribe, charge-subscription
```

### Demo operation → on-chain instruction (`@solana/subscriptions`)

| Operation | Instruction(s) |
|---|---|
| grant allowance (×2 delegatees) | `initSubscriptionAuthority` (once) + `createFixedDelegation` ×2 |
| grant recurring allowance (refilling per-period budget) | `initSubscriptionAuthority` (once) + `createRecurringDelegation` |
| pay per cached check (agent) | `transferFixed` (signed by agent) |
| pay per period from a recurring budget (agent) | `transferRecurring` (signed by agent) |
| investigate, pay-on-completion (Avoid.net) | `transferFixed` (signed by merchant, after the work) |
| read remaining budget | `fetchMaybeFixedDelegation` / `fetchMaybeRecurringDelegation` |
| create plan / subscribe / charge | `createPlan` / `subscribe` / `transferSubscription` |

Program: **`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`** (devnet + mainnet-beta; live since 2026-06-02, by Moonsong Labs + Solana Foundation; audited Cantina/Spearbit).

---

## Quickstart (mock mode — no validator)

Node ≥ 20.

```bash
npm install
cp .env.example .env          # defaults to PAYMENTS=mock

npm run setup                 # keypairs (user / agent / merchant)
npm run allowance:grant       # 2 delegations: user→agent (checks) + user→Avoid.net (investigations)
npm run plan:create           # publish a monthly plan
npm run plan:subscribe        # subscribe

npm run server                # terminal 1
npm run agent                 # terminal 2 — cached checks + on-demand investigations
```

Subscription route:

```bash
npm run plan:charge
curl "http://127.0.0.1:4021/api/check/subscription?entity=GhostBridge" \
     -H "x-subscriber: <USER_ADDRESS_FROM_SETUP>"
```

**Recurring delegation** (the third primitive, standalone — no server needed):

```bash
npm run recurring:demo        # a per-period budget: spend it, get refused at the cap, watch it refill
```

`npm run typecheck` validates every SDK call against the published types; `npm test` runs the unit suite (41 tests).

---

## Run on real devnet (chain mode)

No Solana CLI required. Public-devnet RPC airdrop is disabled, so fund the payer once at a faucet; everything else is pure-Node:

```bash
# .env:  PAYMENTS=chain
#        RPC_URL=https://api.devnet.solana.com   # or a keyed RPC (e.g. Helius) to dodge rate limits
npm run setup            # generate keypairs (prints the payer address)
# -> fund that address with ~2 devnet SOL at https://faucet.solana.com
npm run setup:chain      # create mint + ATAs + distribute SOL; prints TOKEN_MINT -> add to .env
npm run allowance:grant  # two delegations on-chain (user->agent, user->Avoid.net)
npm run server           # terminal 1
npm run agent            # terminal 2  (real transferFixed pulls + memo anchors)
npm run devnet:recurring # one-shot recurring-delegation proof (create + pull + read-back)
npm run devnet:subscription # one-shot subscription proof (createPlan + subscribe + transferSubscription)
npm run test:chain       # integration tests: fixed + recurring caps + subscription charge, all on-chain
```

**Plain SPL only** (the program's Token-2022 extension handling varies — see caveats). The public devnet RPC rate-limits hard; a free keyed RPC makes the run reliable.

## ✅ Verified live on devnet

The full flow was executed against the **live** Subscriptions & Allowances program (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`) on devnet — real `transferFixed` + `transferRecurring` + `transferSubscription` pulls and on-chain verdict anchors. **All three delegation constructs** (fixed, recurring, subscription plan) ran on-chain:

| What | Solana Explorer (devnet) |
|---|---|
| Test mint (SPL, 6 dp) | [`56Zyc…kbzk`](https://explorer.solana.com/address/56ZycpXBSYe2j81Eq2pTXFmsuqTYPxmUUxdcKxQRkbzk?cluster=devnet) |
| `transferFixed` allowance pull | [`3kPA5N…cXHf5`](https://explorer.solana.com/tx/3kPA5NFbACJaQLbYLdNbL9yWUD79MSpqBG91QPz2Q6Lw4knza1MJx66VFdR71RJYkPKPW8uQzm4xUmE5pNDcXHf5?cluster=devnet) |
| `createRecurringDelegation` (recurring budget) | [`46fZhr…2T4q94`](https://explorer.solana.com/tx/46fZhrZU5dXbbWLSrgpLqo2Jfe19FEvv5MFv8iod9kGT1Yib7FopnFGcN8KQoLCb5sNmXMeiKkhAHJwBZC2T4q94?cluster=devnet) |
| `transferRecurring` per-period pull | [`5A2azY…RRu3XF`](https://explorer.solana.com/tx/5A2azY6iw7CDkdcyZgFnmqWFK3RghnFXq5y7oeuGvRK4Po2CqNSDvVZgk7AatsbZAJEda2jY7jiNAWQWN8RRu3XF?cluster=devnet) |
| `createPlan` (subscription plan) | [`2NnVxC…5d98B6`](https://explorer.solana.com/tx/2NnVxCHB3VMnpd3rqp97o8g76n8AcxZaWF8STZ2cc5XD4sQfj6QonR8WjLJT5hotmbWX1tkZA5yExqTMbY5d98B6?cluster=devnet) |
| `subscribe` (mint Subscription PDA) | [`2Wb8RZ…mgViM`](https://explorer.solana.com/tx/2Wb8RZmYVy64XRknV3BZidGfKT2c7VrriEPFnqjkDbFbkQm2r769VBHYacjoA7u8QcfuCwviJ3APesLXmw8mgViM?cluster=devnet) |
| `transferSubscription` period charge | [`36fpgM…w3PB2Q`](https://explorer.solana.com/tx/36fpgMykAz4Xi8SazNJsgCW3t4kfiahwvzmFBfEj4Fir8UdRSGbQ2K2t1348hv41jUsGetc7E5h8eauvnjw3PB2Q?cluster=devnet) |
| Verdict anchor — Acme (clear) | [`5MWkUZ…t7zzH4`](https://explorer.solana.com/tx/5MWkUZUKQxTV9vvMC3PiewuBaPbHcLRKZwww2YVVphwRbydNbjrzf5Lbm1DY5AY99eNJRDvoJEVh3YXzptt7zzH4?cluster=devnet) |
| Verdict anchor — DrainCoin (avoid) | [`5q4Cky…cvm3A`](https://explorer.solana.com/tx/5q4Ckye4tNPw6ZorxXFWNsyArd71zFoiaAebda6LL86Jz8dHfEdnfiK31idMQd956B2zCV944oWPGAWstgzcvm3A?cluster=devnet) |
| Verdict anchor — NovaSwap (fresh investigation) | [`3GAPUY…XptLr`](https://explorer.solana.com/tx/3GAPUYpBEm6ubNqNZ3SkpqtBFjQjRT6eGTUHrmb71KmAi6zyzDmyPyeCGcWaDFWncCxWTybqMunt37iwBecXptLr?cluster=devnet) |

`npm run test:chain` passes against devnet (fixed, recurring, **and** subscription); `npm test` runs 41 unit tests. (Mint + keypairs are demo throwaways.)

---

## Mock vs chain

- **Mock** reproduces the on-chain semantics (per-pull cap, expiry, period-once charging, replay-protected proofs) in a JSON ledger — full amount/receiver/replay checks, runs anywhere.
- **Chain** issues the real instructions. For pre-pay, the server confirms the payment tx landed + replay; a production gate would also assert amount/mint/receiver via token-balance deltas (the cap + fixed price already bound spend). For **pay-on-completion**, correctness is structural: Avoid.net only pulls *after* the work succeeds. See [`chain.ts`](src/payments/chain.ts).

---

## Accuracy & caveats

- `@solana/subscriptions@0.3.0` is **pre-1.0**; versions pinned. Whole repo typechecks against the published types.
- The **recurring-delegation** path (`createRecurringDelegation` / `transferRecurring`) is implemented, typechecks against the SDK, exercised in mock (`recurring:demo` + unit tests), and **verified live on devnet** (`npm run devnet:recurring`; proofs in the table above; covered by `npm run test:chain`).
- The **subscription-plan** path (`createPlan` / `subscribe` / `transferSubscription`) is likewise implemented, typechecks, exercised in mock (`plan:create`/`plan:subscribe`/`plan:charge`), and **verified live on devnet** (`npm run devnet:subscription`; proofs in the table above; covered by `npm run test:chain`). A plan's `destinations` are payout **owner** addresses, not token accounts — the program resolves and checks the receiver ATA's owner against them.
- Threat data in [`threatApi.ts`](src/avoid/threatApi.ts) is **synthetic**; `investigate()` synthesizes a deterministic verdict to simulate compute. Swap this module for the live Avoid.net pipeline to ship.
- x402 framing is our own composition — Solana's docs pair allowances with [x402](https://solana.com/x402) but ship no canonical 402-gate code.
- "Live on mainnet" per the Solana Foundation announcement; this demo targets devnet.

---

## Canadian relevance

- **Verdikt / Avoid.net** is built in Canada (Colosseum Frontier hackathon).
- **Figment** (Toronto) — Solana staking/infra — could meter node & data APIs with on-chain tiers, like Helius.
- Canadian Web2 that would benefit from native recurring + delegated, metered spend:
  - **Shopify** (Ottawa) — merchant subscriptions / recurring billing in stablecoins.
  - **Nuvei** & **Lightspeed** (Montréal) — payments / commerce rails offering on-chain subscription collection.
  - **Wealthsimple** (Toronto) — allowances as capped, revocable automation budgets for auto-invest.

---

## Porting into Avoid.net

Replace [`src/avoid/threatApi.ts`](src/avoid/threatApi.ts) with the live Avoid.net pipeline (`lookup()` → cache/DB read, `investigate()` → a prioritized `avoid-investigator` run), and the entire `PaymentBackend` (allowance checks, investigations, subscriptions) lifts into Avoid.net's paid-API layer.

## License

MIT. Demo / educational use; threat data is illustrative.
