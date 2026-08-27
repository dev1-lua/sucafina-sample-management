# Coffee Trading Lingo Reference

Distilled from the five trader-training PDFs Ivo added to `forecast-context/` (July 2026):

1. **The Coffee Guide** — ITC (WTO/UN), 4th ed. 2021. Chapters 6–8 (futures & hedging, commercial contracts, risk & finance) written by a List + Beisler managing partner. Primary source for everything coffee-specific below.
2. **Commodities Demystified** — Trafigura, 2nd ed. 2019. General trading-firm primer.
3. **The Economics of Commodity Trading Firms** — Craig Pirrong, 2015 (abridged white paper).
4. **Not Too Big To Fail (Systemic Risk)** — Craig Pirrong, 2015. Risk taxonomy source.
5. **ICC National Quality Standards 2018** — ICO doc ICC 122-12 (ICC = International Coffee **Council**, the ICO governing body — not the Chamber of Commerce). Per-origin grading standards.

Definitions below use the source docs' own wording where possible.

---

## 1. The core mental model: two-component price risk

The price of any physical coffee = **futures price ± differential**. These are two independent risks:

| Component | What it is | Hedgeable? |
|---|---|---|
| **Underlying / futures price risk** | The KC or RM price itself | **Yes** — via futures/options |
| **Differential (basis) risk** | The physical premium/discount of a specific origin/quality vs the futures | **No** — "no mechanisms exist to offset the differential risk" (Coffee Guide) |

A hedged book has neutralized flat price but still carries the differential book — that is where the desk's real, un-offsettable exposure lives. Example from the Coffee Guide: Colombian Excelso UGQ moved from KC +15 to KC +80 cts/lb during 2010 — a 65 c/lb differential loss with no hedge possible.

Basis can also be distorted by **corners/squeezes** (market-power events in the futures); Pirrong explicitly names **coffee** among markets that suffered squeezes. Unusual differential moves may be market-structure driven, not fundamentals.

## 2. Position vocabulary

- **Long** — purchases exceed sales (unsold stock, or bought positions with no matching sale). Producers are a "natural long" (stocks + coffee on the trees + next crop).
- **Short** — sales exceed purchases (forward sales not yet covered by purchases). Roasters are a "natural short."
- **Square / neutral / flat** — bought ≈ sold; longs and shorts net to zero.
- **Physically long / physically short** — holding unsold inventory / forward sales of coffee not yet bought (vs. paper = futures positions).
- **Net position** — the aggregate of physical + paper legs.
- **Back-to-back** — matching a purchase and sale simultaneously (no open position).
- **Short covering** — buying back to cover shorts. **Liquidating** — large holders selling off longs. **Rally** — quick move up.
- **Selling (short) hedge** — physically long → sell futures to protect against a fall.
- **Buying (long) hedge** — physically short (forward sales) → buy futures to cover future needs.
- **Against Actuals (AA)** — both parties transfer matched futures lots at the same month/price to move a physical price onto the exchange.
- **Switch** — rolling a futures position: close the near month, open a later month (done as first notice day approaches).
- **Strong hands / weak hands** — traders who can / cannot sustain margin calls.

## 3. Futures contract specs

| | **NY Arabica "Coffee C"** | **London Robusta** |
|---|---|---|
| Symbol | **KC** | **RM** |
| Exchange | ICE Futures U.S. (New York) | ICE Futures Europe (London) |
| Underlying | Washed mild Arabica (19 origins) + Brazilian washed/pulped natural | Robusta |
| Contract size | **37,500 lb** (~17.01 t) | **10 metric tons** |
| Quotation | **US cents/lb** | **US $/metric ton, ex-warehouse** |
| Min. tick | 5/100 ct/lb = $18.75/contract | $1/ton = $10/contract |
| Trading months | **Mar, May, Jul, Sep, Dec** | **Jan, Mar, May, Jul, Sep, Nov** |
| Month codes | **H**=Mar **K**=May **N**=Jul **U**=Sep **Z**=Dec | **F**=Jan **H**=Mar **K**=May **N**=Jul **U**=Sep **X**=Nov |
| Settlement | Physical delivery | Physical delivery |

