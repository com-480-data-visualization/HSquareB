import * as d3 from "d3";
import * as topojson from "topojson-client";

import { priceContinuous, renewableAmountColor } from "./utils/colors.js";

// Conic conformal centered on central Europe — tuned so the five countries
// fill the viewport with CH slightly above visual center.
const PROJECTION_CONFIG = {
    center: [10, 48],
    rotate: [-10, 0, 0],
    parallels: [43, 55],
};

const FIT_PADDING = 64;

// Distance rings around the anchor (Munich, ~48N 10E) in kilometres.
const GRATICULE_RINGS_KM = [200, 400, 600, 800];
const GRATICULE_ANCHOR = [10, 48];
const GRATICULE_MERIDIANS = [0, 5, 10, 15, 20];
const GRATICULE_PARALLELS = [40, 45, 50, 55];
const EARTH_KM_PER_DEGREE = 111.32;

// Cartouche measured in CSS pixels against the fitted viewBox so it
// stays pinned bottom-left regardless of resize (clear of clock + HUD).
const CARTOUCHE_MARGIN_X = 42;
const CARTOUCHE_BOTTOM = 120;
const COMPASS_RADIUS = 24;
const SCALE_BAR_KM = 200;

// CH and AT centroids land on borders; nudge values in projected pixel
// space (post-fitExtent) give cleaner label placement.
const LABEL_NUDGE_PX = {
    CH: [-4, 4],
    AT: [4, 6],
    DE: [0, -4],
    FR: [-30, 30],
    IT: [-14, 10],
};

// 8 connected markets. Flow direction is inferred from price differential:
// money (and electricity) follows the gradient, low → high.
const INTERCONNECTORS = [
    ["CH", "DE"],
    ["CH", "FR"],
    ["CH", "IT"],
    ["CH", "AT"],
    ["DE", "AT"],
    ["DE", "FR"],
    ["FR", "IT"],
    ["AT", "IT"],
];

// Below 5 EUR/MWh, cross-border flow is immaterial and the map gets noisy.
const ARROW_SPREAD_THRESHOLD = 5;

// 150 EUR spread is CH→IT at the peak moment; that's where the arrow maxes out.
const ARROW_MIN_WIDTH = 1.4;
const ARROW_MAX_WIDTH = 6;
const ARROW_WIDTH_PIVOT = 150;

// Particles pooled per flow; t wraps 1→0 so DOM population stays flat.
// Density scales with |spread|. Guide path stays at low opacity as a fallback
// when no particle happens to be on the route.
// 3D bars (in "both" mode): height uses sqrt scale so small countries
// (CH, AT) remain visible alongside Germany's large peak output.
const BAR_W = 26;
const BAR_MAX_H = 100;
const BAR_DX = 9;     // depth offset x (right)
const BAR_DY = -5;    // depth offset y (upward — positive y is down in SVG)
const BAR_MAX_MW = 50000;

const PARTICLE_MIN_COUNT = 4;
const PARTICLE_MAX_COUNT = 14;
const PARTICLE_BASE_RADIUS = 1.6;
const PARTICLE_FOCUS_RADIUS = 2.4;
const PARTICLE_BASE_SPEED = 0.00035; // fraction of path length per ms
const PARTICLE_FOCUS_SPEED = 0.00055;
// Pre-sampled lookup table per flow — ~50x cheaper than per-frame
// getPointAtLength for ~60 particles at 60fps.
const PARTICLE_PATH_SAMPLES = 96;
const SVG_NS = "http://www.w3.org/2000/svg";

