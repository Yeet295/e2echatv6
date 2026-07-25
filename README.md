# Anonymous E2E Chat — accounts, roster, DMs, connect gate

## What's new

- The page no longer auto-connects. Set your name/pfp, hit Save, then a
  "Connect" button appears — only clicking that actually opens the
  WebSocket connection and joins the room.
- Fixed a bug where the roster used to freeze everyone's name as
  "Anonymous" forever, captured at the moment they first connected.
  Now: (a) since you set your name BEFORE connecting, it's already
  correct on join, and (b) if you change your name/pfp again mid-session,
  it now pushes live to everyone else in the room instead of going stale.

## Local setup

1. `npm install`
2. `npm start`
3. Open http://localhost:8080 in two tabs — set a name/pfp and hit
   Connect in each, same room, and test chat/DMs

## Deploying

Same as before: push to GitHub, deploy on Render
(Build: `npm install`, Start: `npm start`).
