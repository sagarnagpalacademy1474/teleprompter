# Teleprompter

Personal voice-tracking teleprompter web app for laptop, iPad and Android. No AI: the browser's built-in speech recognition plus plain fuzzy matching against the script.

Live: https://prompter.socialmediamasters.in (Google Cloud Run, service `prompter`, us-central1).

## Deploy

Every push to `main` is built by Cloud Build from `Dockerfile` (nginx serving `app/`, config in `deploy/nginx.conf`) and deployed to Cloud Run automatically, in about 3 minutes.

On every change, bump the build number in three places so browsers pick up the new files: `BUILD` in `app/index.html`, `VERSION` in `app/core.js` and `VERSION` in `app/sw.js`.

## Code

All code is in `app/`:

- `core.js` normalizes text and finds where the speaker is in the script (handles ad-libs, changed words, repeated lines, skips, Hinglish).
- `prompter.js` is the prompter screen: Ready / Running / Paused modes, wake phrase, takes, voice commands.
- `store.js` (IndexedDB), `settings.js` (global, folder, script), `app.js` (library and editor), `sync.js` + `merge.js` (Google Drive sync), `sw.js` (offline).

## Tests

```
node app/test-core.js
node app/test-hinglish.js
node app/test-replay.js
node app/test-merge.js
```
