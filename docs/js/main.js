import { createMap } from "./map.js";
import { initNarrative } from "./narrative.js";
import { initExplorer } from "./explorer.js";
import { loadJSON } from "./utils/data.js";

async function init() {
    // Calendar heatmap (182KB) is deferred so it doesn't block first paint.
    let topology, showcase, profilesData;
    try {
        [topology, showcase, profilesData] = await Promise.all([
            loadJSON("map.topojson"),
            loadJSON("showcase_day.json"),
            loadJSON("daily_profiles.json"),
        ]);
    } catch (err) {
        const loader = document.querySelector(".app-loading");
        if (loader) {
            const msg = loader.querySelector(".app-loading__text");
            if (msg) msg.textContent = "Failed to load data. Please refresh.";
            const dots = loader.querySelector(".app-loading__dots");
            if (dots) dots.remove();
        }
        return;
    }
    document.querySelector(".app-loading")?.remove();

    const map = createMap("#map-container", { topology, showcase });

    // Steps 1-3, 5-7 don't need the heatmap — inject it into Step 4 once loaded.
    const narrative = initNarrative("#narrative", { map, showcase, calendarData: null, profilesData });
    initExplorer({ map, showcase, profilesData });

    loadJSON("calendar_heatmap.json").then((calendarData) => {
        console.info("calendar_heatmap.json loaded:", calendarData && calendarData?.days ? `${calendarData.days.length} days` : calendarData ? 'no days key' : 'no payload');
        if (calendarData && narrative?.injectCalendarHeatmap) {
            try {
                narrative.injectCalendarHeatmap(calendarData);
            } catch (err) {
                console.error("injectCalendarHeatmap threw:", err);
            }
        }
    }).catch((err) => {
        console.warn("Failed to load calendar_heatmap.json:", err);
    });

    setupHeroTitleReveal();
    setupHeroColdOpen();
    setupHeroParallax();
    setupCursorLight();
    setupSpotTape(showcase);
    setupCircadianTint();
    setupMapTilt();
    setupIrisWipe();
    setupFooterHide();
    setupFooterReveal();
    setupHeartbeatScope();

    // Double-rAF lets the viewport settle before modules recompute.
    window.addEventListener("orientationchange", () => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            window.dispatchEvent(new Event("resize"));
        }));
    });

    console.info("HSquareB initialized");
}

// Scroll fallback guards against IntersectionObserver mis-firing on certain layouts.
function setupFooterReveal() {
    const footer = document.querySelector(".site-footer");
    if (!footer) return;

    const reveal = () => footer.classList.add("is-revealed");

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        reveal();
        return;
    }

    const observer = new IntersectionObserver(
        ([entry]) => {
            if (entry.isIntersecting) {
                reveal();
                observer.disconnect();
                window.removeEventListener("scroll", fallback);
            }
        },
        { threshold: 0, rootMargin: "0px 0px -120px 0px" },
    );
    observer.observe(footer);

    const fallback = () => {
        const top = footer.getBoundingClientRect().top;
        if (top < window.innerHeight + 200) {
            reveal();
            observer.disconnect();
            window.removeEventListener("scroll", fallback);
        }
    };
    window.addEventListener("scroll", fallback, { passive: true });
}

// Hides fixed-position readouts once the footer is in view so they don't overlap.
function setupFooterHide() {
    const footer = document.querySelector(".site-footer");
    if (!footer) return;
    const clock = document.querySelector("[data-map-clock]");
    const hud = document.querySelector(".hud");
    const observer = new IntersectionObserver(
        ([entry]) => {
            const fade = entry.isIntersecting;
            if (clock) clock.classList.toggle("is-hidden-by-footer", fade);
            if (hud) hud.classList.toggle("is-hidden-by-footer", fade);
        },
        { threshold: 0 },
    );
    observer.observe(footer);
}

// Pausing --beat off-hero avoids per-second style recalcs on every beat-reader.
function setupHeartbeatScope() {
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) => {
        document.documentElement.classList.toggle("is-beat-paused", !entry.isIntersecting);
    }, { threshold: 0 });
    observer.observe(hero);
}

// One-shot iris wipe at 25% scrolled — broadcast "on-air" cue as the story opens.
const IRIS_THRESHOLD = 0.25;
const IRIS_DURATION_MS = 700;

