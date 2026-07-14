import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import crypto from 'crypto';
import { QUESTION_BANK } from './questions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 20;
const QUESTION_COUNT = 5;
const QUIZ_CORRECT_BONUS = 100;
const AUCTION_ROUNDS = 3;
const AUCTION_START_PRICE = 10;
const BID_STEP = 50;
const BID_LOCK_MS = 400;
const AUCTION_IDLE_MS = 10_000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const BOX_EFFECTS = [
  { label: '+20', type: 'add', value: 20 },
  { label: '+50', type: 'add', value: 50 },
  { label: '+100', type: 'add', value: 100 },
  { label: '-20', type: 'sub', value: 20 },
  { label: '-50', type: 'sub', value: 50 },
  { label: 'x2', type: 'mul', value: 2 },
  { label: '/2', type: 'div', value: 2 }
];

const AUCTION_ITEMS = [
  { id: 'diamond', name: 'Hộp Kim Cương', description: 'Vật phẩm sang trọng: +500 điểm cuối.' , bonus: 500 },
  { id: 'royal', name: 'Hộp Hoàng Gia', description: 'Vật phẩm danh giá: +300 điểm cuối.' , bonus: 300 },
  { id: 'mystery', name: 'Hộp Bí Ẩn', description: 'Vật phẩm bất ngờ: +700 điểm cuối.' , bonus: 700 }
];

let idleTimer = null;

const createInitialGame = () => ({
  phase: 'lobby',
  questionIds: [],
  hostId: null,
  players: {},
  teams: {},
  entities: {},
  notifications: [],
  auction: {
    roundIndex: 0,
    active: false,
    currentPrice: AUCTION_START_PRICE,
    leaderEntityId: null,
    leaderName: '--',
    lastBidAt: null,
    lockUntil: 0,
    item: null,
    winners: [],
    flash: null
  }
});

let game = createInitialGame();

function id(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function selectQuestionIds() {
  const ids = QUESTION_BANK.map((_, index) => index);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }
  return ids.slice(0, QUESTION_COUNT);
}

function getQuestion(index) {
  return QUESTION_BANK[game.questionIds[index]];
}

function randomBoxOptions() {
  return Array.from({ length: 3 }, () => randomFrom(BOX_EFFECTS));
}

function applyEffect(money, effect) {
  switch (effect.type) {
    case 'add': return money + effect.value;
    case 'sub': return Math.max(0, money - effect.value);
    case 'mul': return Math.max(0, Math.round(money * effect.value));
    case 'div': return Math.max(0, Math.round(money / effect.value));
    default: return money;
  }
}

function visibleName(rawName) {
  return String(rawName || '').trim().slice(0, 28);
}

function onlinePlayers() {
  return Object.values(game.players).filter((p) => p.online);
}

function addNotification(text, tone = 'info') {
  game.notifications.unshift({ id: id('note'), text, tone, at: Date.now() });
  game.notifications = game.notifications.slice(0, 8);
}

function ensureHost() {
  if (game.hostId && game.players[game.hostId]?.online) return;
  const firstOnline = onlinePlayers()[0];
  game.hostId = firstOnline?.id || null;
}

function isHost(socket) {
  return socket.id === game.hostId;
}

function requireHost(socket) {
  if (!isHost(socket)) {
    socket.emit('notification', { tone: 'error', text: 'Chỉ chủ phòng mới thực hiện được thao tác này.' });
    return false;
  }
  return true;
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    money: p.money,
    online: p.online,
    quizIndex: p.quizIndex,
    quizDone: p.quizDone,
    teamId: p.teamId,
    solo: p.solo,
    answered: p.answered,
    boxPending: p.boxPending
  };
}

function getLeaderboard() {
  return Object.values(game.players)
    .map(publicPlayer)
    .sort((a, b) => b.money - a.money || a.name.localeCompare(b.name));
}

