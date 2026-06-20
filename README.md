# avoid-meter

**Metered crypto threat-intelligence, paid for with Solana's native Subscriptions & Allowances.**
Pay-per-check for AI agents (x402-style) and monthly plans for humans — billing settled on-chain, no card processor, no accounts.

> Built for the Superteam Canada *Solana Subscriptions & Allowances* demo track.
> Runs end-to-end with **no validator** (mock mode), and against **real devnet** (chain mode) using the same code.

---

## The idea

[Avoid.net](https://avoid.net) is a crypto **threat-intelligence API**: give it a token, contract, or exchange and it returns a deterministic trust score plus a verdict (`avoid` / `caution` / `clear`). Browsing is free; **API access is paid**.

Paid API access is exactly what Solana's new [Subscriptions & Allowances](https://solana.com/news/subscriptions-and-allowances) primitive was built for — and it unlocks a use case cards can't serve: **autonomous agents that pay per request.**

This repo demonstrates two on-chain billing modes for the same threat API:

| Flow | Who | Primitive | Story |
|------|-----|-----------|-------|
| **Pay-per-check** | AI agents | **Fixed delegation (allowance)** | A trading agent screens every token *before* it interacts, paying per check from a **capped, self-expiring budget**. x402-style: hit a `402`, pay, retry. |
| **Subscription plan** | Humans / teams | **Subscription plan** | A monthly USDC API tier — the same pattern [Helius](https://solana.com/news/subscriptions-and-allowances) (a launch partner) uses for on-chain API tiers. |

The agent flow is the headline: it's the case Solana's own framing calls out — *"a user sets a budget, the agent spends within it, and the authorization expires on its own"* — and it's genuinely useful, because a threat-intel API is precisely the kind of service an autonomous agent should consult before moving funds.

---

## What it looks like (real output, mock mode)

The agent has a watchlist and a **0.05-token budget** at **0.01/check** — so it can afford exactly 5 checks before the on-chain cap stops it:

```
Agent 2ph76FjZLz528KfGyE3WSmZiwfr2pchfMmKZJwj5BeYo
Budget owner (delegator): 4suGekXe6j36sqKTAXJsWhEHMFEQwCxVbmchDBTBeTkX
Allowance remaining: 0.05

  paid 0.01  [CLEAR] Acme Exchange - trust 88/100 (none) - Established exchange...
  paid 0.01  [AVOID] DrainCoin - trust 4/100 (critical) - Active wallet-drainer token...
    !! ABORTING interaction with "DrainCoin"
  paid 0.01  [AVOID] GhostBridge - trust 23/100 (high) - Unaudited cross-chain bridge...
    !! ABORTING interaction with "GhostBridge"
  paid 0.01  [UNKNOWN] NovaSwap (unlisted) - trust 50/100 (low) - No intelligence yet...
  paid 0.01  [CLEAR] Acme Exchange - trust 88/100 (none) - Established exchange...

  DrainCoin: cannot pay -> Allowance exhausted: remaining 0 < price 10000.
  Budget exhausted. Agent stops. (allowance cap enforced)

Done. 5 checks, spent 0.05, remaining 0.
```

The agent autonomously paid for intel, **aborted two risky interactions**, and **stopped itself when the budget ran out** — the allowance doing its job with no human in the loop.

---

## How the agent flow works (x402-style)

```
 ┌──────────┐   1. GET /api/check?entity=DrainCoin        ┌──────────────────┐
 │  Agent   │ ─────────────────────────────────────────▶  │   Avoid.net API  │
 │ (holds a │ ◀──────────  2. 402 + { price, payTo } ───── │  (paywalled)     │
 │  capped  │                                              └──────────────────┘
 │ allowance│   3. transferFixed: pull `price` from the    ┌──────────────────┐
 │  granted │      user's budget -> Avoid.net's ATA        │  Solana          │
 │ by its   │ ─────────────────────────────────────────▶  │  Subscriptions & │
 │  owner)  │ ◀────────────────  4. tx signature ───────── │  Allowances pgm  │
 │          │                                              └──────────────────┘
 │          │   5. GET /api/check  (x-payment: <sig>)      ┌──────────────────┐
 │          │ ─────────────────────────────────────────▶  │  verify payment, │
 │          │ ◀──────────  6. 200 + threat report ──────── │  serve intel     │
 └──────────┘                                              └──────────────────┘
```

The user grants the allowance **once** (`grantAllowance` → `initSubscriptionAuthority` + `createFixedDelegation`). After that the agent pays per call with no further human signing, bounded by the cap and the expiry.

> **x402 note:** Solana's docs pair allowances with [x402](https://solana.com/x402) for per-call agentic commerce, but there is no canonical code that wires HTTP 402 to this program — the `402 → pay → retry` gate here is our own minimal composition of the two ideas.

---

## Architecture

```
src/
  avoid/threatApi.ts     # the "product": Avoid.net threat intel (pure, no Solana) — the part you port
  config.ts              # env, mode (mock|chain), price, mint, keypair paths
  payments/
    types.ts             # PaymentBackend interface (allowance + subscription flows)
    mock.ts              # MockPayments  — file-backed, mirrors on-chain semantics, no validator
    chain.ts             # ChainPayments — real @solana/subscriptions calls
    index.ts             # factory (picks backend from PAYMENTS)
  solana/client.ts       # @solana/kit client, keypair gen/load, plugins
  server/server.ts       # paywalled threat API (402 agent route + subscription route)
  agent/agent.ts         # the autonomous agent
  scripts/               # setup, grant-allowance, create-plan, subscribe, charge-subscription
```

The **same `server` and `agent` code** runs against either backend. Mock mode lets anyone run the full flow instantly; chain mode proves it on real Solana. Switch with one env var (`PAYMENTS=mock|chain`).

### Demo method → on-chain instruction

| `PaymentBackend` method | `@solana/subscriptions` call (chain mode) |
|---|---|
| `grantAllowance` | `initSubscriptionAuthority` (once) + `createFixedDelegation` |
| `payPerCall` | `transferFixed` (signed by the agent/delegatee) |
| `allowanceStatus` | `fetchMaybeFixedDelegation` (reads remaining cap + expiry) |
| `createPlan` | `createPlan` |
| `subscribe` | `initSubscriptionAuthority` (once) + `subscribe` |
| `chargeSubscription` | `transferSubscription` (signed by merchant/puller) |
| `isSubscriptionActive` | `fetchMaybeSubscriptionDelegation` |

Program: **`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`** (same on devnet + mainnet-beta; live since 2026-06-02, built by Moonsong Labs + Solana Foundation, audited by Cantina/Spearbit).

---

## Quickstart (mock mode — no validator)

Requires Node ≥ 20.

```bash
npm install
cp .env.example .env          # defaults to PAYMENTS=mock

npm run setup                 # generate keypairs (user / agent / merchant)
npm run allowance:grant       # user grants the agent a 0.05 budget
npm run plan:create           # merchant publishes a monthly plan
npm run plan:subscribe        # user subscribes

npm run server                # terminal 1: the paywalled threat API
npm run agent                 # terminal 2: watch the agent pay per check
```

Then exercise the human subscription route:

```bash
npm run plan:charge           # merchant charges the subscription period
curl "http://127.0.0.1:4021/api/check/subscription?entity=GhostBridge" \
     -H "x-subscriber: <USER_ADDRESS_FROM_SETUP>"
```

---

## Run on real devnet (chain mode)

```bash
npm run setup                 # also airdrops devnet SOL; prints spl-token commands

# create a plain-SPL test token (6 decimals) and fund the user (see setup output):
spl-token create-token --decimals 6 --url devnet
spl-token create-account <MINT> --owner <USER>     --url devnet
spl-token mint          <MINT> 100 --recipient-owner <USER> --url devnet
spl-token create-account <MINT> --owner <MERCHANT> --url devnet

# in .env:
#   PAYMENTS=chain
#   RPC_URL=https://api.devnet.solana.com
#   TOKEN_MINT=<MINT>

npm run allowance:grant && npm run plan:create && npm run plan:subscribe
npm run server   # terminal 1
npm run agent    # terminal 2
```

Same scripts, now hitting the real program. **Plain SPL USDC only** — the program's Token-2022 extension handling varies by extension, so the demo avoids it (see caveats).

---

## Mock vs chain — what's real

- **Mock** reproduces the on-chain *semantics* (per-pull cap decrement, expiry, period-once charging, replay-protected proofs) in a JSON ledger so the demo is reproducible offline. It performs the full amount/receiver/replay checks.
- **Chain** issues the real instructions. The server's payment verification confirms the payment tx landed + replay protection; a production gate would additionally assert amount/mint/receiver by parsing the tx's token-balance deltas (the allowance cap and fixed server price already bound the spend). This is intentionally minimal and flagged in [`chain.ts`](src/payments/chain.ts).

---

## Accuracy & caveats

- `@solana/subscriptions@0.3.0` is **pre-1.0** — versions are pinned; the API may move.
- The whole codebase **typechecks against the published SDK types** (`npm run typecheck`).
- Threat data in [`threatApi.ts`](src/avoid/threatApi.ts) is **synthetic** (no real entity is named as malicious). Swap this module for the real Avoid.net API to ship.
- "Live on mainnet" per the Solana Foundation announcement; this demo targets **devnet**.

---

## Canadian relevance

- **avoid-meter / Avoid.net** is built in Canada (Colosseum Frontier hackathon).
- **Figment** (Toronto) — Solana staking/infra — could meter its node & data APIs with on-chain subscription tiers, exactly like Helius.
- Canadian Web2 that would benefit from native recurring + delegated spend:
  - **Shopify** (Ottawa) — merchant subscriptions / recurring billing settled in stablecoins, no processor.
  - **Nuvei** & **Lightspeed** (Montréal) — payments / commerce rails that could offer on-chain subscription collection.
  - **Wealthsimple** (Toronto) — allowances as **capped, revocable automation budgets** for recurring/auto-invest features.

---

## Porting into Avoid.net

The demo is a clean drop-in target: replace [`src/avoid/threatApi.ts`](src/avoid/threatApi.ts) with calls to the live Avoid.net pipeline, point the server at the production threat endpoint, and the entire `PaymentBackend` (allowance + subscription billing) lifts straight into Avoid.net's paid-API layer.

## License

MIT. Demo / educational use; threat data is illustrative.