function setupIrisWipe() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let fired = false;
    const onScroll = () => {
        if (fired) return;
        const p = window.scrollY / window.innerHeight;
        if (p < IRIS_THRESHOLD) return;
        fired = true;
        document.body.classList.add("is-iris-firing");
        setTimeout(() => {
            document.body.classList.remove("is-iris-firing");
        }, IRIS_DURATION_MS);
        window.removeEventListener("scroll", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
}

// Scroll-driven tint on --atmos-tint: dawn → calm → solar → shock → exhale.
function setupCircadianTint() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const stops = [
        { at: 0.00, color: "rgba(14, 116, 144, 0.06)" },
        { at: 0.30, color: "rgba(71, 85, 105, 0.04)" },
        { at: 0.55, color: "rgba(251, 191, 36, 0.14)" },   // solar gold — screen blend makes this visible
        { at: 0.80, color: "rgba(34, 211, 238, 0.08)" },
        { at: 1.00, color: "rgba(224, 247, 255, 0.04)" },
    ];

    const parseRGBA = (s) => {
        const m = s.match(/rgba?\(([^)]+)\)/);
        if (!m) return [0, 0, 0, 0];
        return m[1].split(",").map(Number);
    };
    const lerp = (a, b, t) => a + (b - a) * t;
    const sample = (p) => {
        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i];
            const b = stops[i + 1];
            if (p >= a.at && p <= b.at) {
                const t = (p - a.at) / (b.at - a.at);
                const ca = parseRGBA(a.color);
                const cb = parseRGBA(b.color);
                const r = Math.round(lerp(ca[0], cb[0], t));
                const g = Math.round(lerp(ca[1], cb[1], t));
                const bl = Math.round(lerp(ca[2], cb[2], t));
                const al = (lerp(ca[3], cb[3], t)).toFixed(3);
                return `rgba(${r}, ${g}, ${bl}, ${al})`;
            }
        }
        return stops[stops.length - 1].color;
    };

    // scrollHeight triggers layout — cache and invalidate on resize only.
    let maxScroll = Math.max(0,
        document.documentElement.scrollHeight - window.innerHeight);
    let lastTintBucket = -1;
    const TINT_BUCKETS = 50;

    let ticking = false;
    const update = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const p = maxScroll > 0
                ? Math.min(1, Math.max(0, window.scrollY / maxScroll))
                : 0;
            // Quantize so near-identical scroll positions don't resample the gradient.
            const bucket = Math.round(p * TINT_BUCKETS);
            if (bucket !== lastTintBucket) {
                lastTintBucket = bucket;
                root.style.setProperty("--atmos-tint", sample(bucket / TINT_BUCKETS));
            }
            ticking = false;
        });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", () => {
        maxScroll = Math.max(0,
            document.documentElement.scrollHeight - window.innerHeight);
        lastTintBucket = -1;
        update();
    });
}

// Splits hero title lines into per-char spans so letters strike one at a time.
// Wrapping elements (<em>, .hero__amp) are preserved; whitespace stays as text
// so the browser handles line-breaking.
const TITLE_LINE_BASE_DELAYS_MS = [300, 550, 800];
const TITLE_CHAR_STAGGER_MS = 28;

function setupHeroTitleReveal() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lines = Array.from(document.querySelectorAll(".hero__title-line"));
    if (lines.length === 0) return;

    lines.forEach((line, lineIdx) => {
        const baseDelay = TITLE_LINE_BASE_DELAYS_MS[lineIdx] ?? 400;
        let charIdx = 0;

        const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                if (!text) return [];
                const frag = document.createDocumentFragment();
                for (const ch of text) {
                    if (ch === " " || ch === "\u00A0") {
                        frag.appendChild(document.createTextNode(ch));
                        continue;
                    }
                    const span = document.createElement("span");
                    span.className = "hero__title-char";
                    span.textContent = ch;
                    span.style.setProperty(
                        "--char-delay",
                        `${baseDelay + charIdx * TITLE_CHAR_STAGGER_MS}ms`,
                    );
                    charIdx += 1;
                    frag.appendChild(span);
                }
                node.parentNode.replaceChild(frag, node);
                return;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                // Clone childNodes since the walk mutates them.
                const children = Array.from(node.childNodes);
                for (const child of children) walk(child);
            }
        };

        walk(line);
        line.classList.add("is-split");
    });

    // Drop will-change after reveal so compositor layers don't persist all session.
    setTimeout(() => {
        document.querySelectorAll(".hero__title-char").forEach((el) => {
            el.style.willChange = "auto";
        });
    }, 3000);
}

// Hero cold-open — €45 baseline ticks down to the Sunday trough after the title lands.
const COLDOPEN_START_DELAY_MS = 1800;
const COLDOPEN_TWEEN_DELAY_MS = 350;
const COLDOPEN_TWEEN_DUR_MS = 1100;
const COLDOPEN_START_VALUE = 57.93; // CH midnight price on the showcase day
const COLDOPEN_END_VALUE = -145.12;

