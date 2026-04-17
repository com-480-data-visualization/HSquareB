// Scrollama drives step-in-view detection; each active step toggles the card,
// updates the map, and refreshes the HUD. Active zone is 80% from the top so
// the map lights up before the prose settles.

import * as d3 from "d3";
import scrollama from "scrollama";
import { createCalendarHeatmap } from "./charts/calendar_heatmap.js";
import { createGenerationStack } from "./charts/generation_stack.js";
import { createDailyProfile } from "./charts/daily_profile.js";

const ACTIVE_OFFSET = window.innerHeight < 700 ? 0.6 : 0.80;
const HUD_PROGRESS_SELECTOR = "[data-hud-timestamp]";
const HUD_META_SELECTOR = "[data-hud-meta]";
const PROGRESS_BAR_SELECTOR = ".scroll-progress__bar";
const PROGRESS_TICKS_SELECTOR = "[data-progress-ticks]";
const HUD_SELECTOR = ".hud";
const LEADER_OVERLAY_SELECTOR = "#leader-overlay";
const MAP_CLOCK_SELECTOR = "[data-map-clock]";
const CLOCK_HOUR_SELECTOR = "[data-clock-hour]";
const CLOCK_DATE_SELECTOR = "[data-clock-date]";
const NARRATIVE_ACTIVE_CLASS = "is-narrative-active";
const PEAK_HOUR = 13;  // Step 3 trough — clock gets accent-glow

