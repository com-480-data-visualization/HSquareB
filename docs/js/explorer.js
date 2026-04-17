// Timeline scrubber bound to the map, plus play/pause, keyboard scrubbing,
// and a country sidebar.

import { createGenerationStack } from "./charts/generation_stack.js";
import { createDailyProfile } from "./charts/daily_profile.js";

const HOURS = 24;
const FOCUS_COUNTRY = "CH";   // default sidebar subject — the protagonist
const MS_PER_HOUR_BASE = 760; // 1x playback ≈ 18s for the full day
const VISIBILITY_THRESHOLD = 0.15; // intersection ratio at which explorer "activates"
const INITIAL_HOUR = 0;       // start at midnight so reader scrubs from a calm baseline

// Brief scroll lock when the explorer enters view, to pull attention to the
// timeline. Auto-releases after the duration, or immediately on any timeline
// interaction. Skipped on touch — wheel is never used to drive the scrubber.
const SCROLL_PAUSE_DELAY_MS = 600;
const SCROLL_PAUSE_DURATION_MS = 2000;
const IS_TOUCH = window.matchMedia("(pointer: coarse)").matches;

const SELECTORS = {
    section: "#explorer",
    timelineWrap: ".explorer__timeline-wrap",
    timeline: "[data-timeline]",
    play: "[data-timeline-play]",
    track: "[data-timeline-track]",
    ticks: "[data-timeline-ticks]",
    hoursLabel: "[data-timeline-hours]",
    fill: "[data-timeline-fill]",
    handle: "[data-timeline-handle]",
    readout: "[data-timeline-hour]",
};