function getEntitiesLeaderboard() {
  const entities = Object.values(game.entities || {});
  if (!entities.length) return [];
  return entities
    .map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      money: e.money,
      members: e.members,
      items: e.items || [],
      finalScore: e.money + (e.items || []).reduce((sum, item) => sum + (item.bonus || 0), 0)
    }))
    .sort((a, b) => b.finalScore - a.finalScore || b.money - a.money || a.name.localeCompare(b.name));
}

function buildSelfState(socketId) {
  const p = game.players[socketId];
  if (!p) return null;
  const currentQuestion = getQuestion(p.quizIndex);
  const question = currentQuestion && !p.quizDone
    ? {
        index: p.quizIndex,
        total: QUESTION_COUNT,
        chapter: currentQuestion.chapter,
        text: currentQuestion.text,
        options: currentQuestion.options
      }
    : null;

  return {
    ...publicPlayer(p),
    question,
    boxOptions: p.boxPending ? p.boxOptions?.map((_, index) => ({ index })) : [],
    lastAnswer: p.lastAnswer || null,
    lastBox: p.lastBox || null,
    entityId: getEntityByPlayerId(p.id)?.id || null
  };
}

function getEntityByPlayerId(playerId) {
  return Object.values(game.entities || {}).find((entity) => entity.members.includes(playerId));
}

function getStateFor(socketId) {
  ensureHost();
  return {
    phase: game.phase,
    hostId: game.hostId,
    maxPlayers: MAX_PLAYERS,
    rules: {
      questionCount: QUESTION_COUNT,
      auctionRounds: AUCTION_ROUNDS,
      auctionStartPrice: AUCTION_START_PRICE,
      bidStep: BID_STEP,
      auctionIdleMs: AUCTION_IDLE_MS
    },
    players: getLeaderboard(),
    teams: Object.values(game.teams).map((t) => ({ ...t })),
    entities: getEntitiesLeaderboard(),
    auction: {
      ...game.auction,
      lockUntil: undefined
    },
    notifications: game.notifications,
    self: buildSelfState(socketId)
  };
}

function broadcastState() {
  ensureHost();
  for (const [socketId, socket] of io.sockets.sockets) {
    socket.emit('state:update', getStateFor(socketId));
  }
}

function allQuizDone() {
  const players = onlinePlayers();
  return players.length > 0 && players.every((p) => p.quizDone);
}

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleAuctionIdleClose() {
  clearIdleTimer();
  if (game.phase !== 'auction' || !game.auction.active) return;
  const reference = game.auction.lastBidAt || Date.now();
  idleTimer = setTimeout(() => {
    if (game.phase !== 'auction' || !game.auction.active) return;
    const last = game.auction.lastBidAt || reference;
    if (Date.now() - last >= AUCTION_IDLE_MS) {
      closeAuctionRound('auto');
    } else {
      scheduleAuctionIdleClose();
    }
  }, AUCTION_IDLE_MS + 50);
}

function finalizeAuctionParticipants() {
  const entities = {};

  for (const team of Object.values(game.teams)) {
    const members = team.members.filter((pid) => game.players[pid]);
    if (!members.length) continue;
    const money = members.reduce((sum, pid) => sum + (game.players[pid]?.money || 0), 0);
    entities[team.id] = {
      id: team.id,
      name: team.name,
      type: 'team',
      members,
      money,
      items: []
    };
  }

  for (const p of Object.values(game.players)) {
    if (!p.online) continue;
    if (p.teamId) continue;
    const soloId = `solo_${p.id}`;
    p.solo = true;
    entities[soloId] = {
      id: soloId,
      name: `${p.name} (Solo)`,
      type: 'solo',
      members: [p.id],
      money: p.money,
      items: []
    };
  }

  game.entities = entities;
}

function startAuctionRound(socket) {
  if (socket && !requireHost(socket)) return;
  if (game.phase !== 'auction') return;
  if (game.auction.active) return;
  if (game.auction.roundIndex >= AUCTION_ROUNDS) {
    finishGame();
    return;
  }

  const nextIndex = game.auction.roundIndex + 1;
  game.auction = {
    ...game.auction,
    roundIndex: nextIndex,
    active: true,
    currentPrice: AUCTION_START_PRICE,
    leaderEntityId: null,
    leaderName: '--',
    lastBidAt: Date.now(),
    lockUntil: 0,
    item: AUCTION_ITEMS[nextIndex - 1],
    flash: null
  };

  addNotification(`Vòng đấu giá ${nextIndex} đã bắt đầu.`, 'gold');
  scheduleAuctionIdleClose();
  broadcastState();
}

