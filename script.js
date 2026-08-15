/**
 * White Noise Generator
 * Audio Engine & UI Controller
 */

// --- Audio Context & Nodes ---
let audioCtx;
let sourceNode;
let filterNode; // Master sweepable lowpass
let masterVolumeNode; // Master volume control
let swellGainNode; // Slow LFO amplitude modulation ("ocean swell")
let swellDepthNode; // LFO depth control feeding swellGainNode.gain
let fadeGainNode; // Persistent output fade (click-free start/stop/swap)
let eqNodes = []; // Array of 16 BiquadFilters
const eqBands = [20, 31, 50, 80, 125, 200, 315, 500, 800, 1200, 2000, 3150, 5000, 8000, 12500, 20000];

// Advanced routing nodes for stereo width
let splitter;
let merger;
let midGain;
let sideGain;

let isPlaying = false;
let currentWidth = 1.0;
let currentNoiseType = 'white'; // white | pink | brown | blue | violet | grey

// Audio Buffers (generated or fetched lazily per type on first use)
let buffers = {
    white: null,
    pink: null,
    brown: null,
    blue: null,
    violet: null,
    grey: null,
    ocean: null,
    storm: null
};

// Field-recording sample types (fetched + decoded rather than generated).
// Credits: ocean — "Oceanwavescrushing" by Luftrum (CC BY 3.0, Wikimedia
// Commons); storm — "Rain and thunder (1)" by ezwa (public domain).
const SAMPLE_URLS = {
    ocean: 'samples/ocean.ogg',
    storm: 'samples/storm.ogg'
};

// Per-type loop end (seconds) for sample buffers — the crossfaded tail region
// is excluded from the loop, so playback wraps into the blended head
const sampleLoopEnd = {};

// --- DOM Elements ---
const playBtn = document.getElementById('play-btn');
const playText = document.getElementById('play-text');
const pauseText = document.getElementById('pause-text');
const statusText = document.getElementById('status-text');
const statusIndicator = document.querySelector('.status-indicator');

const freqSlider = document.getElementById('freq-slider');
const freqDisplay = document.getElementById('freq-display');

const widthRadios = document.querySelectorAll('input[name="width"]');
const typeRadios = document.querySelectorAll('input[name="noise-type"]');
const sleepRadios = document.querySelectorAll('input[name="sleep"]');
const sleepDisplay = document.getElementById('sleep-display');
const swellToggle = document.getElementById('swell-toggle');
const presetBtns = document.querySelectorAll('.preset-btn');

const eqBoard = document.getElementById('eq-board');
const eqResetBtn = document.getElementById('eq-reset-btn');

const volSlider = document.getElementById('vol-slider');
const volDisplay = document.getElementById('vol-display');

const canvas = document.getElementById('starfield');
const ctx = canvas.getContext('2d');

// --- Math & Mappings ---
const MIN_FREQ = 60;
const MAX_FREQ = 8000;

function calculateFrequency(linearValue) {
    const minLog = Math.log(MIN_FREQ);
    const maxLog = Math.log(MAX_FREQ);
    const scale = (maxLog - minLog) / 100;
    return Math.exp(minLog + scale * linearValue);
}

// --- Starfield Animation ---
let stars = [];
const numStars = 800;
let fov = 300; // Field of View

function initStarfield() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    for (let i = 0; i < numStars; i++) {
        stars.push(createStar());
    }

    requestAnimationFrame(renderStarfield);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// Mint, ice blue, off-white, and white — stored as "r, g, b" so the render
// loop can build rgba() styles without re-deriving them every frame.
const starColors = ['143, 211, 199', '170, 200, 228', '230, 237, 245', '255, 255, 255'];

function createStar() {
    return {
        x: (Math.random() - 0.5) * canvas.width * 2,
        y: (Math.random() - 0.5) * canvas.height * 2,
        z: Math.random() * canvas.width,
        pz: 0,
        rgb: starColors[Math.floor(Math.random() * starColors.length)]
    };
}