export function createMap(selector, config) {
    const container = document.querySelector(selector);
    if (!container) {
        throw new Error(`createMap: no element matches ${selector}`);
    }

    const { topology, showcase } = config;
    const countries = topojson.feature(topology, topology.objects.countries);
    const featureByIso = new Map(countries.features.map((f) => [f.id, f]));

    const svg = d3
        .select(container)
        .append("svg")
        .attr("xmlns", "http://www.w3.org/2000/svg")
        .attr("role", "img")
        .attr("aria-label", "Map of Switzerland, Germany, France, Italy and Austria");

    // One group-level filter replaces ~60 per-particle drop-shadows —
    // roughly an order of magnitude cheaper per frame.
    const defs = svg.append("defs");
    defs.append("marker")
        .attr("id", "flow-arrow-head")
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 7)
        .attr("refY", 5)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto-start-reverse")
        .append("path")
        .attr("d", "M 0 1 L 8 5 L 0 9 z")
        .attr("fill", "context-stroke");


    const particleFilter = defs.append("filter")
        .attr("id", "particle-glow")
        .attr("x", "-50%").attr("y", "-50%")
        .attr("width", "200%").attr("height", "200%");
    particleFilter.append("feGaussianBlur")
        .attr("in", "SourceAlpha")
        .attr("stdDeviation", 2)
        .attr("result", "blur");
    particleFilter.append("feFlood")
        .attr("flood-color", "#22d3ee")
        .attr("flood-opacity", 0.7)
        .attr("result", "flood");
    particleFilter.append("feComposite")
        .attr("in", "flood").attr("in2", "blur").attr("operator", "in")
        .attr("result", "glow");
    const merge = particleFilter.append("feMerge");
    merge.append("feMergeNode").attr("in", "glow");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    const projection = d3
        .geoConicConformal()
        .center(PROJECTION_CONFIG.center)
        .rotate(PROJECTION_CONFIG.rotate)
        .parallels(PROJECTION_CONFIG.parallels);

    const pathGen = d3.geoPath(projection);

    // Order matters: bars above labels so GW text is readable; cartouche last.
    const gGraticule = svg.append("g").attr("class", "graticule");
    const gRings = svg.append("g").attr("class", "graticule__rings");
    const gCountries = svg.append("g").attr("class", "countries");
    const gFlows = svg.append("g").attr("class", "flows");
    const gParticles = svg.append("g")
        .attr("class", "particles")
        .attr("filter", "url(#particle-glow)");
    const gParticlesNode = gParticles.node();
    const gLabels = svg.append("g").attr("class", "labels");
    const gBars = svg.append("g").attr("class", "bars3d");
    const gCartouche = svg.append("g").attr("class", "cartouche");

    // Internal geometry is static; outer transform and scale bar length
    // are recomputed per-resize against the projection.
    const gCompass = gCartouche.append("g").attr("class", "cartouche__compass");
    gCompass.append("circle")
        .attr("class", "cartouche__compass-ring")
        .attr("r", COMPASS_RADIUS);
    gCompass.append("circle")
        .attr("class", "cartouche__compass-ring cartouche__compass-ring--inner")
        .attr("r", COMPASS_RADIUS - 6);
    for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * Math.PI * 2;
        const isCardinal = i % 4 === 0;
        const outer = COMPASS_RADIUS - 1;
        const inner = outer - (isCardinal ? 8 : 4);
        gCompass.append("line")
            .attr("class",
                `cartouche__compass-tick${isCardinal ? " cartouche__compass-tick--cardinal" : ""}`)
            .attr("x1", Math.sin(angle) * inner)
            .attr("y1", -Math.cos(angle) * inner)
            .attr("x2", Math.sin(angle) * outer)
            .attr("y2", -Math.cos(angle) * outer);
    }
    gCompass.append("path")
        .attr("class", "cartouche__compass-needle")
        .attr("d", `M0,${-COMPASS_RADIUS + 3} L3,4 L0,0 L-3,4 Z`);
    gCompass.append("text")
        .attr("class", "cartouche__compass-letter")
        .attr("y", -COMPASS_RADIUS - 7)
        .text("N");

    const gScale = gCartouche.append("g").attr("class", "cartouche__scale");
    gScale.append("line")
        .attr("class", "cartouche__scale-bar")
        .attr("y1", 0).attr("y2", 0);
    gScale.append("line")
        .attr("class", "cartouche__scale-tick")
        .attr("y1", -4).attr("y2", 4);
    gScale.append("line")
        .attr("class", "cartouche__scale-tick cartouche__scale-tick--end")
        .attr("y1", -4).attr("y2", 4);
    gScale.append("line")
        .attr("class", "cartouche__scale-tick cartouche__scale-tick--mid")
        .attr("y1", -3).attr("y2", 3);
    gScale.append("text")
        .attr("class", "cartouche__scale-label")
        .attr("y", -10)
        .text(`${SCALE_BAR_KM} km`);
    gScale.append("text")
        .attr("class", "cartouche__scale-origin")
        .attr("y", 16)
        .text("0");
    gScale.append("text")
        .attr("class", "cartouche__scale-end")
        .attr("y", 16)
        .text(SCALE_BAR_KM);

    // Built once; positioned per-resize to stay just inside the viewport frame.
    const gEdgeLabels = gCartouche.append("g").attr("class", "cartouche__edges");
    const meridianLabels = gEdgeLabels
        .selectAll("text.cartouche__edge-lon")
        .data(GRATICULE_MERIDIANS)
        .join("text")
        .attr("class", "cartouche__edge-label cartouche__edge-lon")
        .text((d) => `${d}°E`);
    const parallelLabels = gEdgeLabels
        .selectAll("text.cartouche__edge-lat")
        .data(GRATICULE_PARALLELS)
        .join("text")
        .attr("class", "cartouche__edge-label cartouche__edge-lat")
        .text((d) => `${d}°N`);

    const meridianLines = gGraticule
        .selectAll("path.graticule__meridian")
        .data(GRATICULE_MERIDIANS)
        .join("path")
        .attr("class", "graticule__line graticule__meridian");

    const parallelLines = gGraticule
        .selectAll("path.graticule__parallel")
        .data(GRATICULE_PARALLELS)
        .join("path")
        .attr("class", "graticule__line graticule__parallel");

    const ringCircles = gRings
        .selectAll("circle.graticule__ring")
        .data(GRATICULE_RINGS_KM)
        .join("circle")
        .attr("class", "graticule__ring")
        .attr("fill", "none");

    const crosshair = gRings.append("g").attr("class", "graticule__crosshair");
    crosshair.append("line").attr("class", "graticule__crosshair-line");
    crosshair.append("line").attr("class", "graticule__crosshair-line");

    const COUNTRY_NAMES = {
        CH: "Switzerland", DE: "Germany", FR: "France",
        IT: "Italy", AT: "Austria",
    };

    const countryPaths = gCountries
        .selectAll("path")
        .data(countries.features)
        .join("path")
        .attr("class", "country")
        .attr("data-iso", (d) => d.id)
        // explorer.js mirrors Enter/Space to the same toggle handler.
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (d) => `Show details for ${COUNTRY_NAMES[d.id] || d.id}`);

    const tipEl = document.createElement("div");
    tipEl.className = "map-tip mono";
    tipEl.style.display = "none";
    container.appendChild(tipEl);

    countryPaths
        .on("pointerenter", function (event, d) {
            if (state.hour == null || !showcase) return;
            const entry = showcase.countries?.[d.id]?.[state.hour];
            if (!entry) return;
            const sign = entry.price < 0 ? "\u2212" : "";
            const abs = Math.abs(entry.price).toFixed(1);
            const renMW = (entry.solar || 0) + (entry.wind || 0) + (entry.hydro || 0);
            const renGW = (renMW / 1000).toFixed(1);
            tipEl.textContent =
                `${COUNTRY_NAMES[d.id] || d.id}  ${sign}\u20AC${abs}/MWh  ${renGW} GW renewable`;
            tipEl.style.display = "";
        })
        .on("pointermove", function (event) {
            const rect = container.getBoundingClientRect();
            tipEl.style.left = `${event.clientX - rect.left + 14}px`;
            tipEl.style.top = `${event.clientY - rect.top - 10}px`;
        })
        .on("pointerleave", function () {
            tipEl.style.display = "none";
        });

    const legendEl = container.querySelector(".map-legend");
    const arrowLegendEl = container.querySelector(".arrow-legend");
    const barLegendEl = container.querySelector(".bar-legend");
    const barLegendChart = barLegendEl?.querySelector(".bar-legend__chart");
    const legendCanvas = legendEl?.querySelector(".map-legend__bar");
    const legendTicksEl = legendEl?.querySelector(".map-legend__ticks");
    const legendCaptionEl = legendEl?.querySelector(".map-legend__caption");

    function drawBarLegend(show) {
        if (!barLegendEl || !barLegendChart) return;
        barLegendEl.classList.toggle("is-visible", show);
        if (!show) return;

        while (barLegendChart.firstChild) barLegendChart.firstChild.remove();

        const refs = [10, 25, 50]; // GW reference values
        const centers = [15, 45, 75];
        const lBarW = 12;
        const lDx = 5;
        const lDy = -3;
        const lMaxH = 56;
        const baseline = 62;
        const SVG_NS_L = "http://www.w3.org/2000/svg";

        refs.forEach((gw, i) => {
            const mw = gw * 1000;
            const h = Math.sqrt(mw / BAR_MAX_MW) * lMaxH;
            const cx = centers[i];
            const x0 = cx - lBarW / 2;
            const x1 = cx + lBarW / 2;
            const yBot = baseline;
            const yTop = yBot - h;

            const baseColor = renewableAmountColor(mw);
            const col = d3.color(baseColor) || d3.color("#10b981");

            const pts = (poly) => poly.map((p) => p.join(",")).join(" ");

            const side = [[x1, yTop], [x1 + lDx, yTop + lDy], [x1 + lDx, yBot + lDy], [x1, yBot]];
            const front = [[x0, yBot], [x0, yTop], [x1, yTop], [x1, yBot]];
            const top = [[x0, yTop], [x0 + lDx, yTop + lDy], [x1 + lDx, yTop + lDy], [x1, yTop]];

            [[side, col.darker(0.9)], [front, col], [top, col.brighter(0.5)]].forEach(([poly, fill]) => {
                const el = document.createElementNS(SVG_NS_L, "polygon");
                el.setAttribute("points", pts(poly));
                el.setAttribute("fill", fill.toString());
                barLegendChart.appendChild(el);
            });

            const label = document.createElementNS(SVG_NS_L, "text");
            label.setAttribute("x", cx + lDx / 2);
            label.setAttribute("y", baseline + 11);
            label.setAttribute("text-anchor", "middle");
            label.setAttribute("fill", "#94a3b8");
            label.setAttribute("font-size", "9px");
            label.setAttribute("font-family", "'JetBrains Mono', monospace");
            label.textContent = `${gw}`;
            barLegendChart.appendChild(label);
        });
    }

    function drawLegend(mode) {
        if (!legendCanvas || !legendTicksEl) return;
        const ctx = legendCanvas.getContext("2d");
        const w = legendCanvas.width;
        ctx.clearRect(0, 0, w, legendCanvas.height);
        const grad = ctx.createLinearGradient(0, 0, w, 0);

        if (mode === "renewable") {
            // renewableAmountColor domain [0, 5000, 15000, 30000, 50000] MW.
            const domain = [0, 5000, 15000, 30000, 50000];
            const colors = ["#1e293b", "#065f46", "#10b981", "#34d399", "#6ee7b7"];
            const max = domain[domain.length - 1];
            for (let i = 0; i < domain.length; i++) {
                grad.addColorStop(domain[i] / max, colors[i]);
            }
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, legendCanvas.height);
            legendTicksEl.replaceChildren();
            [0, 10, 25, 50].forEach((gw) => {
                const span = document.createElement("span");
                span.textContent = String(gw);
                legendTicksEl.appendChild(span);
            });
            if (legendCaptionEl) legendCaptionEl.textContent = "GW renewable";
        } else {
            // priceContinuous domain [-200..300] mapped onto [0..1].
            const domain = [-200, -100, -50, 0, 40, 75, 150, 300];
            const colors = [
                "#e0f7ff", "#67e8f9", "#22d3ee", "#0e7490",
                "#78716c", "#e8a460", "#ef4444", "#991b1b",
            ];
            const range = domain[domain.length - 1] - domain[0];
            for (let i = 0; i < domain.length; i++) {
                grad.addColorStop((domain[i] - domain[0]) / range, colors[i]);
            }
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, legendCanvas.height);
            legendTicksEl.replaceChildren();
            [-100, 0, 100, 200].forEach((p) => {
                const span = document.createElement("span");
                span.textContent = p < 0 ? `\u2212${Math.abs(p)}` : String(p);
                legendTicksEl.appendChild(span);
            });
            if (legendCaptionEl) legendCaptionEl.textContent = "EUR / MWh";
        }

        drawBarLegend(mode === "both");
    }

    drawLegend("price");

    function drawBars() {
        if (state.hour == null || !showcase || state.colorMode !== "both") {
            gBars.selectAll("g.bar3d").remove();
            return;
        }

        const barData = countries.features.map((f) => {
            const entry = showcase.countries?.[f.id]?.[state.hour];
            const mw = entry
                ? (entry.solar || 0) + (entry.wind || 0) + (entry.hydro || 0)
                : 0;
            const [cx, cy] = centroidPx.get(f.id) || [0, 0];
            const [nx, ny] = LABEL_NUDGE_PX[f.id] || [0, 0];
            // Per-country offsets to clear the price label.
            // CH is tiny — shift further right and up. AT is near the right edge.
            const sideX = { CH: 30, AT: -55 }[f.id] ?? 44;
            const sideY = { CH: -30 }[f.id] ?? 0;
            return { id: f.id, mw, cx: cx + nx + sideX, cy: cy + ny + sideY };
        });

        const barGroups = gBars
            .selectAll("g.bar3d")
            .data(barData, (d) => d.id)
            .join("g")
            .attr("class", "bar3d")
            .attr("pointer-events", "none");

        barGroups.selectAll("*").remove();

        barGroups.each(function (d) {
            // sqrt scale keeps small countries (CH ~3 GW) visible next to DE (~40 GW).
            const h = Math.sqrt(d.mw / BAR_MAX_MW) * BAR_MAX_H;
            if (h < 4) return;

            const baseColor = renewableAmountColor(d.mw);
            const col = d3.color(baseColor) || d3.color("#10b981");
            const sideCol = col.darker(0.9);
            const topCol = col.brighter(0.5);

            const x0 = d.cx - BAR_W / 2;
            const x1 = d.cx + BAR_W / 2;
            const yBot = d.cy + 10;   // base aligns with price-label row
            const yTop = yBot - h;

            // Front face
            const front = [
                [x0, yBot], [x0, yTop], [x1, yTop], [x1, yBot],
            ];
            // Top face (parallelogram)
            const top = [
                [x0, yTop], [x0 + BAR_DX, yTop + BAR_DY],
                [x1 + BAR_DX, yTop + BAR_DY], [x1, yTop],
            ];
            // Right side face
            const side = [
                [x1, yTop], [x1 + BAR_DX, yTop + BAR_DY],
                [x1 + BAR_DX, yBot + BAR_DY], [x1, yBot],
            ];

            const pts = (poly) => poly.map((p) => p.join(",")).join(" ");

            const g = d3.select(this);
            g.append("polygon")
                .attr("points", pts(side))
                .attr("fill", sideCol.toString())
                .attr("stroke", "none");
            g.append("polygon")
                .attr("points", pts(front))
                .attr("fill", col.toString())
                .attr("stroke", "none");
            g.append("polygon")
                .attr("points", pts(top))
                .attr("fill", topCol.toString())
                .attr("stroke", "none");

            // GW label centred above the top face.
            const labelX = d.cx + BAR_DX / 2;
            const labelY = yTop + BAR_DY - 5;
            const gw = (d.mw / 1000).toFixed(0);
            g.append("text")
                .attr("x", labelX)
                .attr("y", labelY)
                .attr("text-anchor", "middle")
                .attr("fill", "#e2e8f0")
                .attr("font-size", "12px")
                .attr("font-family", "'JetBrains Mono', monospace")
                .attr("font-weight", "600")
                .attr("paint-order", "stroke")
                .attr("stroke", "rgba(10,14,26,0.88)")
                .attr("stroke-width", "4")
                .attr("stroke-linejoin", "round")
                .attr("pointer-events", "none")
                .text(`${gw} GW`);
        });
    }

    const labelGroups = gLabels
        .selectAll("g.label")
        .data(countries.features)
        .join("g")
        .attr("class", "label")
        .attr("data-iso", (d) => d.id);

    labelGroups.append("text")
        .attr("class", "label__code")
        .text((d) => d.id);

    labelGroups.append("text")
        .attr("class", "label__price")
        .text("—");

    function resize() {
        let { clientWidth, clientHeight } = container;
        // Container is position:fixed; inset:0 so layout size == viewport.
        // On first-paint bootstrap clientWidth/Height can still be 0 — fall
        // back to the viewport so centroids compute and leader lines appear.
        if (!clientWidth) clientWidth = window.innerWidth;
        if (!clientHeight) clientHeight = window.innerHeight;
        if (!clientWidth || !clientHeight) return;
        svg.attr("viewBox", `0 0 ${clientWidth} ${clientHeight}`);
        projection.fitExtent(
            [
                [FIT_PADDING, FIT_PADDING],
                [clientWidth - FIT_PADDING, clientHeight - FIT_PADDING],
            ],
            countries,
        );

        countryPaths.attr("d", pathGen);

        const [lat0, lat1] = [
            GRATICULE_PARALLELS[0],
            GRATICULE_PARALLELS[GRATICULE_PARALLELS.length - 1],
        ];
        meridianLines.attr("d", (lon) => {
            const samples = d3.range(lat0, lat1 + 0.01, 0.5).map((lat) => [lon, lat]);
            return d3.line()(samples.map((p) => projection(p)));
        });

        const [lon0, lon1] = [
            GRATICULE_MERIDIANS[0],
            GRATICULE_MERIDIANS[GRATICULE_MERIDIANS.length - 1],
        ];
        parallelLines.attr("d", (lat) => {
            const samples = d3.range(lon0, lon1 + 0.01, 0.5).map((lon) => [lon, lat]);
            return d3.line()(samples.map((p) => projection(p)));
        });

        // km → degrees, then measure projected distance along the north meridian.
        const anchorXY = projection(GRATICULE_ANCHOR);
        ringCircles
            .attr("cx", anchorXY[0])
            .attr("cy", anchorXY[1])
            .attr("r", (km) => {
                const deg = km / EARTH_KM_PER_DEGREE;
                const edge = projection([GRATICULE_ANCHOR[0], GRATICULE_ANCHOR[1] + deg]);
                return Math.hypot(edge[0] - anchorXY[0], edge[1] - anchorXY[1]);
            });

        const ch = crosshair.selectAll(".graticule__crosshair-line");
        ch.filter((_, i) => i === 0)
            .attr("x1", anchorXY[0] - 6).attr("y1", anchorXY[1])
            .attr("x2", anchorXY[0] + 6).attr("y2", anchorXY[1]);
        ch.filter((_, i) => i === 1)
            .attr("x1", anchorXY[0]).attr("y1", anchorXY[1] - 6)
            .attr("x2", anchorXY[0]).attr("y2", anchorXY[1] + 6);

        labelGroups.attr("transform", (d) => {
            const [lon, lat] = d3.geoCentroid(d);
            const [px, py] = projection([lon, lat]);
            const [nx, ny] = LABEL_NUDGE_PX[d.id] || [0, 0];
            return `translate(${px + nx}, ${py + ny})`;
        });

        labelGroups.select(".label__code").attr("y", -8);
        labelGroups.select(".label__price").attr("y", 10);

        // Scale bar pixel length is recomputed from the current projection
        // so "200 km" on-screen matches 200 km on the ground at any resize.
        const compassX = CARTOUCHE_MARGIN_X + COMPASS_RADIUS + 4;
        const compassY = clientHeight - CARTOUCHE_BOTTOM - COMPASS_RADIUS - 48;
        gCompass.attr("transform", `translate(${compassX}, ${compassY})`);

        const scaleDeg = SCALE_BAR_KM / EARTH_KM_PER_DEGREE;
        const scaleEdge = projection([
            GRATICULE_ANCHOR[0] + scaleDeg / Math.cos((GRATICULE_ANCHOR[1] * Math.PI) / 180),
            GRATICULE_ANCHOR[1],
        ]);
        const scaleAnchor = projection(GRATICULE_ANCHOR);
        const scaleLenPx = Math.max(
            40,
            Math.abs(scaleEdge[0] - scaleAnchor[0]),
        );
        const scaleX = CARTOUCHE_MARGIN_X + 4;
        const scaleY = clientHeight - CARTOUCHE_BOTTOM + 24;
        gScale.attr("transform", `translate(${scaleX}, ${scaleY})`);
        gScale.select(".cartouche__scale-bar")
            .attr("x1", 0).attr("x2", scaleLenPx);
        gScale.select(".cartouche__scale-tick:not(.cartouche__scale-tick--end):not(.cartouche__scale-tick--mid)")
            .attr("x1", 0).attr("x2", 0);
        gScale.select(".cartouche__scale-tick--end")
            .attr("x1", scaleLenPx).attr("x2", scaleLenPx);
        gScale.select(".cartouche__scale-tick--mid")
            .attr("x1", scaleLenPx / 2).attr("x2", scaleLenPx / 2);
        gScale.select(".cartouche__scale-label").attr("x", scaleLenPx / 2);
        gScale.select(".cartouche__scale-origin").attr("x", 0);
        gScale.select(".cartouche__scale-end").attr("x", scaleLenPx);

        // Inset from viewport edge so labels clear the progress bar and HUD.
        const edgePad = 16;
        meridianLabels
            .attr("x", (lon) => projection([lon, GRATICULE_PARALLELS[GRATICULE_PARALLELS.length - 1]])[0])
            .attr("y", edgePad + 14);
        parallelLabels
            .attr("x", clientWidth - edgePad - 4)
            .attr("y", (lat) => projection([GRATICULE_MERIDIANS[GRATICULE_MERIDIANS.length - 1], lat])[1]);

        // Flow layer reads projected centroids from this cache.
        centroidPx = new Map(
            countries.features.map((f) => {
                const [lon, lat] = d3.geoCentroid(f);
                return [f.id, projection([lon, lat])];
            }),
        );

        if (state.hour != null) { drawFlows(); drawBars(); }
    }

    // Declared BEFORE the first resize() — resize() reads state.hour.
    const state = {
        hour: null,
        focusCountry: null,
        highlightCountries: [],
        colorMode: "price", // "price" or "renewable"
    };

    let centroidPx = new Map();

    // Keyed by flow id ("CH-DE"); rebuilt on each drawFlows() so
    // count/speed/radius track the current spread and focus country.
    const particlePools = new Map();
    let particleRafId = null;
    let particleLastTs = null;

    function drawFlows() {
        if (state.hour == null || !showcase) return;

        const flows = [];
        for (const [a, b] of INTERCONNECTORS) {
            const pa = showcase.countries?.[a]?.[state.hour]?.price;
            const pb = showcase.countries?.[b]?.[state.hour]?.price;
            if (pa == null || pb == null) continue;
            const spread = Math.abs(pa - pb);
            if (spread < ARROW_SPREAD_THRESHOLD) continue;

            // Low price is the oversupply source; high price the destination.
            const [fromIso, toIso] = pa < pb ? [a, b] : [b, a];
            const fromXY = centroidPx.get(fromIso);
            const toXY = centroidPx.get(toIso);
            if (!fromXY || !toXY) continue;

            const touchesFocus =
                state.focusCountry != null &&
                (fromIso === state.focusCountry || toIso === state.focusCountry);

            flows.push({
                id: `${a}-${b}`,
                fromIso,
                toIso,
                fromXY,
                toXY,
                spread,
                touchesFocus,
            });
        }

        // Stable key so persistent arrows morph instead of being recreated.
        const selection = gFlows
            .selectAll("path.flow")
            .data(flows, (d) => d.id);

        // Matches the country-fill transition so colors + arrows land as one beat.
        const DUR = 800;
        const EASE = d3.easeCubicOut;

        // Collapse to a degenerate dot at origin. The persistent "M _ Q _ _"
        // structure is required for d3.interpolateString to tween `d` cleanly.
        selection.exit()
            .transition().duration(DUR).ease(EASE)
            .attrTween("d", function (d) {
                const from = d3.select(this).attr("d");
                const collapsed = degeneratePath(d.fromXY);
                return d3.interpolateString(from, collapsed);
            })
            .attr("stroke-opacity", 0)
            .attr("stroke-width", 0)
            .remove();

        // New arrows start as a dot at the source; the merge transition
        // below grows them to the destination via d3.interpolateString.
        const enter = selection.enter()
            .append("path")
            .attr("class", "flow")
            .attr("fill", "none")
            .attr("stroke-linecap", "round")
            .attr("marker-end", "url(#flow-arrow-head)")
            .attr("stroke-opacity", 0)
            .attr("stroke-width", 0)
            .attr("d", (d) => degeneratePath(d.fromXY));

        // Guide path is deliberately dim — the real motion is on the
        // particle layer (syncParticlePools).
        enter.merge(selection)
            .classed("flow--focus", (d) => d.touchesFocus)
            .transition().duration(DUR).ease(EASE)
            .attrTween("d", function (d) {
                const from = d3.select(this).attr("d") || degeneratePath(d.fromXY);
                const to = flowPath(d.fromXY, d.toXY);
                return d3.interpolateString(from, to);
            })
            .attr("stroke-width", (d) => widthForSpread(d.spread) * 0.6)
            .attr("stroke-opacity", (d) => (d.touchesFocus ? 0.32 : 0.18));

        syncParticlePools(flows);
    }

    // Existing pools are reused (t-values survive) but their sample
    // table and density are refreshed; new pools stagger initial t so
    // the stream doesn't clump at the origin.
    function syncParticlePools(flows) {
        const nextIds = new Set(flows.map((f) => f.id));

        for (const id of Array.from(particlePools.keys())) {
            if (!nextIds.has(id)) {
                const pool = particlePools.get(id);
                pool.groupNode.remove();
                particlePools.delete(id);
            }
        }

        for (const flow of flows) {
            let pool = particlePools.get(flow.id);
            if (!pool) {
                const groupNode = document.createElementNS(SVG_NS, "g");
                groupNode.setAttribute("class", "particle-group");
                gParticlesNode.appendChild(groupNode);
                pool = {
                    id: flow.id,
                    groupNode,
                    // [x0, y0, x1, y1, ...] of length PARTICLE_PATH_SAMPLES * 2.
                    samples: new Float32Array(PARTICLE_PATH_SAMPLES * 2),
                    particles: [],
                    touchesFocus: flow.touchesFocus,
                    spread: flow.spread,
                };
                particlePools.set(flow.id, pool);
            } else {
                pool.touchesFocus = flow.touchesFocus;
                pool.spread = flow.spread;
            }

            samplePathInto(pool.samples, flow.fromXY, flow.toXY);
            resizeParticlePool(pool, particleCountForSpread(flow.spread));
        }

        ensureParticleLoop();
    }

    function resizeParticlePool(pool, targetCount) {
        const radius = pool.touchesFocus
            ? PARTICLE_FOCUS_RADIUS
            : PARTICLE_BASE_RADIUS;

        while (pool.particles.length < targetCount) {
            const idx = pool.particles.length;
            const t = (idx / targetCount + Math.random() * 0.02) % 1;
            const node = document.createElementNS(SVG_NS, "circle");
            node.setAttribute("class",
                pool.touchesFocus ? "particle particle--focus" : "particle");
            node.setAttribute("r", radius);
            node.setAttribute("cx", "0");
            node.setAttribute("cy", "0");
            pool.groupNode.appendChild(node);
            pool.particles.push({ t, node });
        }
        while (pool.particles.length > targetCount) {
            const p = pool.particles.pop();
            p.node.remove();
        }
        // Focus may have flipped — refresh r/class on kept nodes.
        for (const p of pool.particles) {
            p.node.setAttribute("r", radius);
            p.node.setAttribute("class",
                pool.touchesFocus ? "particle particle--focus" : "particle");
        }
    }

    const prefersReducedMotion =
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function ensureParticleLoop() {
        // Reduced-motion users get the static guide lines only.
        if (prefersReducedMotion) return;
        if (particleRafId != null) return;
        particleLastTs = null;
        const tick = (ts) => {
            if (particlePools.size === 0) {
                particleRafId = null;
                return;
            }
            if (particleLastTs == null) particleLastTs = ts;
            const dt = Math.min(64, ts - particleLastTs);
            particleLastTs = ts;

            const lastIdx = PARTICLE_PATH_SAMPLES - 1;
            for (const pool of particlePools.values()) {
                const speed = pool.touchesFocus
                    ? PARTICLE_FOCUS_SPEED
                    : PARTICLE_BASE_SPEED;
                const samples = pool.samples;
                for (const p of pool.particles) {
                    p.t += dt * speed;
                    if (p.t >= 1) p.t -= 1;
                    // sin(pi * t): clean 0→1→0 envelope along the path.
                    const envelope = Math.sin(Math.PI * p.t);
                    const i = (p.t * lastIdx) | 0;
                    const node = p.node;
                    // Raw DOM writes — skipping d3 wrapping keeps this to two mutations/particle/frame.
                    node.setAttribute(
                        "transform",
                        `translate(${samples[i * 2]},${samples[i * 2 + 1]})`,
                    );
                    node.style.opacity = envelope;
                }
            }

            particleRafId = requestAnimationFrame(tick);
        };
        particleRafId = requestAnimationFrame(tick);
    }

    // Uses a detached <path> for getPointAtLength; discarded after sampling.
    function samplePathInto(samples, fromXY, toXY) {
        const measure = document.createElementNS(SVG_NS, "path");
        measure.setAttribute("d", flowPath(fromXY, toXY));
        const len = measure.getTotalLength();
        const last = PARTICLE_PATH_SAMPLES - 1;
        for (let i = 0; i <= last; i++) {
            const pt = measure.getPointAtLength((i / last) * len);
            samples[i * 2] = pt.x;
            samples[i * 2 + 1] = pt.y;
        }
    }

    function particleCountForSpread(spread) {
        const t = Math.min(1, Math.max(0, spread / ARROW_WIDTH_PIVOT));
        return Math.round(
            PARTICLE_MIN_COUNT + t * (PARTICLE_MAX_COUNT - PARTICLE_MIN_COUNT),
        );
    }

    resize();
    window.addEventListener("resize", resize);

    /**
     * Update the map to a given hour and optional focus country.
     * Pass `{ hour: null }` to reset to the dark base state.
     */
    function update(next) {
        const prevMode = state.colorMode;
        Object.assign(state, next);

        const isVisible = state.hour != null && !!showcase;
        if (legendEl) legendEl.classList.toggle("is-visible", isVisible);
        if (arrowLegendEl) arrowLegendEl.classList.toggle("is-visible", isVisible);
        if (barLegendEl) barLegendEl.classList.toggle("is-visible", isVisible && state.colorMode === "both");

        if ("colorMode" in next && next.colorMode !== prevMode) {
            drawLegend(state.colorMode);
        }

        if (state.hour == null || !showcase) {
            countryPaths
                .interrupt()
                .classed("is-focus-country", false)
                .classed("is-secondary-focus", false)
                .each(function () { this.style.fill = ""; });
            labelGroups.classed("is-visible", false).classed("is-focus", false);
            gFlows.selectAll("path.flow").remove();
            for (const pool of particlePools.values()) pool.groupNode.remove();
            particlePools.clear();
            return;
        }

        // is-focus-country drives the 3D-tilt lift + focus drop-shadow in CSS.
        // is-secondary-focus gives comparison countries a dimmer contour.
        const hl = new Set(state.highlightCountries || []);
        countryPaths
            .classed("is-focus-country", (d) => d.id === state.focusCountry)
            .classed("is-secondary-focus", (d) =>
                d.id !== state.focusCountry && hl.has(d.id),
            );

        labelGroups.classed("is-visible", true);

        // Fill is written as inline style (not SVG attr) so CSS owns the
        // 800ms transition alongside stroke/transform/filter on the same
        // compositor pass. Setting it as an attribute desyncs fill from
        // the CSS-driven contour by one frame in some browsers.
        countryPaths.each(function (d) {
            const entry = showcase.countries?.[d.id]?.[state.hour];
            if (!entry) { this.style.fill = ""; return; }
            const color = state.colorMode === "renewable"
                ? renewableAmountColor((entry.solar || 0) + (entry.wind || 0) + (entry.hydro || 0))
                : priceContinuous(entry.price);
            this.style.fill = color || "";
        });

        // Focus country gets the large "hero number" treatment via the is-focus class.
        labelGroups.each(function (d) {
            const entry = showcase.countries?.[d.id]?.[state.hour];
            const g = d3.select(this);
            g.classed("is-focus", d.id === state.focusCountry);
            if (!entry) {
                g.select(".label__price").text("—");
                return;
            }
            if (state.colorMode === "renewable") {
                const mw = (entry.solar || 0) + (entry.wind || 0) + (entry.hydro || 0);
                g.select(".label__price").text(`${(mw / 1000).toFixed(1)} GW`);
            } else {
                g.select(".label__price").text(formatPrice(entry.price));
            }
        });

        drawFlows();
        drawBars();
    }

    // narrative.js uses this to draw leader lines from cards to a country.
    function getCountryCentroidPx(iso) {
        const feature = countries.features.find((f) => f.id === iso);
        if (!feature) return null;
        const [lon, lat] = d3.geoCentroid(feature);
        const px = projection([lon, lat]);
        if (!px) return null;
        // Container is position:fixed, so its rect is in viewport coords.
        const rect = container.getBoundingClientRect();
        return { x: rect.left + px[0], y: rect.top + px[1] };
    }

    function destroy() {
        window.removeEventListener("resize", resize);
        if (particleRafId != null) cancelAnimationFrame(particleRafId);
        particleRafId = null;
        particlePools.clear();
        svg.remove();
    }

    return { update, destroy, getCountryCentroidPx };
}