export function initExplorer(config) {
    const section = document.querySelector(SELECTORS.section);
    if (!section) return null;

    const { showcase } = config;
    const timelineWrap = document.querySelector(SELECTORS.timelineWrap);
    const timeline = section.querySelector(SELECTORS.timeline);
    const playBtn = section.querySelector(SELECTORS.play);
    const track = section.querySelector(SELECTORS.track);
    const ticks = section.querySelector(SELECTORS.ticks);
    const hoursLabel = section.querySelector(SELECTORS.hoursLabel);
    const fill = section.querySelector(SELECTORS.fill);
    const handle = section.querySelector(SELECTORS.handle);
    const readout = section.querySelector(SELECTORS.readout);
    if (!timeline || !track || !fill || !handle || !readout) return null;

    // 24 hourly ticks, major every 6 hours, plus labels at 00/06/12/18/24.
    for (let h = 0; h <= HOURS; h++) {
        const tick = document.createElement("span");
        tick.className = "timeline__tick";
        if (h % 6 === 0) tick.classList.add("timeline__tick--major");
        tick.style.left = `${(h / HOURS) * 100}%`;
        ticks.appendChild(tick);
    }
    if (hoursLabel) {
        ["00", "06", "12", "18", "24"].forEach((label) => {
            const el = document.createElement("span");
            el.className = "timeline__hour-label";
            el.textContent = label;
            hoursLabel.appendChild(el);
        });
    }

    const state = {
        hour: INITIAL_HOUR,
        hourFloat: INITIAL_HOUR,
        playing: false,
        rafId: null,
        lastFrameTs: null,
        active: false,
        started: false,
        speedMultiplier: 1,
    };

    // Pulse-hint delay: lets the intro headline land before the chrome pings.
    const HINT_DELAY_MS = 1600;
    let hintTimer = null;

    // Visual-only: fill/handle/readout/aria. Skips the map so we don't spam
    // 800ms transitions on every pointermove — map updates only on hour flip.
    function renderUI() {
        const frac = state.hourFloat / (HOURS - 1);
        const pct = Math.max(0, Math.min(100, frac * 100));
        fill.style.width = `${pct}%`;
        handle.style.left = `${pct}%`;
        const intHour = Math.min(HOURS - 1, Math.floor(state.hourFloat + 1e-6));
        readout.textContent = `${String(intHour).padStart(2, "0")}:00`;
        track.setAttribute("aria-valuenow", String(intHour));
        track.setAttribute("aria-valuetext", `${String(intHour).padStart(2, "0")}:00 hours`);
    }

    function clearMap() {
        if (config.map?.update) {
            config.map.update({ hour: null, focusCountry: null });
        }
    }

    // Hoisted so pushMap can read it — the sidebar block assigns it later.
    let sidebarActiveCountry = null;

    function pushMap(hour) {
        if (config.map?.update) {
            const focus = sidebarActiveCountry || FOCUS_COUNTRY;
            config.map.update({ hour, focusCountry: focus });
        }
        if (sidebarActiveCountry) {
            updateSidebarStats(sidebarActiveCountry, hour);
        }
    }

    function markStarted() {
        if (state.started) return;
        state.started = true;
        timeline.classList.remove("is-waiting");
        if (section) section.classList.remove("is-waiting");
    }

    function setHour(h) {
        const clamped = Math.max(0, Math.min(HOURS - 1, Math.round(h)));
        state.hourFloat = clamped;
        markStarted();
        if (clamped !== state.hour) {
            state.hour = clamped;
            pushMap(clamped);
        } else {
            // Same hour: still push so the first interaction paints an empty map.
            pushMap(clamped);
        }
        renderUI();
    }

    function play() {
        if (state.playing) return;
        // Restart from midnight if we're at the end.
        if (state.hourFloat >= HOURS - 1) {
            state.hourFloat = 0;
            state.hour = 0;
            pushMap(0);
            renderUI();
        }
        state.playing = true;
        timeline.classList.add("is-playing");
        playBtn?.setAttribute("aria-label", "Pause timeline");
        if (!state.started) {
            markStarted();
            // First play always starts at hour 0 — cleaner than resuming mid-day.
            state.hourFloat = 0;
            state.hour = 0;
            pushMap(0);
            renderUI();
        }
        state.lastFrameTs = null;
        const tick = (ts) => {
            if (!state.playing) return;
            if (state.lastFrameTs == null) state.lastFrameTs = ts;
            const dt = Math.min(64, ts - state.lastFrameTs);
            state.lastFrameTs = ts;
            let next = state.hourFloat + (dt * state.speedMultiplier) / MS_PER_HOUR_BASE;
            if (next >= HOURS - 1) next = HOURS - 1;
            state.hourFloat = next;
            const intHour = Math.min(HOURS - 1, Math.floor(next + 1e-6));
            if (intHour !== state.hour) {
                state.hour = intHour;
                pushMap(intHour);
            }
            renderUI();
            // Pause at the end rather than looping — the reader gets a definite
            // "day is over" beat instead of an infinite cycle.
            if (next >= HOURS - 1) {
                pause();
                return;
            }
            state.rafId = requestAnimationFrame(tick);
        };
        state.rafId = requestAnimationFrame(tick);
    }

    function pause() {
        if (!state.playing) return;
        state.playing = false;
        timeline.classList.remove("is-playing");
        playBtn?.setAttribute("aria-label", "Play timeline");
        if (state.rafId != null) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }
    }

    function togglePlay() {
        if (state.playing) pause(); else play();
    }

    // First-encounter handle pulse: the is-hinting class fires a CSS keyframe
    // three times to signal interactivity. is-touched kills it permanently on
    // any real interaction.
    let markTouched = () => {
        timeline.classList.add("is-touched");
        timeline.classList.remove("is-hinting");
        // Cancel pending hint so a late touch during the 1.6s delay doesn't
        // produce a stale pulse.
        if (hintTimer) {
            clearTimeout(hintTimer);
            hintTimer = null;
        }
    };

    playBtn?.addEventListener("click", () => {
        markTouched();
        togglePlay();
    });

    let dragging = false;
    const pointerToHour = (event) => {
        const rect = track.getBoundingClientRect();
        const raw = (event.clientX - rect.left) / rect.width;
        const clamped = Math.max(0, Math.min(1, raw));
        return Math.round(clamped * (HOURS - 1));
    };

    track.addEventListener("pointerdown", (e) => {
        dragging = true;
        track.setPointerCapture?.(e.pointerId);
        markTouched();
        pause();
        setHour(pointerToHour(e));
    });
    track.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        setHour(pointerToHour(e));
    });
    const endDrag = () => { dragging = false; };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
    track.addEventListener("pointerleave", endDrag);

    track.addEventListener("keydown", (e) => {
        // Any nudge counts as "touched" and silences the hint.
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", " ", "Enter"].includes(e.key)) {
            markTouched();
        }
        switch (e.key) {
            case "ArrowLeft":
            case "ArrowDown":
                e.preventDefault();
                pause();
                setHour(state.hour - 1);
                break;
            case "ArrowRight":
            case "ArrowUp":
                e.preventDefault();
                pause();
                setHour(state.hour + 1);
                break;
            case "Home":
                e.preventDefault();
                pause();
                setHour(0);
                break;
            case "End":
                e.preventDefault();
                pause();
                setHour(HOURS - 1);
                break;
            case " ":
            case "Enter":
                e.preventDefault();
                togglePlay();
                break;
        }
    });

    const modeBtns = section.querySelectorAll("[data-mode]");
    modeBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const mode = btn.dataset.mode || "price";
            modeBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
            if (config.map?.update) {
                config.map.update({ colorMode: mode });
                // Re-push current hour so the fill repaints under the new mode.
                pushMap(state.hour);
            }
        });
    });

    const speedBtns = section.querySelectorAll("[data-speed]");
    speedBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const multiplier = Number(btn.dataset.speed) || 1;
            state.speedMultiplier = multiplier;
            speedBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
        });
    });

    // Spacebar is only claimed while the explorer is in view so it doesn't
    // hijack page scroll on the hero/narrative.
    document.addEventListener("keydown", (e) => {
        if (e.key !== " " || !state.active) return;
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        markTouched();
        togglePlay();
    });

    // Tracks whether the explorer is visible enough to claim the spacebar,
    // and auto-pauses playback on scroll-away.
    const observer = new IntersectionObserver(
        ([entry]) => {
            const wasActive = state.active;
            state.active = entry.isIntersecting && entry.intersectionRatio >= VISIBILITY_THRESHOLD;

            if (state.active && !wasActive) {
                // First entry: paint hour 0 so the reader sees content
                // immediately instead of a blank map.
                if (!state.started) {
                    pushMap(0);
                    timeline.classList.add("is-waiting");
                    section.classList.add("is-waiting");
                }
            } else if (!state.active && wasActive) {
                pause();
            }
        },
        { threshold: [0, VISIBILITY_THRESHOLD, 0.5, 1] },
    );
    observer.observe(section);

    // Timeline dock is CSS-sticky (style.css), so this only (1) hides the map
    // clock + HUD inside the explorer, since the timeline readout owns the
    // hour, and (2) arms the first-encounter pulse hint.
    const mapClock = document.querySelector("[data-map-clock]");
    const hud = document.querySelector(".hud");
    let hintArmed = false;

    const updateChrome = () => {
        const sectionRect = section.getBoundingClientRect();
        const vh = window.innerHeight;
        // "Meaningfully inside" = top has crossed the upper third; by then the
        // intro is fully visible and the sticky timeline has docked.
        const inExplorer = sectionRect.top < vh * 0.55 && sectionRect.bottom > 0;
        if (mapClock) {
            mapClock.classList.toggle("is-hidden-by-explorer", inExplorer);
        }
        if (hud) {
            hud.classList.toggle("is-hidden-by-explorer", inExplorer);
        }

        // Arm the hint once on entry; delayed so the headline lands first.
        if (inExplorer && !hintArmed && !timeline.classList.contains("is-touched")) {
            hintArmed = true;
            hintTimer = setTimeout(() => {
                // Re-check: reader may have touched (e.g. spacebar) during the delay.
                if (!timeline.classList.contains("is-touched")) {
                    timeline.classList.add("is-hinting");
                }
            }, HINT_DELAY_MS);
        }
    };

    let chromeTicking = false;
    const scheduleChrome = () => {
        if (chromeTicking) return;
        chromeTicking = true;
        requestAnimationFrame(() => {
            updateChrome();
            chromeTicking = false;
        });
    };
    updateChrome();
    window.addEventListener("scroll", scheduleChrome, { passive: true });
    window.addEventListener("resize", scheduleChrome);

    // Timeline fades in at the same beat as the headline, so they register as
    // one composition. Latched — never un-hides on scroll-back so the reader
    // doesn't see it blink.
    const headlineEl = section.querySelector(".explorer__headline");
    if (headlineEl && timelineWrap) {
        const fadeObserver = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    timelineWrap.classList.add("is-visible");
                    fadeObserver.disconnect();
                }
            },
            { threshold: 0.35 },
        );
        fadeObserver.observe(headlineEl);
    }

    // Fires once per page load. On scroll-back later, no re-lock.
    const scrollPause = { active: false, fired: false };

    if (!IS_TOUCH) {
        const onWheel = (e) => {
            if (!scrollPause.active) return;
            e.preventDefault();
        };
        document.addEventListener("wheel", onWheel, { passive: false });

        const releasePause = () => {
            scrollPause.active = false;
            section.classList.remove("is-scroll-locked");
            section.classList.add("is-scroll-released");
            document.removeEventListener("wheel", onWheel);
        };

        // Wrap markTouched so any timeline interaction releases the lock.
        const origMarkTouched = markTouched;
        markTouched = () => {
            origMarkTouched();
            if (scrollPause.active) releasePause();
        };

        // One-shot: lock when the explorer enters, then disconnect.
        const pauseObserver = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting || scrollPause.fired) return;
                scrollPause.fired = true;
                pauseObserver.disconnect();

                setTimeout(() => {
                    // Re-check: reader may have already interacted or scrolled away.
                    const rect = section.getBoundingClientRect();
                    if (rect.top > window.innerHeight * 0.7 || rect.bottom < 0) return;

                    scrollPause.active = true;
                    section.classList.add("is-scroll-locked");

                    setTimeout(() => {
                        if (scrollPause.active) releasePause();
                    }, SCROLL_PAUSE_DURATION_MS);
                }, SCROLL_PAUSE_DELAY_MS);
            },
            { threshold: 0.3 },
        );
        pauseObserver.observe(section);
    }

    const sidebar = document.querySelector("[data-sidebar]");
    if (sidebar) {
        sidebar.setAttribute("role", "dialog");
        sidebar.setAttribute("aria-modal", "true");
        sidebar.setAttribute("aria-label", "Country details");
    }
    const sidebarClose = document.querySelector("[data-sidebar-close]");
    const sidebarCountry = document.querySelector("[data-sidebar-country]");
    const sidebarPrice = document.querySelector("[data-sidebar-price]");
    const sidebarRenewable = document.querySelector("[data-sidebar-renewable]");
    const sidebarSpread = document.querySelector("[data-sidebar-spread]");
    const sidebarGenContainer = document.querySelector("[data-sidebar-genstack]");
    const sidebarProfileContainer = document.querySelector("[data-sidebar-profile]");

    const COUNTRY_NAMES = {
        CH: "Switzerland", DE: "Germany", FR: "France",
        IT: "Italy", AT: "Austria",
    };

    let sidebarGenCtl = null;
    let sidebarProfileCtl = null;
    // sidebarActiveCountry is hoisted above pushMap.

    function updateSidebarStats(countryCode, hour) {
        if (!showcase?.countries) return;
        const entry = showcase.countries[countryCode]?.[hour];
        if (!entry) return;
        const sign = entry.price < 0 ? "\u2212" : "";
        const abs = Math.abs(entry.price).toFixed(1);
        if (sidebarPrice) sidebarPrice.textContent = `${sign}\u20AC${abs}`;
        if (sidebarRenewable) {
            sidebarRenewable.textContent = `${(entry.renewable_share * 100).toFixed(0)}%`;
        }
        if (sidebarSpread) {
            const itPrice = showcase.countries.IT?.[hour]?.price;
            if (itPrice != null) {
                const spread = Math.abs(entry.price - itPrice).toFixed(0);
                sidebarSpread.textContent = `\u20AC${spread}`;
            }
        }
    }

    function openSidebar(countryCode) {
        if (!sidebar || !showcase?.countries?.[countryCode]) return;
        sidebarActiveCountry = countryCode;
        if (sidebarCountry) sidebarCountry.textContent = COUNTRY_NAMES[countryCode] || countryCode;

        pushMap(state.hour);

        updateSidebarStats(countryCode, state.hour);

        if (sidebarGenCtl) { sidebarGenCtl.destroy(); sidebarGenCtl = null; }
        if (sidebarProfileCtl) { sidebarProfileCtl.destroy(); sidebarProfileCtl = null; }

        if (sidebarGenContainer) {
            while (sidebarGenContainer.firstChild) sidebarGenContainer.removeChild(sidebarGenContainer.firstChild);
            const series = showcase.countries[countryCode];
            if (series) {
                sidebarGenCtl = createGenerationStack(sidebarGenContainer, {
                    series,
                    country: countryCode,
                    label: `${COUNTRY_NAMES[countryCode] || countryCode} — 12 May 2024`,
                });
                sidebarGenCtl.reveal();
            }
        }

        if (sidebarProfileContainer && config.profilesData?.countries?.[countryCode]) {
            while (sidebarProfileContainer.firstChild) sidebarProfileContainer.removeChild(sidebarProfileContainer.firstChild);
            sidebarProfileCtl = createDailyProfile(sidebarProfileContainer, {
                profiles: config.profilesData.countries[countryCode],
                country: countryCode,
                label: `Daily price profile`,
            });
        }

        sidebar.classList.add("is-open");
        const mapClock = document.querySelector("[data-map-clock]");
        if (mapClock) mapClock.classList.add("is-hidden-by-sidebar");
        // Mobile: mark background inert so focus is trapped in the sidebar.
        if (window.innerWidth <= 900) {
            document.querySelectorAll(".scene__map, .scene__narrative, .explorer__intro, .explorer__timeline-wrap")
                .forEach((el) => el.setAttribute("inert", ""));
        }
        const closeBtn = sidebar.querySelector("[data-sidebar-close]");
        if (closeBtn) closeBtn.focus();
    }

    function closeSidebar() {
        if (!sidebar) return;
        sidebar.classList.remove("is-open");
        const mapClock = document.querySelector("[data-map-clock]");
        if (mapClock) mapClock.classList.remove("is-hidden-by-sidebar");
        document.querySelectorAll("[inert]").forEach((el) => el.removeAttribute("inert"));
        sidebarActiveCountry = null;
        // Back to the default protagonist.
        pushMap(state.hour);
    }

    // Paths are tabindex=0 + role=button (set in map.js) so Enter/Space mirror
    // the click toggle for keyboard users.
    if (sidebar) {
        document.querySelectorAll(".country").forEach((el) => {
            const toggle = () => {
                const iso = el.getAttribute("data-iso");
                if (!iso) return;
                if (sidebarActiveCountry === iso) {
                    closeSidebar();
                } else {
                    openSidebar(iso);
                }
            };
            el.addEventListener("click", toggle);
            el.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                }
            });
        });
        if (sidebarClose) {
            sidebarClose.addEventListener("click", closeSidebar);
        }
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && sidebar?.classList.contains("is-open")) {
                closeSidebar();
            }
        });
        document.addEventListener("click", (e) => {
            if (!sidebar?.classList.contains("is-open")) return;
            if (sidebar.contains(e.target) || e.target.closest(".country")) return;
            closeSidebar();
        });
    }

    // Paint initial UI only — map stays untouched until the reader interacts.
    renderUI();

    return {
        play,
        pause,
        togglePlay,
        setHour,
        openSidebar,
        closeSidebar,
    };
}
