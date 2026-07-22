# Casper Carbon — Demo Video Script (3 min)

## 0:00–0:30 — Hook & Problem

> "Carbon markets are broken. Verifying a single project takes 2–5 years of human auditing.
> Most credits are never re-checked after certification — and fraud goes undetected.
> Casper Carbon replaces human-led verification with a swarm of autonomous AI agents
> that verify, tokenize, police, and market-make carbon credits — with every decision
> settled on the Casper Network."

**Visual:** Dashboard overview → stat cards (projects, verified, credits, slashed)

---

## 0:30–1:00 — Architecture

> "Three AI agents, each with its own on-chain identity and contract-enforced permissions.
> The **Verifier** scores projects against real registry data using GPT-4o — in minutes, not years.
> The **Compliance agent** — a separate key the verifier cannot impersonate — continuously
> monitors for fraud and autonomously slashes bad projects.
> The **Market agent** keeps on-chain prices honest against live Carbonmark spot data."

**Visual:** Cut to agents page → show agent registry (type badges, reputation scores)

---

## 1:00–1:30 — Verifiable AI (the key innovation)

> "Most AI + blockchain demos ask you to trust the AI. Casper Carbon doesn't.
> Every LLM judgment is serialized to JSON, SHA-256 hashed, and committed on-chain.
> The dashboard recomputes the hash in your browser — and shows a green badge
> only if it matches the on-chain commitment. Tamper with the reasoning, and the badge breaks."

**Visual:** Projects page → click a project → expand AI reasoning → show green SHA-256 badge

---

## 1:30–2:00 — Live agent demo

> "Let's watch the agents work in real time.
> The verifier polls for pending projects, fetches registry data via the Carbonmark API,
> scores methodology and additionality with GPT-4o, and submits the verification deploy.
> Every deploy links to testnet.cspr.live — fully auditable."

**Visual:** Split screen — terminal showing verifier agent logs + dashboard activity feed
→ click a deploy link → show CSPR.live page

---

## 2:00–2:30 — Marketplace & Wallet

> "Once verified, credits are minted as CEP-18 CARBON tokens and listed on the marketplace.
> The market agent watches the live Carbonmark spot price and autonomously delists
> anything more than 50 basis points off-market.
> With CSPR.click, you can connect your wallet and buy credits directly."

**Visual:** Marketplace page → show listings, spread vs spot → connect wallet → click Buy → show deploy confirmation

---

## 2:30–3:00 — Close

> "Casper Carbon is open source, deployed on Casper Testnet, and producing real transactions
> right now. Four Odra smart contracts, three autonomous AI agents, live dashboard —
> all working end-to-end.
>
> We're building the future of trust-minimized asset verification — on Casper."

**Visual:** Dashboard with transaction feed scrolling → fade to logo + links

---

## Production Notes

- **Screen recording:** Clean terminal (dark theme), full-screen dashboard
- **Audio:** Clear voiceover, no background music
- **Format:** 1920×1080, MP4, <50MB
- **Upload:** YouTube (unlisted or public)