export function initNarrative(selector, config) {
    const container = document.querySelector(selector);
    if (!container) {
        throw new Error(`initNarrative: no element matches ${selector}`);
    }

    const steps = Array.from(container.querySelectorAll(".step"));
    if (steps.length === 0) {
        console.warn("initNarrative: no .step elements found inside", selector);
        return { steps: [] };
    }

    const hud = document.querySelector(HUD_SELECTOR);
    const hudTimestamp = document.querySelector(HUD_PROGRESS_SELECTOR);
    const hudMeta = document.querySelector(HUD_META_SELECTOR);
    const progressBar = document.querySelector(PROGRESS_BAR_SELECTOR);
    const progressTicks = document.querySelector(PROGRESS_TICKS_SELECTOR);
    const leaderOverlay = document.querySelector(LEADER_OVERLAY_SELECTOR);
    const mapClock = document.querySelector(MAP_CLOCK_SELECTOR);
    const clockHour = document.querySelector(CLOCK_HOUR_SELECTOR);
    const clockDate = document.querySelector(CLOCK_DATE_SELECTOR);

    const leaderCtl = (leaderOverlay && config.map?.getCountryCentroidPx)
        ? createLeaderController(leaderOverlay, config.map)
        : null;

    if (config.showcase) {
        steps.forEach((step) => renderStepSparkline(step, config.showcase));
        // Step 2: DE gen-mix donut at hour 10, floated right of the sparkline.
        const step2 = container.querySelector('[data-step="2"]');
        if (step2) {
            renderGenDonut(step2, config.showcase, "DE", 10);
        }
    }

    // Step 4 heatmap loads lazily — data may arrive post-init via injectCalendarHeatmap.
    const heatmapContainer = container.querySelector('[data-step-chart="heatmap"]');
    function injectCalendarHeatmap(calendarData) {
        if (!heatmapContainer || !calendarData?.days?.length) return;
        createCalendarHeatmap(heatmapContainer, {
            data: calendarData,
            countries: [
                { code: "DE", label: "Germany — 846 negative hours" },
                { code: "CH", label: "Switzerland — 529 negative hours" },
            ],
        });
    }
    if (config.calendarData) {
        injectCalendarHeatmap(config.calendarData);
    }

    // Step 5 gen-stack; reveal fires on step-enter so it sweeps open with the card.
    let genStackCtl = null;
    if (config.showcase) {
        const genContainer = container.querySelector('[data-step-chart="genstack"]');
        if (genContainer) {
            const deSeries = config.showcase.countries?.DE;
            if (deSeries) {
                genStackCtl = createGenerationStack(genContainer, {
                    series: deSeries,
                    country: "DE",
                    label: "Germany — 12 May 2024",
                });
            }
        }
    }

    // Step 6 duck curve — DE monthly profile morphs over an annual-average ghost.
    let duckCtl = null;
    if (config.profilesData?.countries?.DE) {
        const duckContainer = container.querySelector('[data-step-chart="duck"]');
        if (duckContainer) {
            duckCtl = createDailyProfile(duckContainer, {
                profiles: config.profilesData.countries.DE,
                country: "DE",
                label: "Germany — monthly price profile",
                width: 460,
                height: 280,
            });
        }
    }

    // Step 7 small multiples — annual-average profile per country.
    if (config.profilesData?.countries) {
        const multiContainer = container.querySelector('[data-step-chart="multiples"]');
        if (multiContainer) {
            const multiWrap = document.createElement("div");
            multiWrap.className = "small-multiples";
            for (const [code, lbl] of [
                ["DE", "Germany"], ["FR", "France"], ["CH", "Switzerland"],
                ["AT", "Austria"], ["IT", "Italy"],
            ]) {
                const profiles = config.profilesData.countries[code];
                if (profiles) {
                    createDailyProfile(multiWrap, {
                        profiles,
                        country: code,
                        label: lbl,
                        compact: true,
                    });
                }
            }
            multiContainer.appendChild(multiWrap);
        }
    }

    // Chapter ticks positioned at the scroll fraction of each step's centre.
    if (progressTicks && steps.length > 1) {
        progressTicks.replaceChildren();
        const layoutTicks = () => {
            progressTicks.replaceChildren();
            const max = document.documentElement.scrollHeight - window.innerHeight;
            if (max <= 0) return;
            steps.forEach((step) => {
                const rect = step.getBoundingClientRect();
                const absoluteTop = window.scrollY + rect.top + rect.height / 2;
                const trigger = absoluteTop - window.innerHeight * ACTIVE_OFFSET;
                const pct = Math.min(100, Math.max(0, (trigger / max) * 100));
                const tick = document.createElement("span");
                tick.className = "scroll-progress__tick";
                tick.style.left = `${pct}%`;
                progressTicks.appendChild(tick);
            });
        };
        layoutTicks();
        window.addEventListener("resize", layoutTicks);
        document.fonts?.ready?.then(layoutTicks);
    }

    const scroller = scrollama();
    scroller
        .setup({
            step: steps,
            offset: ACTIVE_OFFSET,
            progress: false,
        })
        .onStepEnter(({ element, index }) => {
            steps.forEach((s) => s.classList.toggle("is-active", s === element));

            // Body class gates the map's desaturation filter in CSS.
            document.body.classList.add(NARRATIVE_ACTIVE_CLASS);

            if (hud && hud.classList.contains("is-visible") === false) {
                hud.classList.add("is-visible");
            }
            if (hudTimestamp) {
                hudTimestamp.textContent = element.dataset.timestamp || "—";
            }
            if (hudMeta) {
                hudMeta.textContent = element.dataset.meta || "";
            }

            if (mapClock) {
                mapClock.classList.add("is-visible");
                const hour = Number(element.dataset.hour);
                const isPeak = hour === PEAK_HOUR;
                mapClock.classList.toggle("is-peak", isPeak);
                if (clockHour && Number.isFinite(hour)) {
                    // Force reflow to re-fire the CSS keyframe on every change.
                    clockHour.textContent = String(hour).padStart(2, "0");
                    clockHour.style.animation = "none";
                    void clockHour.offsetWidth;
                    clockHour.style.animation = "";
                }
                if (clockDate && element.dataset.timestamp) {
                    // "2024-05-12 13:00 CET" → date portion only.
                    const datePart = element.dataset.timestamp.split(" ")[0];
                    if (datePart) {
                        clockDate.textContent = datePart.replace(/-/g, " · ");
                    }
                }
            }

            if (leaderCtl) {
                leaderCtl.show(element);
            }

            if (config.map && typeof config.map.update === "function") {
                const hour = Number(element.dataset.hour);
                const focusCountry = element.dataset.country || null;
                const highlightRaw = element.dataset.highlight || "";
                const highlightCountries = highlightRaw
                    ? highlightRaw.split(",").map((s) => s.trim())
                    : [];
                config.map.update({
                    hour: Number.isFinite(hour) ? hour : null,
                    focusCountry,
                    highlightCountries,
                });
            }

            if (element.dataset.step === "5" && genStackCtl) {
                genStackCtl.reveal();
            }

            if (element.dataset.step === "6" && duckCtl) {
                const months = Object.keys(
                    config.profilesData?.countries?.DE?.monthly || {},
                );
                duckCtl.animateMonths(months, 500);
            }
        })
        .onStepExit(({ element, direction }) => {
            // Fast scrolls can desync enter/exit — clear here too so two cards
            // never stay active at once.
            element.classList.remove("is-active");

            // Prevent setInterval leak when reader scrolls past step 6.
            if (element.dataset.step === "6" && duckCtl) {
                duckCtl.stopAnimation();
            }

            // Scrolled up past step 1: full chrome cleanup.
            if (direction === "up" && element === steps[0]) {
                document.body.classList.remove(NARRATIVE_ACTIVE_CLASS);
                if (hud) hud.classList.remove("is-visible");
                if (mapClock) {
                    mapClock.classList.remove("is-visible");
                    mapClock.classList.remove("is-peak");
                }
                if (leaderCtl) leaderCtl.hide();
                if (config.map && typeof config.map.update === "function") {
                    config.map.update({
                        hour: null,
                        focusCountry: null,
                        highlightCountries: [],
                    });
                }
            }

            // Scrolled down past final step: drop desaturation so the explorer
            // below gets a vivid map; clock stays for continuity.
            if (direction === "down" && element === steps[steps.length - 1]) {
                document.body.classList.remove(NARRATIVE_ACTIVE_CLASS);
                if (leaderCtl) leaderCtl.hide();
            }
        });

    // IntersectionObserver only evaluates final scroll state, so jumping from
    // deep in the page straight to y=0 skips step 1's threshold and leaves
    // HUD/clock stuck over the hero. Force cleanup when we land at the top
    // with chrome still visible; the is-visible guard avoids redundant work.
    const checkScrollReset = () => {
        if (window.scrollY > 120) return;
        if (!hud?.classList.contains("is-visible")) return;
        steps.forEach((s) => s.classList.remove("is-active"));
        document.body.classList.remove(NARRATIVE_ACTIVE_CLASS);
        hud.classList.remove("is-visible");
        if (mapClock) {
            mapClock.classList.remove("is-visible");
            mapClock.classList.remove("is-peak");
        }
        if (leaderCtl) leaderCtl.hide();
        if (config.map && typeof config.map.update === "function") {
            config.map.update({ hour: null, focusCountry: null, highlightCountries: [] });
        }
    };
    window.addEventListener("scroll", checkScrollReset, { passive: true });

    // Global scroll progress bar.
    if (progressBar) {
        const updateProgress = () => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            if (max <= 0) return;
            const pct = Math.min(100, Math.max(0, (window.scrollY / max) * 100));
            progressBar.style.width = `${pct}%`;
        };
        updateProgress();
        window.addEventListener("scroll", updateProgress, { passive: true });
    }

    // Scrollama recomputes offsets on resize / font-load; leader geometry
    // depends on viewport too.
    const onResize = () => {
        scroller.resize();
        if (leaderCtl) leaderCtl.redraw();
    };
    window.addEventListener("resize", onResize);
    document.fonts?.ready?.then(() => {
        scroller.resize();
        if (leaderCtl) leaderCtl.redraw();
    });

    // Cards translate during scroll, so the leader's origin moves every frame.
    if (leaderCtl) {
        let leaderTicking = false;
        window.addEventListener("scroll", () => {
            if (leaderTicking) return;
            leaderTicking = true;
            requestAnimationFrame(() => {
                leaderCtl.redraw();
                leaderTicking = false;
            });
        }, { passive: true });
    }

    return {
        steps,
        scroller,
        injectCalendarHeatmap,
    };
}


