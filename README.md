# Teleprompter

Personal voice-tracking teleprompter web app for laptop, iPad and Android. No AI: the browser's built-in speech recognition plus plain fuzzy matching against the script.

## Phase 1: voice tracking prototype

`prototype/` is a single-page test build.

- `core.js` normalizes text and finds where the speaker is in the script (handles ad-libs, changed words, repeated lines, skips).
- `index.html` is the prompter: Ready / Running / Paused modes, wake phrase, first-line start, takes, restart phrase.
- `test-core.js` runs the matcher test cases: `node prototype/test-core.js`.

Live: https://sagarnagpalacademy1474.github.io/teleprompter/prototype/
