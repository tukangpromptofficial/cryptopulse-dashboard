const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 3011;
const COINS = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'ripple', 'dogecoin', 'cardano', 'avalanche-2'];
const SYMBOLS = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', binancecoin: 'BNB', ripple: 'XRP', dogecoin: 'DOGE', cardano: 'ADA', 'avalanche-2': 'AVAX' };

const state = {};
COINS.forEach(c => {
  state[c] = { id: c, symbol: SYMBOLS[c], price: 0, prev: 0, change24h: 0, high: 0, low: 0, volume: 0, marketCap: 0, history: [] };
});

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  } else if (req.url === '/api/snapshot') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

const wss = new WebSocket.Server({ server });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'snapshot', data: state }));
  ws.on('close', () => clients.delete(ws));
});

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  }
}

function fetchPrices() {
  const ids = COINS.join(',');
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h`;
  https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'CryptoPulse/1.0 (OpenClaw demo)' } }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const arr = JSON.parse(data);
        if (!Array.isArray(arr)) {
          console.error('[coingecko] unexpected response', data.slice(0, 200));
          return;
        }
        const updates = [];
        for (const c of arr) {
          const s = state[c.id];
          if (!s) continue;
          s.prev = s.price;
          s.price = c.current_price;
          s.change24h = c.price_change_percentage_24h || 0;
          s.high = c.high_24h;
          s.low = c.low_24h;
          s.volume = c.total_volume;
          s.marketCap = c.market_cap;
          s.history.push(c.current_price);
          if (s.history.length > 60) s.history.shift();
          updates.push({ id: c.id, data: s });
        }
        broadcast({ type: 'batch', updates });
        console.log(`[coingecko] tick — BTC $${state.bitcoin.price} ETH $${state.ethereum.price}`);
      } catch (e) {
        console.error('[coingecko] parse error', e.message);
      }
    });
  }).on('error', e => console.error('[coingecko] error', e.message));
}

server.listen(PORT, () => {
  console.log(`CryptoPulse running on http://localhost:${PORT}`);
  console.log(`Tailscale: http://kokos-mac-mini:${PORT} or http://100.102.166.19:${PORT}`);
  fetchPrices();
  setInterval(fetchPrices, 8000);
});