function closeAuctionRound(reason = 'host') {
  if (game.phase !== 'auction' || !game.auction.active) return;
  clearIdleTimer();

  const item = game.auction.item;
  const leaderId = game.auction.leaderEntityId;
  const price = game.auction.currentPrice;

  if (leaderId && game.entities[leaderId]) {
    const entity = game.entities[leaderId];
    entity.money = Math.max(0, entity.money - price);
    entity.items.push({ ...item, price, round: game.auction.roundIndex });
    game.auction.winners.push({
      round: game.auction.roundIndex,
      item,
      winnerId: entity.id,
      winnerName: entity.name,
      price,
      reason
    });
    addNotification(`${entity.name} thắng ${item.name} với giá $${price}.`, 'success');
  } else {
    game.auction.winners.push({
      round: game.auction.roundIndex,
      item,
      winnerId: null,
      winnerName: 'Không có người thắng',
      price: 0,
      reason
    });
    addNotification(`${item.name} không có người thắng.`, 'info');
  }

  game.auction.active = false;
  game.auction.leaderEntityId = null;
  game.auction.leaderName = '--';
  game.auction.currentPrice = AUCTION_START_PRICE;
  game.auction.flash = null;

  if (game.auction.roundIndex >= AUCTION_ROUNDS) {
    finishGame();
  }

  broadcastState();
}

function finishGame() {
  clearIdleTimer();
  game.phase = 'result';
  game.auction.active = false;
  addNotification('Trò chơi kết thúc. Bảng xếp hạng cuối đã sẵn sàng.', 'gold');
}