function renderStarfield() {
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = 'rgba(7, 9, 13, 0.45)'; // Trail effect
    ctx.fillRect(0, 0, w, h);

    const speed = 2; // Constant drift, independent of playback state
    const centerX = w / 2;
    const centerY = h / 2;

    for (let i = 0; i < stars.length; i++) {
        let star = stars[i];

        star.pz = star.z;
        star.z -= speed;

        if (star.z < 1) {
            star.z = w;
            star.x = (Math.random() - 0.5) * w * 2;
            star.y = (Math.random() - 0.5) * h * 2;
            star.pz = star.z;
        }

        // 3D to 2D projection
        let sx = (star.x / star.z) * fov + centerX;
        let sy = (star.y / star.z) * fov + centerY;
        let px = (star.x / star.pz) * fov + centerX;
        let py = (star.y / star.pz) * fov + centerY;

        // Draw star ray
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);

        // Closer stars are brighter and thicker
        const brightness = Math.max(0.1, 1 - (star.z / w));

        ctx.strokeStyle = `rgba(${star.rgb}, ${brightness})`;
        ctx.lineWidth = brightness * 3;
        ctx.stroke();
    }

    requestAnimationFrame(renderStarfield);
}

initStarfield();

// --- Settings Persistence ---
const STORAGE_KEY = 'dt-noise-gen-settings';

function collectSettings() {
    return {
        type: currentNoiseType,
        width: currentWidth,
        vol: parseInt(volSlider.value, 10),
        freq: parseInt(freqSlider.value, 10),
        eq: Array.from(eqBoard.querySelectorAll('.eq-slider'), s => parseFloat(s.value)),
        swell: swellToggle.checked
    };
}

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(collectSettings()));
    } catch (e) { /* private browsing / storage full — persistence is best-effort */ }
}

// Applies a settings object to the UI, pushes it to the audio graph, and saves.
// Also used by presets.
function applySettings(s) {
    if (s.type) typeRadios.forEach(r => { r.checked = (r.value === s.type); });
    if (s.width != null) widthRadios.forEach(r => { r.checked = (parseFloat(r.value) === s.width); });
    if (s.vol != null) volSlider.value = s.vol;
    if (s.freq != null) freqSlider.value = s.freq;
    if (Array.isArray(s.eq)) {
        eqBoard.querySelectorAll('.eq-slider').forEach((slider, index) => {
            const v = s.eq[index] ?? 0;
            slider.value = v;
            setEqBand(index, v);
        });
    }
    if (s.swell != null) swellToggle.checked = s.swell;

    updateVolume();
    updateFrequency();
    updateStereoWidth();
    updateSwell();
    updateNoiseType(); // restarts playback only if the type actually changed
    saveSettings();
}

function loadSettings() {
    let s = null;
    try {
        s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) { /* corrupt entry — fall back to defaults */ }
    if (s && typeof s === 'object') applySettings(s);
}

// --- Presets ---
const FLAT_EQ = new Array(eqBands.length).fill(0);

const PRESETS = {
    // freq is the slider position (0-100 on the 60 Hz – 8 kHz log scale)
    sleep: { type: 'brown', width: 0.5, vol: 40, freq: 19, eq: FLAT_EQ, swell: true },   // ~150 Hz cutoff
    focus: { type: 'pink',  width: 1.0, vol: 55, freq: 72, eq: FLAT_EQ, swell: false },  // ~2 kHz cutoff
    // Pink noise keeps the high-frequency "patter" that reads as rainfall;
    // the low-mid bump adds body, the ~1.2 kHz cutoff tames the hiss
    rain:  { type: 'pink',  width: 1.5, vol: 60, freq: 61, eq: [0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0], swell: false }
};

presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        applySettings(PRESETS[btn.dataset.preset]);
        // A preset is a request to hear something — start playback if stopped
        if (!isPlaying) setPlaying(true);
    });
});

// --- UI Builders ---
function formatEqLabel(freq) {
    if (freq >= 1000) return (freq / 1000).toFixed(1).replace('.0', '') + 'k';
    return freq.toString();
}

// Single path for pushing a band's gain to its EQ node
function setEqBand(index, value, timeConstant = 0.05) {
    if (eqNodes[index] && audioCtx) {
        eqNodes[index].gain.setTargetAtTime(value, audioCtx.currentTime, timeConstant);
    }
}