// Leader line from the active card to its target country. Three control points
// (start, elbow, dest) are each a critical-damped spring integrated every
// frame, so the line chases its target smoothly instead of snapping. The
// target dot shares the same springs to stay in phase with the line.
function createLeaderController(svgEl, mapCtl) {
    const NS = "http://www.w3.org/2000/svg";
    const line = document.createElementNS(NS, "path");
    line.setAttribute("class", "leader-line");
    const dotEl = document.createElementNS(NS, "circle");
    dotEl.setAttribute("class", "leader-target");
    dotEl.setAttribute("r", "3");
    const pulseEl = document.createElementNS(NS, "circle");
    pulseEl.setAttribute("class", "leader-target-pulse");
    pulseEl.setAttribute("r", "4");

    svgEl.append(line, pulseEl, dotEl);

    // 170/24 ≈ iOS system spring: ~500ms settle, zero overshoot.
    const SPRING_STIFFNESS = 170;
    const SPRING_DAMPING = 24;
    const SPRING_EPSILON = 0.03;   // stop condition in pixels
    const MAX_DT = 1 / 30;         // clamp to 30fps so stalls don't explode

    const springs = {
        startX: { current: 0, target: 0, velocity: 0 },
        startY: { current: 0, target: 0, velocity: 0 },
        elbowX: { current: 0, target: 0, velocity: 0 },
        elbowY: { current: 0, target: 0, velocity: 0 },
        destX:  { current: 0, target: 0, velocity: 0 },
        destY:  { current: 0, target: 0, velocity: 0 },
    };

    let activeStep = null;
    let visible = false;
    let rafHandle = null;
    let lastFrameTime = null;

    // Writes spring targets only — `current` keeps its position so the line
    // animates from wherever it actually is.
    function computeTargets() {
        if (!activeStep) return false;
        const iso = activeStep.dataset.country;
        if (!iso) return false;
        const dest = mapCtl.getCountryCentroidPx(iso);
        if (!dest) return false;

        const cardRect = activeStep.getBoundingClientRect();
        const vh = window.innerHeight;
        // Card off-viewport: skip target update so the leader fades rather
        // than stretching to chase a card 2000px away.
        if (cardRect.bottom < -30 || cardRect.top > vh + 30) {
            return false;
        }

        // Anchor to the headline so startY survives vertical card clipping.
        const headline = activeStep.querySelector(".step__headline");
        const headlineRect = headline
            ? headline.getBoundingClientRect()
            : null;
        const yAnchor = headlineRect
            ? headlineRect.top + headlineRect.height / 2
            : cardRect.top + cardRect.height * 0.4;
        const startX = cardRect.right + 8;
        const startY = yAnchor;

        // Horizontal stub off the card; the diagonal second segment carries
        // the vertical drop.
        const stubLen = Math.min(48, Math.max(16, (dest.x - startX) * 0.18));
        const elbowX = startX + stubLen;
        const elbowY = startY;

        springs.startX.target = startX;
        springs.startY.target = startY;
        springs.elbowX.target = elbowX;
        springs.elbowY.target = elbowY;
        springs.destX.target  = dest.x - 6; // 6px gap before the target dot
        springs.destY.target  = dest.y;
        return true;
    }

    function snapToTarget() {
        for (const k in springs) {
            springs[k].current = springs[k].target;
            springs[k].velocity = 0;
        }
    }

    function stepSprings(dt) {
        let moving = false;
        for (const k in springs) {
            const s = springs[k];
            const delta = s.target - s.current;
            // Semi-implicit Euler integration.
            const spring = delta * SPRING_STIFFNESS;
            const damper = s.velocity * SPRING_DAMPING;
            const accel = spring - damper;
            s.velocity += accel * dt;
            s.current += s.velocity * dt;
            if (Math.abs(delta) > SPRING_EPSILON || Math.abs(s.velocity) > SPRING_EPSILON) {
                moving = true;
            } else {
                s.current = s.target;
                s.velocity = 0;
            }
        }
        return moving;
    }

    function paint() {
        const sX = springs.startX.current;
        const sY = springs.startY.current;
        const eX = springs.elbowX.current;
        const eY = springs.elbowY.current;
        const dX = springs.destX.current;
        const dY = springs.destY.current;
        line.setAttribute("d", `M${sX},${sY} L${eX},${eY} L${dX},${dY}`);
        dotEl.setAttribute("cx", dX + 6);
        dotEl.setAttribute("cy", dY);
        pulseEl.setAttribute("cx", dX + 6);
        pulseEl.setAttribute("cy", dY);
    }

    let wasOffscreen = false;

    function tick(now) {
        rafHandle = null;
        if (!visible) return;

        const dt = lastFrameTime == null
            ? 1 / 60
            : Math.min(MAX_DT, (now - lastFrameTime) / 1000);
        lastFrameTime = now;

        // Targets may have moved via scroll; false means card is off-viewport
        // so we fade rather than stretching.
        const onscreen = computeTargets();
        if (onscreen !== !wasOffscreen) {
            wasOffscreen = !onscreen;
            line.classList.toggle("is-offscreen", wasOffscreen);
            dotEl.classList.toggle("is-offscreen", wasOffscreen);
            pulseEl.classList.toggle("is-offscreen", wasOffscreen);
        }

        const moving = stepSprings(dt);
        paint();

        // Keep ticking while visible — scroll can shift targets even after the
        // spring settles. Near-zero cost when nothing moves.
        if (visible) {
            rafHandle = requestAnimationFrame(tick);
        }
    }

    function startLoop() {
        if (rafHandle != null) return;
        lastFrameTime = null;
        rafHandle = requestAnimationFrame(tick);
    }

    function stopLoop() {
        if (rafHandle != null) {
            cancelAnimationFrame(rafHandle);
            rafHandle = null;
        }
    }

    const prefersReducedMotion =
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function show(stepEl) {
        const firstShow = activeStep == null;
        activeStep = stepEl;

        visible = true;
        line.classList.add("is-visible");
        dotEl.classList.add("is-visible");
        pulseEl.classList.add("is-pulsing");

        const gotTargets = computeTargets();

        // Reduced-motion: snap directly, no spring, no rAF.
        if (prefersReducedMotion || (firstShow && gotTargets)) {
            snapToTarget();
        }

        paint();
        if (!prefersReducedMotion) startLoop();
    }

    function hide() {
        activeStep = null;
        visible = false;
        wasOffscreen = false;
        line.classList.remove("is-visible", "is-offscreen");
        dotEl.classList.remove("is-visible", "is-offscreen");
        pulseEl.classList.remove("is-pulsing", "is-offscreen");
        stopLoop();
    }

    // External poke — the loop picks up new targets next frame; if idle, kick it.
    function redraw() {
        if (!visible) return;
        if (rafHandle == null) startLoop();
    }

    return { show, hide, redraw };
}