io.on('connection', (socket) => {
  socket.emit('state:update', getStateFor(socket.id));

  socket.on('player:join', ({ name } = {}, acknowledge = () => {}) => {
    if (game.phase !== 'lobby') {
      socket.emit('notification', { tone: 'error', text: 'Game đã bắt đầu. Vui lòng chờ ván sau.' });
      acknowledge({ ok: false, error: 'Game đã bắt đầu. Vui lòng chờ ván sau.' });
      return;
    }
    if (onlinePlayers().length >= MAX_PLAYERS) {
      socket.emit('notification', { tone: 'error', text: 'Phòng đã đủ người chơi.' });
      acknowledge({ ok: false, error: 'Phòng đã đủ người chơi.' });
      return;
    }

    let cleanName = visibleName(name);
    if (!cleanName) {
      socket.emit('notification', { tone: 'error', text: 'Vui lòng nhập tên người chơi.' });
      acknowledge({ ok: false, error: 'Vui lòng nhập tên người chơi.' });
      return;
    }

    const names = onlinePlayers().map((p) => p.name.toLowerCase());
    const original = cleanName;
    let count = 2;
    while (names.includes(cleanName.toLowerCase())) {
      cleanName = `${original} ${count}`;
      count += 1;
    }

    game.players[socket.id] = {
      id: socket.id,
      name: cleanName,
      money: 0,
      online: true,
      quizIndex: 0,
      quizDone: false,
      answered: false,
      boxPending: false,
      boxOptions: [],
      lastAnswer: null,
      lastBox: null,
      teamId: null,
      solo: false
    };

    if (!game.hostId) game.hostId = socket.id;
    addNotification(`${cleanName} đã vào phòng.`, 'info');
    acknowledge({ ok: true, name: cleanName });
    broadcastState();
  });

  socket.on('host:claim', () => {
    if (!game.players[socket.id]) {
      socket.emit('notification', { tone: 'error', text: 'Bạn cần vào phòng trước.' });
      return;
    }
    game.hostId = socket.id;
    addNotification(`${game.players[socket.id].name} hiện là chủ phòng.`, 'gold');
    broadcastState();
  });

  socket.on('game:start', () => {
    if (!requireHost(socket)) return;
    if (game.phase !== 'lobby') return;
    if (onlinePlayers().length < 1) {
      socket.emit('notification', { tone: 'error', text: 'Cần ít nhất 1 người chơi.' });
      return;
    }
    for (const p of Object.values(game.players)) {
      p.money = 0;
      p.quizIndex = 0;
      p.quizDone = false;
      p.answered = false;
      p.boxPending = false;
      p.boxOptions = [];
      p.lastAnswer = null;
      p.lastBox = null;
      p.teamId = null;
      p.solo = false;
    }
    game.teams = {};
    game.entities = {};
    game.auction = createInitialGame().auction;
    game.questionIds = selectQuestionIds();
    game.phase = 'quiz';
    addNotification('Game bắt đầu. Mỗi người chơi trả lời 5 câu hỏi.', 'gold');
    broadcastState();
  });

  socket.on('quiz:answer', ({ answerIndex } = {}) => {
    const p = game.players[socket.id];
    if (!p || game.phase !== 'quiz' || p.quizDone || p.boxPending) return;
    const question = getQuestion(p.quizIndex);
    if (!question) return;

    const correct = Number(answerIndex) === question.correctIndex;
    if (correct) p.money += QUIZ_CORRECT_BONUS;
    p.answered = true;
    p.boxPending = true;
    p.boxOptions = randomBoxOptions();
    p.lastAnswer = {
      correct,
      selectedIndex: Number(answerIndex),
      correctIndex: question.correctIndex,
      bonus: correct ? QUIZ_CORRECT_BONUS : 0
    };
    p.lastBox = null;

    socket.emit('notification', {
      tone: correct ? 'success' : 'error',
      text: correct ? `Đúng! Bạn được +$${QUIZ_CORRECT_BONUS}. Hãy chọn 1 hộp.` : 'Sai rồi. Hãy chọn 1 hộp may mắn.'
    });
    broadcastState();
  });

  socket.on('quiz:chooseBox', ({ index } = {}) => {
    const p = game.players[socket.id];
    if (!p || game.phase !== 'quiz' || !p.boxPending) return;
    const boxIndex = Number(index);
    const effect = p.boxOptions[boxIndex];
    if (!effect) return;

    const before = p.money;
    const after = applyEffect(before, effect);
    p.money = after;
    p.lastBox = { effect: effect.label, before, after };
    p.boxPending = false;
    p.boxOptions = [];
    p.answered = false;
    p.quizIndex += 1;

    if (p.quizIndex >= QUESTION_COUNT) {
      p.quizDone = true;
      addNotification(`${p.name} đã hoàn thành phần quiz với $${p.money}.`, 'success');
    }

    if (allQuizDone()) {
      game.phase = 'team';
      addNotification('Tất cả đã hoàn thành quiz. Chuyển sang lập đội/chơi đơn.', 'gold');
    }

    broadcastState();
  });

  socket.on('team:solo', () => {
    const p = game.players[socket.id];
    if (!p || game.phase !== 'team') return;
    if (p.teamId) {
      socket.emit('notification', { tone: 'error', text: 'Bạn đã thuộc một đội, không thể chọn solo.' });
      return;
    }
    p.solo = true;
    addNotification(`${p.name} chọn chơi đơn.`, 'info');
    broadcastState();
  });

  socket.on('team:create', ({ name, memberIds } = {}) => {
    const p = game.players[socket.id];
    if (!p || game.phase !== 'team') return;
    if (p.teamId) {
      socket.emit('notification', { tone: 'error', text: 'Bạn đã thuộc một đội.' });
      return;
    }

    const teamName = visibleName(name) || `Đội của ${p.name}`;
    const uniqueMembers = Array.from(new Set([p.id, ...(Array.isArray(memberIds) ? memberIds : [])]));
    if (uniqueMembers.length > 4) {
      socket.emit('notification', { tone: 'error', text: 'Một đội tối đa 4 người.' });
      return;
    }

    for (const pid of uniqueMembers) {
      const member = game.players[pid];
      if (!member || member.teamId) {
        socket.emit('notification', { tone: 'error', text: 'Một thành viên đã thuộc đội khác hoặc không tồn tại.' });
        return;
      }
    }

    const teamId = id('team');
    game.teams[teamId] = { id: teamId, name: teamName, members: uniqueMembers };
    for (const pid of uniqueMembers) {
      game.players[pid].teamId = teamId;
      game.players[pid].solo = false;
    }

    addNotification(`${teamName} đã được lập với ${uniqueMembers.length} thành viên.`, 'success');
    broadcastState();
  });

  socket.on('auction:startPhase', () => {
    if (!requireHost(socket)) return;
    if (game.phase !== 'team') return;
    finalizeAuctionParticipants();
    if (!Object.keys(game.entities).length) {
      socket.emit('notification', { tone: 'error', text: 'Chưa có người/đội nào để đấu giá.' });
      return;
    }
    game.phase = 'auction';
    addNotification('Chuyển sang giai đoạn đấu giá.', 'gold');
    broadcastState();
  });

  socket.on('auction:startRound', () => startAuctionRound(socket));

  socket.on('auction:bid', () => {
    const p = game.players[socket.id];
    if (!p || game.phase !== 'auction' || !game.auction.active) return;

    const now = Date.now();
    if (now < game.auction.lockUntil) {
      socket.emit('auction:bidRejected', { reason: 'Vui lòng chờ nhịp bid tiếp theo.' });
      return;
    }

    const entity = getEntityByPlayerId(p.id);
    if (!entity) {
      socket.emit('auction:bidRejected', { reason: 'Bạn chưa thuộc nhóm đấu giá.' });
      return;
    }

    const nextPrice = game.auction.currentPrice + BID_STEP;
    if (entity.money < nextPrice) {
      socket.emit('auction:bidRejected', { reason: `Không đủ tiền. Cần ít nhất $${nextPrice}.` });
      return;
    }

    game.auction.currentPrice = nextPrice;
    game.auction.leaderEntityId = entity.id;
    game.auction.leaderName = entity.name;
    game.auction.lastBidAt = now;
    game.auction.lockUntil = now + BID_LOCK_MS;
    game.auction.flash = { id: id('flash'), name: entity.name, price: nextPrice, at: now };

    io.emit('auction:bidAccepted', { name: entity.name, price: nextPrice, at: now });
    scheduleAuctionIdleClose();
    broadcastState();
  });

  socket.on('auction:closeRound', () => {
    if (!requireHost(socket)) return;
    closeAuctionRound('host');
  });

  socket.on('game:reset', () => {
    if (!requireHost(socket)) return;
    const oldPlayers = Object.values(game.players)
      .filter((p) => p.online)
      .map((p) => ({ id: p.id, name: p.name, online: true }));
    const oldHostId = game.hostId;
    clearIdleTimer();
    game = createInitialGame();
    for (const p of oldPlayers) {
      game.players[p.id] = {
        id: p.id,
        name: p.name,
        money: 0,
        online: true,
        quizIndex: 0,
        quizDone: false,
        answered: false,
        boxPending: false,
        boxOptions: [],
        lastAnswer: null,
        lastBox: null,
        teamId: null,
        solo: false
      };
    }
    game.hostId = game.players[oldHostId] ? oldHostId : oldPlayers[0]?.id || null;
    addNotification('Game đã được reset.', 'gold');
    broadcastState();
  });

  socket.on('disconnect', () => {
    const p = game.players[socket.id];
    if (p) {
      p.online = false;
      addNotification(`${p.name} đã rời phòng.`, 'info');
    }
    ensureHost();
    broadcastState();
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, phase: game.phase, players: onlinePlayers().length });
});

const distPath = path.join(__dirname, 'client', 'dist');
app.use(express.static(distPath));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Golden Hammer Auction server running at http://127.0.0.1:${PORT}`);
});
