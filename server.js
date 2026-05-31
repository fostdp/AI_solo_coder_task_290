const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = 3000;
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const DATA_FILE = path.join(__dirname, 'game-records.json');

let gameState = {
  planes: { departure: [], arrival: [], active: [] },
  runways: {
    runway1: { occupied: false, closed: false, plane: null },
    runway2: { occupied: false, closed: false, plane: null }
  },
  taxiways: { taxiway1: { occupied: false, plane: null } },
  groundVehicles: [
    { id: 1, type: 'deice', name: '除冰车1', status: 'idle', location: null },
    { id: 2, type: 'tug', name: '拖车1', status: 'idle', location: null },
    { id: 3, type: 'fuel', name: '加油车1', status: 'idle', location: null }
  ],
  weather: { type: 'clear', intensity: 0, remaining: 0 },
  players: {
    approach: { connected: false, name: '进近管制' },
    tower: { connected: false, name: '塔台管制' }
  },
  score: 0,
  delayCount: 0,
  planesHandled: 0,
  isRunning: false,
  selectedPlane: null,
  selectedVehicle: null
};

function readRecords() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('读取记录失败:', e);
  }
  return [];
}

function writeRecords(records) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2));
  } catch (e) {
    console.error('写入记录失败:', e);
  }
}

function broadcastState() {
  const state = JSON.stringify({ type: 'state', data: gameState });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(state);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('新玩家连接');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleGameAction(data, ws);
    } catch (e) {
      console.error('消息解析错误:', e);
    }
  });

  ws.on('close', () => {
    console.log('玩家断开连接');
  });

  ws.send(JSON.stringify({ type: 'state', data: gameState }));
});

function handleGameAction(action, ws) {
  switch (action.type) {
    case 'join':
      if (action.role === 'approach' || action.role === 'tower') {
        gameState.players[action.role].connected = true;
        ws.role = action.role;
      }
      break;
    case 'selectPlane':
      gameState.selectedPlane = action.planeId;
      break;
    case 'selectVehicle':
      gameState.selectedVehicle = action.vehicleId;
      break;
    case 'assignRunway':
      assignPlaneToRunway(action.planeId, action.runwayId);
      break;
    case 'assignTaxiway':
      assignPlaneToTaxiway(action.planeId, action.taxiwayId);
      break;
    case 'assignVehicle':
      assignVehicleToPlane(action.vehicleId, action.planeId);
      break;
    case 'startGame':
      gameState.isRunning = true;
      gameState.score = 0;
      gameState.delayCount = 0;
      gameState.planesHandled = 0;
      gameState.planes = { departure: [], arrival: [], active: [] };
      gameState.weather = { type: 'clear', intensity: 0, remaining: 0 };
      Object.keys(gameState.runways).forEach(key => {
        gameState.runways[key] = { occupied: false, closed: false, plane: null };
      });
      gameState.groundVehicles.forEach(v => {
        v.status = 'idle';
        v.location = null;
      });
      break;
  }
  broadcastState();
}

function assignPlaneToRunway(planeId, runwayId) {
  if (gameState.runways[runwayId].occupied || gameState.runways[runwayId].closed) return;
  
  let plane, queueType;
  const depIndex = gameState.planes.departure.findIndex(p => p.id === planeId);
  if (depIndex > -1) {
    plane = gameState.planes.departure.splice(depIndex, 1)[0];
    queueType = 'departure';
  } else {
    const arrIndex = gameState.planes.arrival.findIndex(p => p.id === planeId);
    if (arrIndex > -1) {
      plane = gameState.planes.arrival.splice(arrIndex, 1)[0];
      queueType = 'arrival';
    }
  }
  
  if (plane) {
    plane.location = 'runway';
    plane.runwayId = runwayId;
    plane.processingTime = 0;
    plane.needsDeice = gameState.weather.type === 'snow' || gameState.weather.type === 'rain';
    gameState.runways[runwayId].occupied = true;
    gameState.runways[runwayId].plane = plane;
    gameState.planes.active.push(plane);
  }
}

function assignPlaneToTaxiway(planeId, taxiwayId) {
  if (gameState.taxiways[taxiwayId].occupied) return;
  
  const arrIndex = gameState.planes.arrival.findIndex(p => p.id === planeId);
  if (arrIndex === -1) return;
  
  const plane = gameState.planes.arrival.splice(arrIndex, 1)[0];
  plane.location = 'taxiway';
  plane.taxiwayId = taxiwayId;
  plane.processingTime = 0;
  gameState.taxiways[taxiwayId].occupied = true;
  gameState.taxiways[taxiwayId].plane = plane;
  gameState.planes.active.push(plane);
}

function assignVehicleToPlane(vehicleId, planeId) {
  const vehicle = gameState.groundVehicles.find(v => v.id === vehicleId);
  const plane = gameState.planes.active.find(p => p.id === planeId);
  
  if (vehicle && plane && vehicle.status === 'idle') {
    vehicle.status = 'busy';
    vehicle.location = planeId;
    vehicle.processingTime = 0;
    
    if (vehicle.type === 'deice') {
      plane.deicing = true;
    }
  }
}

app.post('/api/records', (req, res) => {
  const { score, delayCount, planesHandled, date } = req.body;
  const records = readRecords();
  const newRecord = {
    id: Date.now(),
    score,
    delayCount,
    planesHandled,
    date: date || new Date().toISOString()
  };
  records.push(newRecord);
  records.sort((a, b) => b.score - a.score);
  writeRecords(records);
  res.json({ success: true, record: newRecord });
});

app.get('/api/records', (req, res) => {
  const records = readRecords();
  res.json(records);
});

server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});
