# The Price of Wind and Sun — Process Book

**Team HSquareB** · Brian Banna (356437) · Lê Thào Huyèn (355566) · Hajj Hannah (346545)

**COM-480 Data Visualization · EPFL · Spring 2026**

Live site: [https://com-480-data-visualization.github.io/HSquareB/](https://com-480-data-visualization.github.io/HSquareB/)

---

## 1. Where we started

### 1.1 The original idea

We started with a question that felt simple on the surface: how does the build-out of renewable energy in one country affect electricity prices in its neighbors?

The dataset gave us the raw material to answer it. We used the **ENTSO-E Transparency Platform** download covering 1 January 2024 through 30 June 2025: 301,391 hourly observations across 23 bidding zones, with day-ahead prices and generation disaggregated by fuel type. We filtered to five zones sharing physical interconnectors across the Alps and the Rhine — Switzerland (CH), Germany-Luxembourg (DE-LU), France (FR), Northern Italy (IT-NORD), and Austria (AT).

Our first plan was clean: a choropleth of the five countries, a slider to move through time, and a toggle between two colour modes — price on one, renewable output on the other — so the reader could trace the relationshop for themselves. Two layers, one insight.

### 1.2 Why that was not enough

Two things happened when we started working seriously with the data and thinking about who would read this piece.

The first was the EDA. The numbers kept arriving in ways that a two-mode toggle would have buried. Each finding had its own shape of surprise, and leaving the reader to discover all of them by switching colour modes assumed both domain knowledge and patience that most readers would not have.

The second was the audience problem. Electricity markets have their own vocabulary — bidding zones, merit-order, duck curve, Dunkelflaute — and a reader without it, handed two colour modes, would see the correlations without understanding why any of them were remarkable. Showing the relationship is not the same as explaining why it matters.

Those two realisations, together, pushed us toward a fundamentally different structure.

---

## 2. What the data showed us

Before settling on any design, we spent time understanding what the data actually contained. The EDA findings drove every significant design decision that followed — what to show first, what to suppress and what to hand over to the reader.

**The Italy divide.** Over 18 months, Germany recorded 846 hours of negative prices (6.5% of all hours), France 715 (5.5%), Austria 584 (4.5%), Switzerland 529 (4.0%). Northern Italy: zero. Not a handful — zero across the entire window. Italy sits behind the Alps, relies heavily on gas-fired generation, and is two interconnectors further from Germany's solar core. That divide became the narrative's counterpoint: Italy as the insulated market that makes Switzerland's 529 hours feel structural rather than accidental.

![Negative-price hours by country across 18 months. The Italy/rest-of-Europe divide — zero versus hundreds — became the counterpoint that anchors the story.](../milestone_2/figures/eda_neg_hours.png)

**Switzerland should not be doing this.** Switzerland has almost no utility-scale solar, no wind to speak of, and a generation mix dominated by flexible hydro. Nothing in its own fundamentals should push its clearing price below zero. Yet 529 times it did — and 88.8% of those hours (470 of 529) fell inside the same clock hour as a German negative. Austria sat at 89.7%, France at 80.6% (France's higher absolute count includes domestically produced negatives from its nuclear-plus-wind stack; Switzerland has no such stack). Switzerland is not producing those negative hours. It is importing them through the interconnectors.

![Hourly price scatter: Switzerland versus Germany, coloured by time of day. The tight clustering along the diagonal (r = 0.755) shows Swiss prices tracking German prices closely, especially at midday when solar is strongest.](../milestone_2/figures/eda_scatter.png)

**The duck curve is deepening, fast.** Germany's average midday price at hour 13 fell from +€16.17/MWh in May 2024 to −€12.15/MWh in May 2025. On a *monthly average* basis, the belly of the duck crossed below zero inside a single year. This is not an extreme-event statistic. It is a structural shift in how the market clears at the most common demand hour.

![Germany's monthly average price profiles, January 2024 to June 2025. The midday belly deepens with each passing quarter and crosses below zero on a monthly average within a single year.](../milestone_2/figures/eda_duck_curve.png)

**Every country shares the same daily shape.** Once we plotted all five average daily profiles simultaneously, something became visible that had not been visible before: the midday trough at hours 13–14 and the evening peak at hour 19 appear in every country's profile. What differs is depth and absolute level. Germany's trough is near zero; Italy's stays positive; Switzerland and Austria track Germany closely. The daily rhythm is continental. The intensity is not.

**Renewable seasonality tells five different stories.** Germany's renewable share peaks near 70% in summer 2024 and exceeds it in 2025, driven by solar. Austria sits near 84% year-round, mostly hydro. France runs at a stable 20–30%, dominated by nuclear. Italy hovers around 40–50% with gas as the margin setter. Each mix produces a distinct price character, and the five together explain why the same solar event lands so differently across the region.

![Monthly renewable generation share by country. Austria and Switzerland lead (mostly hydro), Germany peaks in summer (solar-driven), France stays low and flat (nuclear-dominated).](../milestone_2/figures/eda_renewable_share.png)

---

## 3. Telling the story first

The EDA left us with findings that were individually striking and collectively coherent. But they needed to be narrated, not just displayed. A reader who arrives at a choropleth map without context will see colours change; they will not know what to feel about them.

We decided to show each key finding directly, in sequence, with enough framing that a reader without domain knowledge could follow the argument. That decision produced the scrollytelling architecture: a sticky map beneath a column of seven editorial cards, each card sending a state change to the map — hour, colour intensity, flow arrows, annotation. The map never leaves the screen during the scroll.

### 3.1 The seven steps

| Step | Hook | Key visual |
|------|------|-----------|
| 1 | Midnight baseline | Map at 00:00, muted prices |
| 2 | Solar ascending | Map at 11:00; Germany wakes up; solar donut |
| 3 | The shock | Map at 13:00; −€145.12 hero number; flow arrows |
| 4 | The pattern | Calendar heatmap, 13 128 cells, DE/CH toggle |
| 5 | The mechanism | Germany's generation stack for the showcase day |
| 6 | The duck deepens | Animated monthly price profiles, Jan 2024 → Jun 2025 |
| 7 | Five identities | 2×3 small-multiples grid of annual 24-h profiles |

![The peak moment: 13:00 on 12 May 2024. Switzerland clears at −€145.12/MWh — below Germany, despite a fraction of its solar capacity. Flow arrows show inferred cross-border transmission.](../milestone_2/figures/fig_02_step3_peak.png)

Step 3 went through one significant revision. The original sketch showed a full-day price line chart. After building both versions, we set them side by side: the line chart required the reader to scan a curve and locate the minimum; the single number `−€145.12` at typographic scale landed immediately. We dropped the line chart entirely, promoted the number to a full-screen bloom, and gave Germany's simultaneous price (`−€135.45`) in a supporting sentence for scale.

![The five-country small multiples at Step 7. The trough-and-peak shape appears in all five; Italy holds a positive midday average throughout.](../milestone_2/figures/fig_05_smallmults.png)

### 3.2 Visual language

The site is dark-only. Background uses a three-level navy ramp (`#0a0e1a → #131827 → #1c2235`).

**Price colour scale.** Diverging sequential from ice-white (`#e0f7ff`) at deep negatives, through navy at zero, to orange-red at positive peaks. The inversion — brightest for most negative — is deliberate. Negative prices are the drama, and they should carry the most visual weight on a dark background. A conventional blue-cold scale would have made Switzerland's lowest hour look merely "cold"; this scale makes it glow.

**Typography.** Fraunces (variable serif) for editorial copy and hero numbers. JetBrains Mono for every data value, label, country code, and legend tick. Numbers are never set in the serif. The pairing creates a data-journalism register — narrative warmth in the body, machine precision in the data.

**Flow arrows.** Width proportional to the absolute price spread between bidding zones; direction inferred from the differential (electricity flows from cheap to expensive). We do not have net transfer data, so directional inference is explicitly disclosed in the footer. The arrows were originally drawn as bezier curves; we switched to straight paths with a manual midpoint jog after curves passed through country centroids.

---

## 4. Letting the audience explore

Ending at the final narrative card would have closed something that should stay open. The patterns we found during EDA were the ones we already knew to look for. A reader coming to the data fresh might notice something we missed entirely — a country pair we did not highlight, an hour of the day we did not linger on, an anomaly in the months between our showcase events.

So after Step 7, the page opens into a free-play **interactive explorer**. The same map, now driven by a 24-hour timeline scrubber over 12 May 2024. The reader can play the day forward at 1×, 2×, or 4× speed, pause with the Space bar, or step frame by frame with the arrow keys. Clicking any country opens a sidebar showing the current price, renewable share, gap to Italy, a mini generation stack, and the daily price profile with the annual average overlaid as a ghost line.

A **colour-mode toggle** gives the reader three views of the same map: **Price** colours countries by day-ahead clearing price; **Renewable** switches to total renewable generation in GW; and **Both** overlays the two simultaneously — country fills stay on the price scale while pseudo-3D bars rise beside each label, their height encoding renewable output so the reader can see Germany's solar peak and the price collapse side by side at the same hour.

![The interactive explorer at hour 13. The Switzerland sidebar shows current price, renewable share, generation stack, and daily profile. The reader drives everything on their own terms.](../milestone_2/figures/fig_06_explorer.png) ![Toggling to Renewable mode recolours the map to show generation in GW. Germany's solar peak at hour 13 aligns exactly with the price floor.](../milestone_2/figures/fig_07_colour_toggle.png)

---

## 5. Building It

### 5.1 Stack

| Layer | Tool |
|---|---|
| Rendering | D3 v7 (SVG + Canvas), vanilla ES modules |
| Scroll | Scrollama v3 |
| Map | `world-atlas` TopoJSON filtered to 5 countries (17 KB) |
| Preprocessing | Python 3.9, pandas, pyarrow |
| Hosting | GitHub Pages, static from `docs/` |

No framework, no build step. Every ES import is resolved from a browser importmap. Avoiding a bundler kept the dev loop instant (edit → refresh) and removed an entire class of dependency-resolution bugs.

### 5.2 Data pipeline

```
data/entsoe_data_2024_2025.csv  (raw, immutable)
        ↓  scripts/preprocess.py
docs/data/processed/
    showcase_day.json       hourly snapshots for May 12 2024
    calendar_heatmap.json   13 128 hourly price cells per country (CH + DE)
    daily_profiles.json     monthly average 24-h profiles
    generation_stacks.json  hourly fuel mix for showcase day
    map.topojson            17 KB filtered geometry
```

`showcase_day.json` and `daily_profiles.json` are preloaded at parse time. The calendar heatmap (182 KB) is deferred until Step 4 so it does not block first paint.

### 5.3 Module structure

```
docs/js/
    main.js           entry, orchestration, hero animations
    map.js            D3 map, colour scales, flow arrows, 3D bars
    narrative.js      Scrollama wiring, per-step state machine
    explorer.js       timeline, sidebar, playback loop
    charts/
        calendar_heatmap.js   Canvas renderer (13 128 cells)
        generation_stack.js   Stacked area + price line
        daily_profile.js      24-h line chart
    utils/
        colors.js      colour scales and fuel palette
        data.js        JSON loader with error boundary
```

The calendar heatmap uses a Canvas renderer rather than SVG. The first SVG implementation took ~340 ms to render and caused layout thrash each time the DE/CH tab toggle fired. Moving to Canvas brought repaint time to ~4 ms via `ctx.clearRect` + synchronous redraw. The Canvas element carries an `aria-description` so screen readers still receive the data summary.

### 5.4 Mobile

The initial build was desktop-only. Making it work on phones and tablets required: iOS safe-area insets on all fixed-position UI (`env(safe-area-inset-*)`), 44 px minimum touch targets on every control, a full-screen modal sidebar on narrow viewports, calendar heatmap cells that shrink rather than overflow on mobile, hover interactions suppressed on touch devices (`@media (hover: none)`), and a double-`requestAnimationFrame` resize handler so all modules recompute after the viewport settles on orientation change. Small multiples collapse from three columns to one below 600 px.

---

## 6. Decisions that were not obvious in advance

**Turning the Italy problem into an asset.** We originally framed Italy as a full participant in the negative-price story. When the EDA showed zero negative hours, that felt like a gap. We reframed it: Italy's insulation is the counterpoint that makes Switzerland's 529 hours feel structurally surprising rather than incidental. The Step 7 copy — *"Italy, still dependent on gas, remains insulated. For now."* — was written after we understood the data, not before.

**Hero number instead of a line chart.** Step 3 went through two iterations. A full-day price line chart asks the reader to scan and locate the minimum. The number `−€145.12` at typographic scale hits in under a second. We chose the number and moved the line chart to the explorer sidebar, where the reader encounters it only after they have already absorbed the peak-hour story.

**Ice-white for the most negative prices.** We tested three colour scales before settling on the current one. A red-to-blue diverging scale made negative prices look "cold" — semantically misleading, since they represent economic stress. A green-negative/red-positive scale violated traffic-light conventions. The ice-white-to-navy-to-orange scale was the only one where Switzerland going lighter than Germany at Step 3 was immediately visible on the dark background without any annotation pointing to it.

**Adding a "Both" mode instead of forcing a choice.** The original explorer offered two colour modes: Price or Renewable. Toggling between them made the correlation between solar output and price collapse visible but effortful — the reader had to hold one map in memory while looking at the other. We added a third mode, Both, that keeps the price colour scale on the country fills while pseudo-3D bars rise beside each label to show renewable output in GW. A square-root height scale ensures smaller producers like Switzerland and Austria remain legible next to Germany's much larger output. Two legends appear simultaneously, one for each encoding. The mode was the last major feature added and came directly from noticing that neither Price nor Renewable alone told the causal story as clearly as both together.

---

## 7. Peer assessment

All three of us contributed equally across every stage of the project. The framing of the question, the choice of dataset, the decision to move from a simple choropleth to a guided narrative followed by an explorer, the seven-step arc, the visual language, and the final round of edits were all made together. 

Brian Banna built the Python preprocessing pipeline that converts the raw ENTSO-E CSV into the JSON artefacts consumed by the site. Implemented the calendar heatmap on Canvas after the initial SVG version proved too slow. Built the scroll orchestration with Scrollama, including the per-step state machine that drives the map. Built the first working version of the interactive explorer — the timeline scrubber, the country selection, and the basic playback loop. Handled the mobile responsiveness pass: safe-area insets, touch targets, the resize handler, and the small-multiples breakpoint behaviour.

Lê Thào Huyèn shaped the seven-step narrative arc and wrote the editorial copy for each step, including the Step 3 hero moment and the Italy closer. Polished and completed the interactive explorer on top of Brian's initial build: added the keyboard shortcuts and playback speed controls, and implemented the three-mode colour toggle including the Both view with the pseudo-3D bars. Authored the process book.

Hajj Hannah ran the exploratory data analysis that produced the core findings — the 529-hour count, the Switzerland/Germany co-occurrence rate, and the year-over-year duck curve shift — and designed the EDA figures that seeded the final visuals. Built the visual design system: the navy background ramp, the ice-white-to-orange price scale, and the Fraunces / JetBrains Mono typography pairing. Composed the Step 7 small multiples. Ran the accessibility audit and the user testing round.