function renderStepSparkline(stepEl, showcase) {
    const target = stepEl.querySelector("[data-step-chart]");
    if (!target) return;
    // Typed containers (heatmap, genstack) have their own renderer — skip
    // so we don't bury a stray sparkline under the real chart.
    const chartType = target.getAttribute("data-step-chart");
    if (chartType && chartType !== "true" && chartType !== "") return;

    const country = stepEl.dataset.country || "CH";
    const focusHour = Number(stepEl.dataset.hour ?? 0);
    const series = showcase?.countries?.[country];
    if (!series || !Array.isArray(series) || series.length === 0) return;

    const width = 384;
    const height = 48;
    const padding = { top: 6, right: 6, bottom: 14, left: 6 };

    const x = d3.scaleLinear().domain([0, 23]).range([padding.left, width - padding.right]);
    const yExtent = d3.extent(series, (d) => d.price);
    // Pad so extremes don't graze the edges.
    const yPad = Math.max(10, (yExtent[1] - yExtent[0]) * 0.08);
    const y = d3
        .scaleLinear()
        .domain([yExtent[0] - yPad, Math.max(yExtent[1] + yPad, 0)])
        .range([height - padding.bottom, padding.top]);

    const svg = d3
        .select(target)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "none")
        .attr("class", "spark");

    // Dashed zero reference when prices go negative.
    if (y.domain()[0] < 0) {
        svg.append("line")
            .attr("class", "spark__zero")
            .attr("x1", padding.left)
            .attr("x2", width - padding.right)
            .attr("y1", y(0))
            .attr("y2", y(0));
    }

    const areaGen = d3
        .area()
        .x((d) => x(d.hour))
        .y0(() => y(Math.max(y.domain()[0], Math.min(0, y.domain()[1]))))
        .y1((d) => y(d.price))
        .curve(d3.curveMonotoneX);

    svg.append("path")
        .datum(series)
        .attr("class", "spark__area")
        .attr("d", areaGen);

    const lineGen = d3
        .line()
        .x((d) => x(d.hour))
        .y((d) => y(d.price))
        .curve(d3.curveMonotoneX);

    svg.append("path")
        .datum(series)
        .attr("class", "spark__line")
        .attr("d", lineGen);

    const focusPoint = series[focusHour];
    if (focusPoint) {
        const fx = x(focusPoint.hour);
        const fy = y(focusPoint.price);
        svg.append("line")
            .attr("class", "spark__indicator")
            .attr("x1", fx).attr("x2", fx)
            .attr("y1", fy).attr("y2", height - padding.bottom);
        svg.append("circle")
            .attr("class", "spark__dot")
            .attr("cx", fx).attr("cy", fy).attr("r", 3.5);
    }

    svg.append("text")
        .attr("class", "spark__anchor")
        .attr("x", padding.left).attr("y", height - 2)
        .attr("text-anchor", "start")
        .text("00");
    svg.append("text")
        .attr("class", "spark__anchor")
        .attr("x", width - padding.right).attr("y", height - 2)
        .attr("text-anchor", "end")
        .text("23");
    svg.append("text")
        .attr("class", "spark__country")
        .attr("x", padding.left)
        .attr("y", padding.top + 7)
        .attr("text-anchor", "start")
        .text(country);
}