function buildEqUI() {
    eqBoard.innerHTML = '';
    eqBands.forEach((freq, index) => {
        const bandDiv = document.createElement('div');
        bandDiv.className = 'eq-band';

        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'eq-slider-container';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'eq-slider';
        slider.min = '-15';
        slider.max = '15';
        slider.value = '0';
        slider.step = '1';
        slider.addEventListener('input', (e) => {
            setEqBand(index, parseFloat(e.target.value));
            saveSettings();
        });

        const label = document.createElement('span');
        label.className = 'eq-label';
        label.textContent = formatEqLabel(freq);

        sliderContainer.appendChild(slider);
        bandDiv.appendChild(sliderContainer);
        bandDiv.appendChild(label);

        eqBoard.appendChild(bandDiv);
    });
}

// Build UI immediately
buildEqUI();

// Event listener for EQ Reset
eqResetBtn.addEventListener('click', () => {
    const uiSliders = eqBoard.querySelectorAll('.eq-slider');
    uiSliders.forEach((slider, index) => {
        slider.value = '0';
        setEqBand(index, 0);
    });
    saveSettings();
});

// Event listener for Master Volume
function updateVolume() {
    const val = volSlider.value;
    volDisplay.textContent = `${val}%`;

    // Convert 0-100 linear slider to 0.0-1.0 gain
    const gainValue = val / 100;

    if (masterVolumeNode && audioCtx) {
        masterVolumeNode.gain.setTargetAtTime(gainValue, audioCtx.currentTime, 0.05);
    }
}

volSlider.addEventListener('input', () => {
    updateVolume();
    saveSettings();
});

// --- Audio Algorithms ---

// ~46 ms of extra generated signal crossfaded into the buffer head so that
// looping from the last sample back to sample 0 stays continuous (otherwise
// filter state resets at the seam produce an audible pop every 5 s).
const SEAM_FADE_SAMPLES = 2048;

function blendLoopSeam(out, extra) {
    const F = extra.length;
    for (let i = 0; i < F; i++) {
        const w = i / F;
        out[i] = extra[i] * (1 - w) + out[i] * w;
    }
}

// Returns a per-sample generator for a noise color. Each call to the returned
// function produces the next sample, carrying filter state across calls.
function createNoiseGenerator(type) {
    // Pink noise filter state (Paul Kellet's method)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    // Brown noise integrator state
    let lastOut = 0;
    // One-sample memories for differentiated colors
    let prevWhite = 0;
    let prevPink = 0;

    const pink = () => {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11; // gain compensation
        b6 = white * 0.115926;
        return v;
    };

    const brown = () => {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + (0.02 * white)) / 1.02;
        return lastOut * 3.5; // gain compensation
    };

    const violet = () => {
        // Differentiated white: +6 dB/oct
        const white = Math.random() * 2 - 1;
        const v = (white - prevWhite) * 0.5;
        prevWhite = white;
        return v;
    };

    switch (type) {
        case 'white':
            return () => Math.random() * 2 - 1;
        case 'pink':
            return pink;
        case 'brown':
            return brown;
        case 'violet':
            return violet;
        case 'blue':
            // Differentiated pink: pink's -3 dB/oct plus +6 dB/oct = +3 dB/oct
            return () => {
                const p = pink();
                const v = (p - prevPink) * 3.0; // gain compensation
                prevPink = p;
                return v;
            };
        case 'grey':
            // Psychoacoustic approximation: deep lows + bright highs, scooped
            // mids — perceived as roughly equal loudness across the spectrum
            return () => 0.55 * brown() + 0.45 * violet();
    }
}

// Field recordings are typically far quieter than full-scale generated noise,
// so boost them to a comparable loudness. RMS-targeted with a peak cap:
// quiet rain gets lifted until the loudest transient (a thunder clap)
// approaches full scale, never past it.
const SAMPLE_TARGET_RMS = 0.15;

function normalizeSampleBuffer(buffer) {
    let sumSquares = 0;
    let peak = 0;
    let count = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++) {
            const v = data[i];
            sumSquares += v * v;
            const a = Math.abs(v);
            if (a > peak) peak = a;
        }
        count += data.length;
    }
    const rms = Math.sqrt(sumSquares / count);
    if (!rms || !peak) return;

    const scale = Math.min(SAMPLE_TARGET_RMS / rms, 0.95 / peak);
    if (scale <= 1) return; // already loud enough — never attenuate

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++) {
            data[i] *= scale;
        }
    }
}

