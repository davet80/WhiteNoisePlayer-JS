# DT Noise Gen

A no-build, vanilla-JS ambient noise generator built on the Web Audio API, with a starfield backdrop.

**Live:** <https://davet80.github.io/WhiteNoisePlayer-JS/>

![status](https://img.shields.io/badge/dependencies-none-6ee7d8)

## Features

- **Six noise colors** — white, pink (Paul Kellet filter), brown (leaky integrator), blue, violet, and grey (psychoacoustic approximation), all generated in-browser as seamless 5-second loops with seam crossfading
- **Two field recordings** — ocean waves and a rain/thunder storm, loaded lazily and looped with a crossfaded seam; the EQ, filter, width, and swell controls shape them just like the generated colors
- **16-band graphic EQ** (20 Hz – 20 kHz peaking filters)
- **Sweepable low-pass filter** (60 Hz – 8 kHz, log scale)
- **Mid/side stereo width** control (mono → wide) with headroom compensation
- **Sleep timer** — 15/30/60 min with a gentle 8-second fade to silence; pausing pauses the countdown
- **Presets** — Sleep, Focus, and Rain one-tap configurations
- **Ocean swell** — slow LFO amplitude modulation for a wave-like rise and fall
- **Settings persistence** — everything survives a reload via localStorage
- **Media keys** — play/pause from hardware keys or the lock screen (Media Session API)
- Click-free start/stop/switch via a persistent fade gain and crossfaded source swaps

## Running

It's a static page — serve the folder any way you like:

```bash
python3 -m http.server 8734
```

then open <http://localhost:8734>.

No dependencies, no build step. The `?v=N` query strings on the CSS/JS links are cache-busters — bump them if you edit those files.

## Audio sample credits

- `samples/ocean.mp3` — ["Oceanwavescrushing"](https://commons.wikimedia.org/wiki/File:Oceanwavescrushing.ogg) by Luftrum, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), via Wikimedia Commons (re-encoded to MP3)
- `samples/storm.mp3` — ["Thunderstorm after hot summer day (part 3 of 4)"](https://commons.wikimedia.org/wiki/File:Thunderstorm_after_hot_summer_day_17_minutes_03_of_04.ogg) by stephan, public domain, via Wikimedia Commons (re-encoded to MP3)