function renderGenDonut(stepEl, showcase, country, hour) {
    const target = stepEl.querySelector("[data-step-chart]");
    if (!target) return;
    const entry = showcase?.countries?.[country]?.[hour];
    if (!entry) return;

    const SOURCES = [
        { key: "solar", label: "Solar", color: "#fbbf24" },
        { key: "wind", label: "Wind", color: "#10b981" },
        { key: "hydro", label: "Hydro", color: "#6366f1" },
        { key: "nuclear", label: "Nuclear", color: "#a855f7" },
        { key: "gas", label: "Gas", color: "#fb7185" },
    ];

    const slices = SOURCES
        .map((s) => ({ ...s, value: entry[s.key] || 0 }))
        .filter((s) => s.value > 0);

    const total = slices.reduce((sum, s) => sum + s.value, 0);
    if (total === 0) return;

    const size = 64;
    const outerR = size / 2 - 2;
    const innerR = outerR * 0.55;

    const wrapper = document.createElement("div");
    wrapper.className = "gen-donut";
    wrapper.style.cssText = "display:inline-block;float:right;margin-left:12px;";

    const svg = d3.select(wrapper)
        .append("svg")
        .attr("viewBox", `0 0 ${size} ${size}`)
        .attr("width", size)
        .attr("height", size);

    const g = svg.append("g")
        .attr("transform", `translate(${size / 2},${size / 2})`);

    const arc = d3.arc().innerRadius(innerR).outerRadius(outerR);
    const pie = d3.pie().value((d) => d.value).sort(null).padAngle(0.03);

    g.selectAll("path")
        .data(pie(slices))
        .join("path")
        .attr("d", arc)
        .attr("fill", (d) => d.data.color)
        .attr("fill-opacity", 0.85);

    // Centre label shows the dominant source percentage.
    const dominant = slices.reduce((a, b) => (a.value > b.value ? a : b));
    const pct = Math.round((dominant.value / total) * 100);
    g.append("text")
        .attr("class", "gen-donut__label")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .text(`${pct}%`);

    target.insertBefore(wrapper, target.firstChild);
}