function setupHeroColdOpen() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = document.querySelector("[data-hero-coldopen]");
    if (!el) return;
    const valueEl = el.querySelector("[data-coldopen-value]");
    if (!valueEl) return;

    valueEl.textContent = formatColdOpenValue(COLDOPEN_START_VALUE);

    setTimeout(() => {
        // Force a synchronous reflow so opacity: 0 commits BEFORE the class
        // toggle pushes to opacity: 1. Without this, some browsers batch both
        // states into one paint and the CSS transition never fires.
        void el.offsetWidth;
        el.classList.add("is-showing");
    }, COLDOPEN_START_DELAY_MS);

    setTimeout(() => {
        const start = performance.now();
        const tick = (now) => {
            const t = Math.min(1, (now - start) / COLDOPEN_TWEEN_DUR_MS);
            // easeInOutCubic — accelerates through zero, decelerates onto the final value.
            const eased = t < 0.5
                ? 4 * t * t * t
                : 1 - Math.pow(-2 * t + 2, 3) / 2;
            const v = COLDOPEN_START_VALUE + (COLDOPEN_END_VALUE - COLDOPEN_START_VALUE) * eased;
            valueEl.textContent = formatColdOpenValue(v);
            if (v < 0 && !el.classList.contains("is-crashing")) {
                el.classList.add("is-crashing");
            }
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, COLDOPEN_START_DELAY_MS + COLDOPEN_TWEEN_DELAY_MS);

    // No fade-out — the final value persists so scrolling back to the top
    // still shows it, anchoring the hero.
}

function formatColdOpenValue(value) {
    const abs = Math.abs(value).toFixed(2);
    const sign = value < 0 ? "\u2212" : "";
    return `${sign}\u20AC${abs}`;
}

// Scroll-driven 3D tilt on the map SVG, peaking at Step 3. Writes --map-tilt
// once per frame; CSS multiplies by the max angle.
const MAP_TILT_MAX = 1;
const MAP_TILT_EXPLORER = 0.42;
// Quantize writes so near-identical values don't trigger a GPU re-composite.
const MAP_TILT_QUANTUM = 0.02;

function setupMapTilt() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const scene = document.querySelector(".scene");
    const peakCard = document.querySelector('.step[data-step="3"]');
    if (!scene) return;
    const root = document.documentElement;

    let ticking = false;
    let lastTilt = -1;
    const update = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const vh = window.innerHeight;
            const sceneRect = scene.getBoundingClientRect();

            // Keep tilt at 0 until the scene enters, so first reveal is flat.
            let tilt;
            if (sceneRect.top > vh * 0.65) {
                tilt = 0;
            } else {
                tilt = 0.2;
                if (peakCard) {
                    const peakRect = peakCard.getBoundingClientRect();
                    const peakCenter = peakRect.top + peakRect.height / 2;
                    const distFromMid = Math.abs(peakCenter - vh * 0.5);
                    // Wide 1.0×vh window spreads the ramp over more scroll
                    // distance so the ~11px displacement accumulates gradually.
                    const proximity = Math.max(0, 1 - distFromMid / (vh * 1.0));
                    tilt = Math.max(tilt, proximity * MAP_TILT_MAX);
                }
                if (sceneRect.bottom < vh * 0.9 && sceneRect.bottom > 0) {
                    tilt = Math.max(tilt, MAP_TILT_EXPLORER);
                }
            }

            const quantized = Math.round(tilt / MAP_TILT_QUANTUM) * MAP_TILT_QUANTUM;
            if (quantized !== lastTilt) {
                lastTilt = quantized;
                root.style.setProperty("--map-tilt", quantized.toFixed(2));
            }
            ticking = false;
        });
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
}

// Hero ticker — 4 hours preview the whole day: calm, dip, shock, recovery.
const TAPE_HOURS = [0, 10, 13, 19];
const TAPE_INTERVAL_MS = 5500;

