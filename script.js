/**
 * White Noise Generator
 * Audio Engine & UI Controller
 */

// --- Audio Context & Nodes ---
let audioCtx;
let sourceNode;
let filterNode; // Master sweepable lowpass
let masterVolumeNode; // Master volume control
let eqNodes = []; // Array of 16 BiquadFilters
const eqBands = [20, 31, 50, 80, 125, 200, 315, 500, 800, 1200, 2000, 3150, 5000, 8000, 12500, 20000];

// Advanced routing nodes for stereo width
let splitter;
let merger;
let midGain;
let sideGain;

let isPlaying = false;
let currentWidth = 1.0;
let currentNoiseType = 'white'; // white | pink | brown

// Audio Buffers
let buffers = {
    white: null,
    pink: null,
    brown: null
};

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

function createStar() {
    // Pick a random color for the star (Cyan, Gold, or Orange)
    const colors = ['#00e5ff', '#ffc400', '#ff5500', '#ffffff'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    return {
        x: (Math.random() - 0.5) * canvas.width * 2,
        y: (Math.random() - 0.5) * canvas.height * 2,
        z: Math.random() * canvas.width,
        pz: 0,
        color: color
    };
}

function renderStarfield() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'; // Trail effect
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const speed = isPlaying ? 5 : 0.5; // Faster when playing
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    for (let i = 0; i < stars.length; i++) {
        let star = stars[i];

        star.pz = star.z;
        star.z -= speed;

        if (star.z < 1) {
            star.z = canvas.width;
            star.x = (Math.random() - 0.5) * canvas.width * 2;
            star.y = (Math.random() - 0.5) * canvas.height * 2;
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
        const brightness = Math.max(0.1, 1 - (star.z / canvas.width));

        // Convert hex color to rgba for transparency
        let rgb = "255, 255, 255"; // Default white
        if (star.color === '#00e5ff') rgb = "0, 229, 255";
        if (star.color === '#ffc400') rgb = "255, 196, 0";
        if (star.color === '#ff5500') rgb = "255, 85, 0";

        ctx.strokeStyle = `rgba(${rgb}, ${brightness})`;
        ctx.lineWidth = brightness * 3;
        ctx.stroke();
    }

    requestAnimationFrame(renderStarfield);
}

initStarfield();

// --- UI Builders ---
function formatEqLabel(freq) {
    if (freq >= 1000) return (freq / 1000).toFixed(1).replace('.0', '') + 'k';
    return freq.toString();
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
        // When value changes, update the corresponding EQ node
        slider.addEventListener('input', (e) => {
            if (eqNodes[index] && audioCtx) {
                eqNodes[index].gain.setTargetAtTime(e.target.value, audioCtx.currentTime, 0.05);
            }
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
        if (eqNodes[index] && audioCtx) {
            eqNodes[index].gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        }
    });
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

volSlider.addEventListener('input', updateVolume);

// --- Audio Algorithms ---
function generateNoiseBuffers() {
    const bufferSize = audioCtx.sampleRate * 5; // 5 seconds

    buffers.white = audioCtx.createBuffer(2, bufferSize, audioCtx.sampleRate);
    buffers.pink = audioCtx.createBuffer(2, bufferSize, audioCtx.sampleRate);
    buffers.brown = audioCtx.createBuffer(2, bufferSize, audioCtx.sampleRate);

    for (let channel = 0; channel < 2; channel++) {
        const whiteOut = buffers.white.getChannelData(channel);
        const pinkOut = buffers.pink.getChannelData(channel);
        const brownOut = buffers.brown.getChannelData(channel);

        // Filter states per channel for pink noise
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
        // Filter state for brown noise
        let lastOut = 0;

        for (let i = 0; i < bufferSize; i++) {
            let white = Math.random() * 2 - 1;

            // White Noise
            whiteOut[i] = white;

            // Pink Noise (Paul Kellet's method)
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            pinkOut[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            pinkOut[i] *= 0.11; // gain compensation
            b6 = white * 0.115926;

            // Brown Noise (integration with leak)
            brownOut[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = brownOut[i];
            brownOut[i] *= 3.5; // gain compensation
        }
    }
}

// --- Audio Initialization ---
function initAudio() {
    if (audioCtx) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    generateNoiseBuffers();

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
        eqNodes[index].gain.value = slider.value;
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

    // Initial UI Sync
    updateFrequency();
    updateStereoWidth();
    updateVolume();
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

function startSound() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (sourceNode) {
        sourceNode.stop();
        sourceNode.disconnect();
    }

    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = buffers[currentNoiseType];
    sourceNode.loop = true;

    // Chain EQ nodes: Source -> EQ0 -> EQ1 ... -> EQ15 -> filterNode
    let lastNode = sourceNode;
    eqNodes.forEach(node => {
        lastNode.connect(node);
        lastNode = node;
    });

    // Connect end of EQ chain to Master Filter
    lastNode.connect(filterNode);

    // Connect Master Filter to Mid-Side Splitter
    filterNode.connect(splitter);

    // Provide a small fade in to prevent clicking when sound starts
    const fadeGain = audioCtx.createGain();
    fadeGain.gain.setValueAtTime(0, audioCtx.currentTime);
    fadeGain.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.05);

    // Merger is at the end of the Mid-Side routing chain
    merger.disconnect();
    merger.connect(masterVolumeNode);
    masterVolumeNode.connect(fadeGain);
    fadeGain.connect(audioCtx.destination);

    sourceNode.start();
}

function stopSound() {
    if (sourceNode) {
        sourceNode.stop(audioCtx.currentTime + 0.05);
        sourceNode = null;
    }
}

// --- UI Event Listeners ---

playBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;

    if (isPlaying) {
        startSound();
        playBtn.classList.add('playing');
        statusIndicator.classList.add('playing');
        playText.classList.add('hidden');
        pauseText.classList.remove('hidden');
        statusText.textContent = 'ONLINE';
    } else {
        stopSound();
        playBtn.classList.remove('playing');
        statusIndicator.classList.remove('playing');
        playText.classList.remove('hidden');
        pauseText.classList.add('hidden');
        statusText.textContent = 'OFFLINE';
    }
});

function updateFrequency() {
    const val = freqSlider.value;
    const freq = calculateFrequency(val);
    freqDisplay.textContent = `${Math.round(freq).toString().padStart(4, '0')} HZ`;

    if (filterNode && audioCtx) {
        filterNode.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
    }
}

freqSlider.addEventListener('input', updateFrequency);

function updateStereoWidth() {
    let widthVal = 1.0;
    widthRadios.forEach(radio => {
        if (radio.checked) widthVal = parseFloat(radio.value);
    });

    currentWidth = widthVal;

    if (sideGain && audioCtx) {
        sideGain.gain.setTargetAtTime(currentWidth, audioCtx.currentTime, 0.1);
    }
}

widthRadios.forEach(radio => {
    radio.addEventListener('change', updateStereoWidth);
});

function updateNoiseType() {
    typeRadios.forEach(radio => {
        if (radio.checked) currentNoiseType = radio.value;
    });

    if (isPlaying && audioCtx) {
        // Restart sound to switch buffer seamlessly
        startSound();
    }
}

typeRadios.forEach(radio => {
    radio.addEventListener('change', updateNoiseType);
});

// Init visual states
updateFrequency();