- Symbol reading: `KCZ26` = NY Arabica December 2026; `RMX26` = London Robusta November 2026.
- Nearest month = **spot/current month**. A repeat of the same month further out in the strip is the **"red"** month (red March).
- **Points**: 100 points = 1 cent/lb (KC differential unit).
- Leverage: KC at 200 cts/lb → contract worth $75,000; initial margin ≈ $5,400 (<10%). A 10 ct/lb move on 10 lots = $37,500 P&L → **variation margin / margin call**. Margin calls hit in cash immediately even when the offsetting physical gain is unrealized (funding-liquidity risk — this broke Paul Reinhart in cotton, 2008).
- Coffee trades in **USD everywhere** (London dropped sterling in 1992 to ease NY–London arbitrage).
- **KC tenderable-growth differentials** (deliverable origins vs contract price): par = washed Costa Rica, El Salvador, Guatemala, Honduras, Kenya, Mexico, Nicaragua, Panama, PNG, Peru, Uganda, Tanzania. **Colombia +400 points. Burundi/India/Rwanda/Venezuela −100. Dominican Rep./Ecuador −400. Brazil (washed & pulped natural only) −600.** Port differentials: NY/Virginia par; New Orleans/Miami/Houston −0.50 c/lb; Bremen/Hamburg, Antwerp, Barcelona −1.25 c/lb.
- KC delivery certification: blind panel of three licensed graders; six checks incl. screen (50% over screen 15, ≤5% below 14), colour, defect grade, roast, cup.
- **CFTC Commitment of Traders** categories: Commercial, Swap Dealers, Managed Money, Other Reportables (reporting threshold ≥50 contracts). Funds can hold 20–25% of open interest.
- Other venues: **B3 (Brazil)** — 100-bag Arabica contracts, lets Brazilian physical hedge against Brazilian futures (avoids differential risk); Ethiopian Commodity Exchange; Nairobi/Tanzania auctions.

## 4. PTBF (Price-To-Be-Fixed) mechanics

Dominant pricing method in mainstream trade: contract priced as **"futures month ± differential"** (e.g. "New York C December plus 3 cts/lb", "London Robusta November plus $30/ton").