// For decoded samples we can't generate a continuation past the end, so
// instead the head is crossfaded with the tail and the loop region shortened
// to end where the borrowed tail begins — the wrap lands exactly on the
// blended head, so it stays continuous.
function prepareSampleLoop(type, buffer) {
    const F = Math.min(SEAM_FADE_SAMPLES * 4, Math.floor(buffer.length / 8)); // ~0.2 s blend
    const N = buffer.length;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < F; i++) {
            const w = i / F;
            data[i] = data[i] * w + data[N - F + i] * (1 - w);
        }
    }
    sampleLoopEnd[type] = (N - F) / buffer.sampleRate;
    buffers[type] = buffer;
}

async function loadSampleBuffer(type) {
    const resp = await fetch(SAMPLE_URLS[type]);
    if (!resp.ok) throw new Error(`sample fetch failed: ${resp.status}`);
    const data = await resp.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(data);
    normalizeSampleBuffer(decoded);
    prepareSampleLoop(type, decoded);
}

function generateNoiseBuffer(type) {
    const bufferSize = audioCtx.sampleRate * 5; // 5 seconds
    const buffer = audioCtx.createBuffer(2, bufferSize, audioCtx.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
        const out = buffer.getChannelData(channel);
        const next = createNoiseGenerator(type);

        for (let i = 0; i < bufferSize; i++) {
            out[i] = next();
        }

        if (type !== 'white') {
            // Filtered colors carry state across samples, so the loop seam
            // needs smoothing (white is uncorrelated — nothing to smooth)
            const extra = new Float32Array(SEAM_FADE_SAMPLES);
            for (let i = 0; i < SEAM_FADE_SAMPLES; i++) {
                extra[i] = next();
            }
            blendLoopSeam(out, extra);
        }
    }

    buffers[type] = buffer;
}

// --- Audio Initialization ---
const SWELL_RATE = 0.07; // Hz — one swell roughly every 14 s
const SWELL_DEPTH = 0.35;

function initAudio() {
    if (audioCtx) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // 1. Create EQ Nodes
    eqNodes = eqBands.map((freq) => {
        const node = audioCtx.createBiquadFilter();
        node.type = 'peaking';
        node.frequency.value = freq;
        node.Q.value = 1.4; // roughly 1 octave bandwidth
        node.gain.value = 0; // Default flat
        return node;
    });

    // Sync UI sliders with node gains (if they were changed before init)
    const uiSliders = eqBoard.querySelectorAll('.eq-slider');
    uiSliders.forEach((slider, index) => {
        eqNodes[index].gain.value = parseFloat(slider.value);
    });

    // 2. Create Master Frequency Filter Node
    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.Q.value = 0.5;

    // 3. Create Master Volume Node
    masterVolumeNode = audioCtx.createGain();
    masterVolumeNode.gain.value = volSlider.value / 100;

    // 4. Create Stereo Routing
    setupMidSideRouting();

    // 5. Ocean swell: a sub-audio sine LFO modulating a gain stage.
    //    Depth 0 = off; when on, gain oscillates within [1 - 2d, 1] so the
    //    swell never pushes the signal above unity.
    swellGainNode = audioCtx.createGain();
    swellGainNode.gain.value = 1;
    swellDepthNode = audioCtx.createGain();
    swellDepthNode.gain.value = 0;
    const swellLfo = audioCtx.createOscillator();
    swellLfo.type = 'sine';
    swellLfo.frequency.value = SWELL_RATE;
    swellLfo.connect(swellDepthNode);
    swellDepthNode.connect(swellGainNode.gain);
    swellLfo.start();

    // 6. Wire the static graph ONCE:
    //    EQ0 -> ... -> EQ15 -> filter -> mid/side -> merger -> volume ->
    //    swell -> fade -> out. startSound() only attaches a BufferSource.
    for (let i = 0; i < eqNodes.length - 1; i++) {
        eqNodes[i].connect(eqNodes[i + 1]);
    }
    eqNodes[eqNodes.length - 1].connect(filterNode);
    filterNode.connect(splitter);
    merger.connect(masterVolumeNode);
    masterVolumeNode.connect(swellGainNode);

    fadeGainNode = audioCtx.createGain();
    fadeGainNode.gain.value = 0;
    swellGainNode.connect(fadeGainNode);
    fadeGainNode.connect(audioCtx.destination);

    // Initial UI Sync
    updateFrequency();
    updateStereoWidth();
    updateVolume();
    updateSwell();
}