function setupSpotTape(showcase) {
    const tape = document.querySelector("[data-hero-tape]");
    if (!tape || !showcase?.countries) return;

    const timestampEl = tape.querySelector("[data-tape-timestamp]");
    const priceEls = {
        CH: tape.querySelector('[data-tape-price="CH"]'),
        DE: tape.querySelector('[data-tape-price="DE"]'),
        FR: tape.querySelector('[data-tape-price="FR"]'),
        IT: tape.querySelector('[data-tape-price="IT"]'),
        AT: tape.querySelector('[data-tape-price="AT"]'),
    };

    const renderHour = (hour) => {
        const padded = String(hour).padStart(2, "0");
        if (timestampEl) {
            timestampEl.textContent = `${showcase.date} · ${padded}:00 CET`;
        }
        for (const [code, el] of Object.entries(priceEls)) {
            if (!el) continue;
            const entry = showcase.countries[code]?.[hour];
            if (!entry) continue;
            const price = entry.price;
            el.textContent = formatPrice(price);
            el.classList.toggle("is-negative", price < 0);
            el.classList.add("is-flash");
            setTimeout(() => el.classList.remove("is-flash"), 480);
        }
    };

    let idx = 0;
    renderHour(TAPE_HOURS[idx]);

    let tapeInterval = null;
    const startTape = () => {
        if (tapeInterval) return;
        tapeInterval = setInterval(() => {
            idx = (idx + 1) % TAPE_HOURS.length;
            renderHour(TAPE_HOURS[idx]);
        }, TAPE_INTERVAL_MS);
    };
    const stopTape = () => {
        if (tapeInterval) { clearInterval(tapeInterval); tapeInterval = null; }
    };
    startTape();

    const tapeObserver = new IntersectionObserver(([entry]) => {
        entry.isIntersecting ? startTape() : stopTape();
    }, { threshold: 0 });
    tapeObserver.observe(tape);
}

function formatPrice(value) {
    const abs = Math.abs(value).toFixed(0);
    const sign = value < 0 ? "\u2212" : "";
    return `${sign}${abs}`;
}

// Hero parallax — title lines drift at different rates; hero fully fades by
// half-viewport scrolled so the map reveals cleanly.
const HERO_REVEAL_DURATION_MS = 2400;

function setupHeroParallax() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const titleLines = Array.from(hero.querySelectorAll(".hero__title-line"));
    const eyebrow = hero.querySelector(".hero__eyebrow");
    const masthead = hero.querySelector(".hero__masthead");
    const lede = hero.querySelector(".hero__lede");
    const signature = hero.querySelector(".hero__signature");

    // Wait for the CSS reveal to finish — inline styles would fight the keyframes.
    let armed = false;
    const armTimer = setTimeout(() => { armed = true; onScroll(); }, HERO_REVEAL_DURATION_MS);

    let ticking = false;
    // 60 steps ≈ 1.5% — smooth enough for parallax, coarse enough to skip most scrolls.
    let lastProgressStep = -1;
    const onScroll = () => {
        if (!armed) return;
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const viewport = window.innerHeight;
            const progress = Math.min(1, Math.max(0, window.scrollY / (viewport * 0.85)));
            const step = Math.round(progress * 60);
            if (step === lastProgressStep) {
                ticking = false;
                return;
            }
            lastProgressStep = step;

            titleLines.forEach((line, i) => {
                const factor = 40 + i * 28;
                const fade = Math.max(0, 1 - progress * 1.4);
                line.style.transform = `translate3d(0, ${-progress * factor}px, 0)`;
                line.style.opacity = `${fade}`;
            });
            if (eyebrow) {
                eyebrow.style.transform = `translate3d(0, ${-progress * 80}px, 0)`;
                eyebrow.style.opacity = `${Math.max(0, 1 - progress * 1.8)}`;
            }
            if (masthead) {
                masthead.style.transform = `translate3d(0, ${-progress * 100}px, 0)`;
                masthead.style.opacity = `${Math.max(0, 1 - progress * 2)}`;
            }
            if (lede) {
                lede.style.transform = `translate3d(0, ${-progress * 22}px, 0)`;
                lede.style.opacity = `${Math.max(0, 1 - progress * 1.2)}`;
            }
            if (signature) {
                signature.style.transform = `translate3d(0, ${-progress * 14}px, 0)`;
                signature.style.opacity = `${Math.max(0, 1 - progress * 1.1)}`;
            }
            // Keep handler attached — scrolling back up must reverse the
            // transforms. Early detach left the hero invisible forever.
            ticking = false;
        });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { clearTimeout(armTimer); };
}

// Cursor-tracking radial gradient on the hero. Disabled on touch/reduced-motion.
function setupCursorLight() {
    const hero = document.querySelector(".hero");
    if (!hero) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    hero.classList.add("has-cursor-light");
    const update = (e) => {
        const rect = hero.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        hero.style.setProperty("--cursor-x", `${x}%`);
        hero.style.setProperty("--cursor-y", `${y}%`);
    };
    hero.addEventListener("pointermove", update);
}

// Suppress iOS long-press context menu on charts and map.
document.addEventListener("contextmenu", (e) => {
    if (e.target.closest("#map-container, .gen-stack, .daily-profile, .cal-heatmap")) {
        e.preventDefault();
    }
});

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