// Uses U+2212 (true minus) so monospace rendering lines up with digits.
function formatPrice(value) {
    if (value == null || Number.isNaN(value)) return "—";
    const rounded = Math.round(value);
    if (rounded < 0) {
        return `\u2212€${Math.abs(rounded)}`;
    }
    return `€${rounded}`;
}

// Quadratic bezier, control point left-of-travel at 18% of segment length so
// adjacent flows (e.g. CH→IT and AT→IT) don't overlap. Endpoints inset by
// GAP px so the arrow doesn't collide with the centroid price label.
function flowPath([x1, y1], [x2, y2]) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) return "";

    const GAP = 28;
    const ux = dx / len;
    const uy = dy / len;
    const sx = x1 + ux * GAP;
    const sy = y1 + uy * GAP;
    const ex = x2 - ux * GAP;
    const ey = y2 - uy * GAP;

    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    const CURVATURE = 0.18;
    const cx = mx + -uy * len * CURVATURE;
    const cy = my + ux * len * CURVATURE;

    return `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`;
}

function widthForSpread(spread) {
    const t = Math.min(1, Math.max(0, spread / ARROW_WIDTH_PIVOT));
    return ARROW_MIN_WIDTH + t * (ARROW_MAX_WIDTH - ARROW_MIN_WIDTH);
}

// Matching "M _ Q _ _" structure lets d3.interpolateString tween cleanly.
function degeneratePath([x, y]) {
    return `M${x},${y} Q${x},${y} ${x},${y}`;
}
