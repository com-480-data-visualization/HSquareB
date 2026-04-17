// Keep these in sync with the :root CSS variables in docs/css/style.css.

import * as d3 from "d3";

export const PRICE_STOPS = [
    { max: -100, color: "#e0f7ff" },   // ice-white glow — peak drama
    { max: -50,  color: "#67e8f9" },
    { max: 0,    color: "#22d3ee" },
    { max: 50,   color: "#475569" },   // neutral slate — boring baseline
    { max: 100,  color: "#fb923c" },
    { max: 200,  color: "#ef4444" },
    { max: Infinity, color: "#991b1b" },
];

export function priceColor(price) {
    if (price == null || Number.isNaN(price)) return "#1c2235";
    for (const stop of PRICE_STOPS) {
        if (price < stop.max) return stop.color;
    }
    return PRICE_STOPS[PRICE_STOPS.length - 1].color;
}

// Interpolated variant — stepped priceColor bands visibly in dense grids like
// the calendar heatmap, so we interpolate the same semantic stops instead.
let _continuousScale = null;

export function priceContinuous(price) {
    if (price == null || Number.isNaN(price)) return "#1c2235";
    if (!_continuousScale) {
        const { scaleLinear, interpolateRgb } = d3;
        if (!scaleLinear) return priceColor(price);
        _continuousScale = scaleLinear()
            .domain([-200, -100, -50, 0, 40, 75, 150, 300])
            .range([
                "#e0f7ff",   // ice-white extreme negative
                "#67e8f9",
                "#22d3ee",
                "#0e7490",   // dark cyan on the negative side of zero
                "#78716c",   // warm stone baseline (~40 EUR)
                "#e8a460",
                "#ef4444",
                "#991b1b",
            ])
            .interpolate(interpolateRgb)
            .clamp(true);
    }
    return _continuousScale(price);
}

let _renewableScale = null;

export function renewableColor(share) {
    if (share == null || Number.isNaN(share)) return "#1c2235";
    if (!_renewableScale) {
        const { scaleLinear, interpolateRgb } = d3;
        if (!scaleLinear) return "#10b981";
        _renewableScale = scaleLinear()
            .domain([0, 0.3, 0.6, 1.0])
            .range(["#1e293b", "#065f46", "#10b981", "#6ee7b7"])
            .interpolate(interpolateRgb)
            .clamp(true);
    }
    return _renewableScale(share);
}

// Absolute MW, not share — the map should highlight Germany's ~45 GW, not
// hide it behind Switzerland's high-but-tiny renewable fraction.
let _renewableAmountScale = null;

export function renewableAmountColor(mw) {
    if (mw == null || Number.isNaN(mw)) return "#1c2235";
    if (!_renewableAmountScale) {
        const { scaleLinear, interpolateRgb } = d3;
        if (!scaleLinear) return "#10b981";
        _renewableAmountScale = scaleLinear()
            .domain([0, 5000, 15000, 30000, 50000])
            .range(["#1e293b", "#065f46", "#10b981", "#34d399", "#6ee7b7"])
            .interpolate(interpolateRgb)
            .clamp(true);
    }
    return _renewableAmountScale(mw);
}

export const GENERATION_COLORS = {
    solar:   "#fbbf24",
    wind:    "#10b981",
    nuclear: "#a855f7",
    hydro:   "#6366f1",
    biomass: "#84cc16",
    gas:     "#fb7185",
    coal:    "#64748b",
};