function setupMidSideRouting() {
    splitter = audioCtx.createChannelSplitter(2);

    const midMix = audioCtx.createGain();
    midMix.gain.value = 0.5;

    const sPos = audioCtx.createGain(); sPos.gain.value = 0.5;
    const sNeg = audioCtx.createGain(); sNeg.gain.value = -0.5;

    splitter.connect(midMix, 0);
    splitter.connect(midMix, 1);

    splitter.connect(sPos, 0);
    splitter.connect(sNeg, 1);

    const sideMix = audioCtx.createGain();
    sPos.connect(sideMix);
    sNeg.connect(sideMix);

    // midGain doubles as headroom compensation — see updateStereoWidth()
    midGain = audioCtx.createGain(); midGain.gain.value = 1.0;
    sideGain = audioCtx.createGain(); sideGain.gain.value = currentWidth;

    midMix.connect(midGain);
    sideMix.connect(sideGain);

    const outL = audioCtx.createGain();
    const outR = audioCtx.createGain();
    const sideInvert = audioCtx.createGain(); sideInvert.gain.value = -1.0;

    midGain.connect(outL);
    midGain.connect(outR);

    sideGain.connect(outL);
    sideGain.connect(sideInvert);
    sideInvert.connect(outR);

    merger = audioCtx.createChannelMerger(2);
    outL.connect(merger, 0, 0);
    outR.connect(merger, 0, 1);
}

const FADE_TIME = 0.06; // seconds — click-free start/stop/swap ramp

// Guards against a slow sample download finishing after the user has already
// switched to something else or pressed stop
let startToken = 0;

async function startSound() {
    if (!audioCtx) initAudio();
    // 'interrupted' (iOS after a call/Siri) and 'suspended' both need a resume
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});

    const type = currentNoiseType;
    const token = ++startToken;

    if (!buffers[type]) {
        if (SAMPLE_URLS[type]) {
            statusText.textContent = 'LOADING';
            try {
                await loadSampleBuffer(type);
            } catch (e) {
                if (token === startToken) statusText.textContent = 'ERROR';
                return;
            }
        } else {
            generateNoiseBuffer(type);
        }
    }

    // Superseded while loading (new selection, or user pressed stop)
    if (token !== startToken || !isPlaying) return;
    statusText.textContent = 'ONLINE';

    const now = audioCtx.currentTime;
    let startAt = now;

    fadeGainNode.gain.cancelScheduledValues(now);

    if (sourceNode) {
        // Fade the current source out, then bring the new one in — no clicks
        const old = sourceNode;
        fadeGainNode.gain.setValueAtTime(fadeGainNode.gain.value, now);
        fadeGainNode.gain.linearRampToValueAtTime(0, now + FADE_TIME);
        old.stop(now + FADE_TIME + 0.01);
        old.onended = () => old.disconnect();
        startAt = now + FADE_TIME;
    } else {
        fadeGainNode.gain.setValueAtTime(0, now);
    }

    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = buffers[type];
    sourceNode.loop = true;
    if (sampleLoopEnd[type]) sourceNode.loopEnd = sampleLoopEnd[type];
    sourceNode.connect(eqNodes[0]);
    sourceNode.start(startAt);

    fadeGainNode.gain.linearRampToValueAtTime(1, startAt + FADE_TIME);
}

function stopSound(fadeSeconds = FADE_TIME) {
    if (sourceNode && audioCtx) {
        const now = audioCtx.currentTime;
        const old = sourceNode;

        // Ramp down before stopping so pausing never pops
        fadeGainNode.gain.cancelScheduledValues(now);
        fadeGainNode.gain.setValueAtTime(fadeGainNode.gain.value, now);
        fadeGainNode.gain.linearRampToValueAtTime(0, now + fadeSeconds);
        old.stop(now + fadeSeconds + 0.01);
        old.onended = () => old.disconnect();

        sourceNode = null;
    }
}

// --- Playback State ---

// Single entry point for every play/stop path: button, media keys, sleep timer
function setPlaying(playing, fadeSeconds = FADE_TIME) {
    isPlaying = playing;

    if (playing) {
        startSound();
        playBtn.classList.add('playing');
        statusIndicator.classList.add('playing');
        playText.classList.add('hidden');
        pauseText.classList.remove('hidden');
        statusText.textContent = 'ONLINE';
    } else {
        stopSound(fadeSeconds);
        playBtn.classList.remove('playing');
        statusIndicator.classList.remove('playing');
        playText.classList.remove('hidden');
        pauseText.classList.add('hidden');
        statusText.textContent = 'OFFLINE';
    }

    updateMediaSession();
}

