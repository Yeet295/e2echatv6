// server.js
//
// This server does two jobs on one port:
//  1. Serves the chat page (plain static file)
//  2. Runs the WebSocket relay for chat
//
// Anyone with the link can join a room directly — no login gate.
// The relay still never sees message content: chat text is encrypted
// in the browser (see public/chat.html) before it's ever sent.

const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;

// ---------- Accounts (cookie-based, no login/password) ----------
// Every browser gets a random account id as a cookie the first time it
// shows up. No password, no email — the cookie itself IS the account.
// Clearing cookies or switching browsers/devices means a brand new,
// blank account: there's no way around that without real login/accounts.

// profiles: Map<accountId, { name, pfp }>
const profiles = new Map();
const ACCOUNT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year, in seconds

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

// Ensures the response carries an account_id cookie, creating one if this
// browser doesn't have one yet. Returns the account id either way.
function ensureAccountId(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.account_id) return cookies.account_id;

  const accountId = crypto.randomUUID();
  res.setHeader('Set-Cookie', `account_id=${accountId}; Max-Age=${ACCOUNT_COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`);
  return accountId;
}

function getProfile(accountId) {
  return profiles.get(accountId) || { name: 'Anonymous', pfp: '👤' };
}


const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serveStatic(req, res) {
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/chat.html';
  const fullPath = path.join(__dirname, 'public', path.normalize(filePath));

  // Basic safety: don't allow escaping the public/ folder
  if (!fullPath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  // Every response makes sure this browser has an account cookie.
  const accountId = ensureAccountId(req, res);

  if (req.method === 'GET' && req.url === '/profile') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getProfile(accountId)));
    return;
  }

  if (req.method === 'POST' && req.url === '/profile') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad request' }));
        return;
      }
      const name = String(parsed.name || 'Anonymous').slice(0, 30);
      const pfp = String(parsed.pfp || '👤').slice(0, 8); // keep it to an emoji-sized string
      profiles.set(accountId, { name, pfp });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name, pfp }));
    });
    return;
  }

  serveStatic(req, res);
});

// ---------- WebSocket relay ----------
const wss = new WebSocket.Server({ server });

// rooms: Map<roomId, Set<websocket>>
const rooms = new Map();

// clientsById: Map<clientId, websocket> — lets us route a DM straight to
// one specific connection instead of broadcasting it to the whole room.
const clientsById = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId);
}

function broadcast(roomId, msg, exclude) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(msg);
  for (const client of room) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

wss.on('connection', (ws, req) => {
  // Deliberately NOT reading or storing ws._socket.remoteAddress anywhere.
  // We DO read the account_id cookie already sent with the connection —
  // that's the browser's own account cookie, set via ensureAccountId above,
  // not anything IP-based.

  const cookies = parseCookies(req.headers.cookie);
  const accountId = cookies.account_id || null;

  let currentRoom = null;
  const clientId = crypto.randomUUID();
  clientsById.set(clientId, ws);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return;
    }

    if (msg.type === 'join') {
      currentRoom = String(msg.room || 'lobby').slice(0, 100);
      const room = getRoom(currentRoom);

      // Tell the new client who's already here, so it can draw the roster
      // immediately instead of waiting on future join events. Look each
      // profile up fresh (not a cached snapshot) so recent name/pfp
      // changes are always reflected.
      const roster = Array.from(room).map((c) => ({ clientId: c.clientId, profile: getProfile(c.accountId) }));
      room.add(ws);
      ws.room = currentRoom;
      ws.clientId = clientId;
      ws.accountId = accountId;

      ws.send(JSON.stringify({ type: 'welcome', clientId, roster }));
      broadcast(currentRoom, { type: 'peer-joined', clientId, profile: getProfile(accountId) }, ws);
      return;
    }

    // A client tells us its name/pfp changed — push it out live to
    // everyone else in the room, rather than everyone being stuck with
    // whatever profile existed at the moment they first joined.
    if (msg.type === 'profile-update') {
      if (currentRoom) {
        broadcast(currentRoom, { type: 'peer-profile', clientId, profile: getProfile(accountId) }, ws);
      }
      return;
    }

    // Direct messages: routed to exactly one recipient, never broadcast.
    // Still opaque to the server — it's an encrypted blob either way.
    if (msg.type === 'dm') {
      const target = clientsById.get(msg.to);
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({
          type: 'dm',
          clientId,
          profile: getProfile(accountId),
          iv: msg.iv,
          ciphertext: msg.ciphertext
        }));
      }
      return;
    }

    // Everything else (public keys, encrypted room-key deliveries, encrypted
    // chat messages) is opaque to the server — just stamp sender id and relay.
    // For chat messages specifically, also stamp the sender's profile
    // (display name + pfp) so everyone sees who's talking. The message TEXT
    // itself stays encrypted end-to-end — only this display metadata is
    // added by the server, in the clear, same as a name tag.
    if (currentRoom) {
      msg.clientId = clientId;
      if (msg.type === 'chat') {
        msg.profile = getProfile(accountId);
      }
      broadcast(currentRoom, msg, ws);
    }
  });

  ws.on('close', () => {
    clientsById.delete(clientId);
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(ws);
      broadcast(currentRoom, { type: 'peer-left', clientId }, ws);
      if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