- Must be fixed at contract initiation: the **differential**, the **futures month(s)**, and the **number of lots** (= physical quantity ÷ contract size, rounded).
- **Buyer's call / seller's call** — which party has the right to trigger fixation.
- Four prices exist on a PTBF: the differential, the seller's fix, the buyer's fix, and the **invoice price** (set when futures lots transfer between the two parties' accounts). Final price = invoice price ± that party's futures P&L.
- **Fixation trap**: failing to fix re-exposes a party to outright price risk. Remedies: internal stops, good-till-cancelled fix orders.
- **Shipping-month → futures-month mapping** (fix against the futures month nearest after shipment):

| Arabica shipment | Fix against | Robusta shipment | Fix against |
|---|---|---|---|
| Dec / Jan / Feb | **KCH** (Mar) | Jan | **RMF** (Jan) |
| Mar / Apr | **KCK** (May) | Feb / Mar | **RMH** (Mar) |
| May / Jun | **KCN** (Jul) | Apr / May | **RMK** (May) |
| Jul / Aug | **KCU** (Sep) | Jun / Jul | **RMN** (Jul) |
| Sep / Oct / Nov | **KCZ** (Dec) | Aug / Sep | **RMU** (Sep) |
| | | Oct / Nov | **RMX** (Nov) |

## 5. Options, swaps, curve structure

- **Call** = right to buy, **put** = right to sell, at a **strike**, for a **premium**; **in-/out-of-the-money**. Buyer's risk limited to premium (no margin); writer posts margin, risk unlimited. Producers buy **puts as a price floor**; some large Brazilian producers **sell calls** (if struck they deliver physical at strike + premium). Greeks: Delta, Gamma, Theta (always negative), Vega. Price = intrinsic + time value + implied volatility.
- **Swap** — OTC, tailored guaranteed minimum price, often multi-crop-year (ICE cleared coffee swaps from 2009).
- **Contango** — forward priced above spot (over-supply); enables **cash-and-carry** (buy physical, store, sell forward, lock in carry). **Backwardation** — spot above forward (tight supply). Curve structure signals whether inventories are building or drawing.
- **Arbitrage ("the trinity")** — transformations in **space** (transport), **time** (storage), **form** (blending/processing); profitable when the price difference exceeds the transformation cost. NY–London (Arabica–Robusta) arb is the classic inter-market trade.

## 6. Physical contracts (ECF/ESCC and GCA)

- **ESCC** — European Standard Contract for Coffee (European Coffee Federation). Three transaction types: **Shipment** (FCA/FOB/CFR/CIF), **Delivery** (in/ex store in Europe — seller's failure to source does NOT release the obligation), **Spot**. English text official; interpreted via ECF Code of Practice.
- **GCA** — U.S. Green Coffee Association: nine contract types. **"No pass – no sale"**: coffee denied U.S. entry (e.g. FDA) voids the contract for that portion, refund within 10 days. Contract must state commercial vs specialty grade (drives arbitration type).
- **Quality terms**: sold **on description** (e.g. "grade 1, FAQ, crop 2022, even roast, clean cup" — standard grades) or **on sample** (subject to approval; stock-lot; type sample — premium/specialty).
- **Quantity**: state the bag size (60/69/70 kg). One 20-ft container ≈ **19–21 t** green coffee.
- **Price**: **outright** (fixed) or **PTBF/differential**. Arabica in cts/lb; Robusta in $/MT.
- **Shipment timing**: **Prompt** = within 30 days of contract; **Immediate** = within 15 days; **Spot** = already at destination; **Afloat** = on a sailed vessel.
- **Coffee-trade FOB quirk**: under ESCC/GCA, even on FOB terms the **seller** books freight, arranges shipment and produces full shipping docs — the coffee contract's FOB **supersedes Incoterms** FOB. Risk-transfer point differs: ESCC = when the container leaves the last warehouse/stack for loading; GCA = ship's rail.
- **Weight franchise** — seller refunds natural weight loss beyond **0.5%** (both ESCC and GCA). **Net shipped weight** (final at shipment) vs **net delivered/landed weight** (reweighed on arrival).
- **Payment**: confirmed & irrevocable **letter of credit** (valid ≥21 days after last shipment date), or cash against documents.
- **Documents**: **Bill of lading** = receipt + carriage contract + negotiable **document of title** (chain of endorsement). **Sea waybill** = receipt only, NOT title. **ICO Certificate of Origin** on every shipment. Sustainability transaction certificates (Fairtrade/RA/organic) — buyer may withhold payment until provided.
- **Arbitration** (courts excluded): ECF — quality claim within **21 days** of final discharge, technical within 45; GCA — quality within **15 days**, arbitration demand within 1 year. Centres: London, Hamburg, Le Havre; U.S.: New York.

## 7. Logistics numbers

- **TEU** (20-ft): max payload 28.28 t; practical green-coffee load ≈ **21,000 kg** bagged (19–24 t range). **Bulk** (poly-lined) holds 21–24 t — ~17% more than bagged; majors receive up to ~90% bulk.
- **FCL** (shipper stuffs, "said to contain") vs **LCL** (carrier stuffs); **CY** vs **CFS**. Freight is per container, not weight.
- **Condensation is the #1 cause of claims on bagged coffee.** Never ship above **12.5% moisture** (ISO 6673); store at ~11%.
- Surcharges: **BAF** (bunker/fuel), **CAF** (currency), war-risk, congestion.
- Buyers compare origins on a **"price landed roasting plant"** basis — freight changes flow back into the FOB differential.

## 8. Quality & grading decode

**Universal criteria**: altitude/region, botanical type (Arabica = *C. arabica*; Robusta = *C. canephora*), preparation (washed/wet vs natural/dry), bean size (screens), defect count, roast appearance, cup quality, density. Arabica and Robusta always grade on **separate ladders**.

- **Screen size** = 1/64 inch (screen 17 = 17/64"). ISO mm: 10→4.00, 12→4.75, 13→5.00, 14→5.60, 15→6.00, 16→6.30, 17→6.70, 18→7.10, 19→7.50, 20→8.00.
- **Moisture ceiling**: clusters at **12–12.5%** for green export coffee everywhere (Colombia ≤12%; Italy allows ≤13% import).
- **Grade names are origin-specific — always attach a country.** Anchors:
  - **Colombia**: Premium = screen 18; **Supremo = 17**; Extra = 16; **Excelso = 14** (≥50% at 15); Caracol (peaberry) = 12. Max 72 defects per 500 g, ≤12 from Group 1.
  - **Brazil**: chato (flat) vs moca (peaberry); graúdo/médio/miúdo = large/medium/small; "Santos NY 2/3" = ≤9 secondary, 0 primary defects; MTGB = medium-to-good bean (screens 15–16); SSFC = strictly soft fine cup.
  - **Kenya / East Africa**: AA/AB by screen; **AA generally = 90% retained on screen 17** (also Angola, Uganda).
  - **Central America**: SHG (strictly high grown) / SHB (strictly hard bean) = altitude grades.
  - **Mexico**: Estrictamente Altura top grade; Maragogype = giant bean (90% > screen 19).
  - **Uganda**: EAS 130 base; Robusta screen grades 18→12 + BHP grades; Arabica Bugisu AA/A/B/PB/AB/CPB; Wugar/Drugar = washed/dry Ugandan Arabica.
  - **Indonesia**: SNI grades by defect count (Q1 ≤11 defects … Q6 ≤225).
- **Defects**: **primary** (full black, full sour, pods, parchment, foreign matter) vs **secondary** (partial black/sour, floats, withered, immature, broken, shells, husks). Defect-equivalent weighting varies by origin, and **sample sizes differ** (Colombia 500 g, Angola 600 g, Rwanda 350 g, Gabon/Togo 300 g) — raw defect counts are not comparable across countries.
- **EP / AP**: European Preparation (≤ ~6–8 defects/300 g, screen 15+) / American Preparation (more defects, screen 14+).
- **Quaker** — under-developed bean that fails to roast (specialty grades allow near zero).
- **SCA 100-point cupping**: ≥**80 = specialty** threshold; Q Grader = CQI certification.
- **Three market segments** (Coffee Guide): **standard** (~130.7M bags, differential/PTBF pricing), **premium** (~30.6M), **specialized** (~10.8M, mostly outright; Specialty Coffee Transaction Guide median ~$2.80/lb).
- **FAQ** = fair average quality.

## 9. Price references

- **Four price layers**: physical (outright or futures ± differential), futures (KC/RM), **ICO indicator prices** (published daily: Colombian Milds, Other Milds, Brazilian & Other Naturals, Robustas + composite). Robusta typically ~2/3 of Arabica.
- Market structure: top 10 roasters ≈ 35% of sales; **top 5 trade houses ≈ 50%** of trade (NKG, ECOM, Olam, LDC, Volcafe — with **Sucafina** named in the same tier; Sucafina Specialty cited as a specialty-division example). Brazil + Vietnam > 55% of world production.

## 10. Risk taxonomy (Pirrong)

Flat price → hedged away → leaves: **basis risk** (the big one), **spread risk** (calendar), **margin & volume risk** ("shipment volumes, not flat prices, are the better measure of trading risk"), **operational** (incl. rogue trader), **contract performance/counterparty**, **market liquidity**, **funding liquidity** (variation margin cash calls vs unrealized physical gains; inventory typically ~100% financed and pledged), **currency**, **political**, **legal/reputational**. Measured with **VaR** + position limits per market/region. Weak producer currencies (BRL, VND) let producers profit despite low futures prices → drives oversupply.

## 11. Caveats — do not propagate

- The Coffee Guide's **RM contract spec contains a typo** saying "Arabica coffee… Class 1 Arabica deliverable" — RM is **Robusta** (Class 1 Robusta at par).
- **"Coffee is the second most traded commodity after oil" is a myth** — explicitly debunked in the Coffee Guide; it's not in the top five.
- "ICC" in the quality-standards doc = International Coffee Council (ICO), **not** the International Chamber of Commerce (which separately publishes Incoterms).