playBtn.addEventListener('click', () => setPlaying(!isPlaying));

// --- Media Session (hardware media keys / lock-screen controls) ---
function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
        title: 'DT Noise Gen',
        artist: SAMPLE_URLS[currentNoiseType] ? currentNoiseType : `${currentNoiseType} noise`
    });
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
}

if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => { if (!isPlaying) setPlaying(true); });
    navigator.mediaSession.setActionHandler('pause', () => { if (isPlaying) setPlaying(false); });
    navigator.mediaSession.setActionHandler('stop', () => { if (isPlaying) setPlaying(false); });
}

// --- Sleep Timer ---
const SLEEP_FADE = 8; // seconds — gentle fade to silence when the timer fires
let sleepRemainingMs = 0;

function renderSleepDisplay() {
    if (sleepRemainingMs > 0) {
        const totalSec = Math.round(sleepRemainingMs / 1000);
        const m = Math.floor(totalSec / 60);
        const s = String(totalSec % 60).padStart(2, '0');
        sleepDisplay.textContent = `${m}:${s}`;
    } else {
        sleepDisplay.textContent = 'OFF';
    }
}

sleepRadios.forEach(radio => {
    radio.addEventListener('change', () => {
        sleepRemainingMs = parseInt(radio.value, 10) * 60000;
        renderSleepDisplay();
    });
});

// Counts down only while playing, so pausing also pauses the timer
setInterval(() => {
    if (sleepRemainingMs > 0 && isPlaying) {
        sleepRemainingMs -= 1000;
        if (sleepRemainingMs <= 0) {
            sleepRemainingMs = 0;
            sleepRadios.forEach(r => { r.checked = (r.value === '0'); });
            setPlaying(false, SLEEP_FADE);
        }
        renderSleepDisplay();
    }
}, 1000);

// --- Remaining UI Event Listeners ---

function updateFrequency() {
    const val = freqSlider.value;
    const freq = calculateFrequency(val);
    freqDisplay.textContent = `${Math.round(freq)} Hz`;

    if (filterNode && audioCtx) {
        filterNode.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
    }
}

freqSlider.addEventListener('input', () => {
    updateFrequency();
    saveSettings();
});

function updateStereoWidth() {
    let widthVal = 1.0;
    widthRadios.forEach(radio => {
        if (radio.checked) widthVal = parseFloat(radio.value);
    });

    currentWidth = widthVal;

    if (midGain && sideGain && audioCtx) {
        // The mid/side matrix peaks at max(1, width) per channel — scale both
        // paths down so WIDE can't push full-scale noise past the DAC ceiling
        const comp = 1 / Math.max(1, currentWidth);
        midGain.gain.setTargetAtTime(comp, audioCtx.currentTime, 0.1);
        sideGain.gain.setTargetAtTime(currentWidth * comp, audioCtx.currentTime, 0.1);
    }
}

widthRadios.forEach(radio => {
    radio.addEventListener('change', () => {
        updateStereoWidth();
        saveSettings();
    });
});

function updateNoiseType() {
    let type = currentNoiseType;
    typeRadios.forEach(radio => {
        if (radio.checked) type = radio.value;
    });

    const changed = type !== currentNoiseType;
    currentNoiseType = type;

    if (changed && isPlaying && audioCtx) {
        // Restart sound to switch buffer seamlessly
        startSound();
    }

    updateMediaSession();
}

typeRadios.forEach(radio => {
    radio.addEventListener('change', () => {
        updateNoiseType();
        saveSettings();
    });
});

function updateSwell() {
    if (swellGainNode && audioCtx) {
        const depth = swellToggle.checked ? SWELL_DEPTH : 0;
        const now = audioCtx.currentTime;
        // Keep the modulation range at [1 - 2d, 1] so peaks stay at unity
        swellGainNode.gain.setTargetAtTime(1 - depth, now, 0.5);
        swellDepthNode.gain.setTargetAtTime(depth, now, 0.5);
    }
}

swellToggle.addEventListener('change', () => {
    updateSwell();
    saveSettings();
});

// Init visual states
loadSettings();
updateFrequency();
updateVolume();
renderSleepDisplay();
