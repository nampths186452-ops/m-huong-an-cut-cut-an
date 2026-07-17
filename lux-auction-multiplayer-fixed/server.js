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
const QUESTION_COUNT = QUESTION_BANK.length;
const QUIZ_CORRECT_BONUS = 100;
const AUCTION_ROUNDS = 3;
const AUCTION_START_PRICE = 100;
const BID_STEP = 50;
const EMPTY_ROOM_RESET_MS = 15_000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const AUCTION_ITEMS = [
  {
    id: 'land_riverside',
    code: 'LÔ A-01',
    name: 'Đất ven sông An Phú',
    location: 'Khu ven sông, cách trung tâm giả định 12 km',
    area: '120 m²',
    purpose: 'Đất ở đô thị',
    advantage: 'Hạ tầng đang phát triển, tiềm năng trung bình',
    reservePrice: 100,
    bonus: 250
  },
  {
    id: 'land_commercial',
    code: 'LÔ B-08',
    name: 'Đất thương mại Minh Khai',
    location: 'Mặt đường trục chính của khu đô thị giả định',
    area: '180 m²',
    purpose: 'Thương mại – dịch vụ',
    advantage: 'Lưu lượng người qua lại cao, khả năng khai thác tốt',
    reservePrice: 250,
    bonus: 500
  },
  {
    id: 'land_center',
    code: 'LÔ C-15',
    name: 'Đất trung tâm Hòa Bình',
    location: 'Quảng trường trung tâm của thành phố giả định',
    area: '240 m²',
    purpose: 'Đất hỗn hợp cao tầng',
    advantage: 'Vị trí khan hiếm, giá trị khai thác cao nhất',
    reservePrice: 400,
    bonus: 800
  }
];

// Nội dung mô phỏng; có thể thay bằng bộ thể chế do Lâm cung cấp sau.
const INSTITUTIONS = [
  {
    id: 'none',
    name: 'Không can thiệp',
    description: 'Tổ chức vòng đấu giá theo điều kiện cơ bản.',
    reserveIncrease: 0,
    surchargeRate: 0,
    ownershipLimit: null
  },
  {
    id: 'higher_reserve',
    name: 'Điều chỉnh tăng giá khởi điểm',
    description: 'Cơ quan tổ chức tăng thêm 100 coin vào giá khởi điểm để hạn chế đầu cơ.',
    reserveIncrease: 100,
    surchargeRate: 0,
    ownershipLimit: null
  },
  {
    id: 'transfer_fee',
    name: 'Phụ thu chuyển nhượng 10%',
    description: 'Nhóm thắng phải nộp thêm 10% giá chốt vào ngân sách mô phỏng.',
    reserveIncrease: 0,
    surchargeRate: 0.1,
    ownershipLimit: null
  },
  {
    id: 'ownership_cap',
    name: 'Giới hạn tập trung sở hữu',
    description: 'Nhóm đã thắng 1 lô đất không được tham gia trả giá lô tiếp theo.',
    reserveIncrease: 0,
    surchargeRate: 0,
    ownershipLimit: 1
  }
];

let emptyRoomTimer = null;

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
    item: null,
    winners: [],
    bidLedger: [],
    institutionId: 'none',
    flash: null
  },
  feedback: []
});

let game = createInitialGame();

function id(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

function selectQuestionIds() {
  return QUESTION_BANK.map((_, index) => index);
}

function getQuestion(index) {
  return QUESTION_BANK[game.questionIds[index]];
}

function visibleName(rawName) {
  return String(rawName || '').trim().slice(0, 28);
}

function findOrCreateGroup(rawGroupName) {
  const groupName = visibleName(rawGroupName);
  if (!groupName) return null;
  const existing = Object.values(game.teams)
    .find((team) => team.name.toLowerCase() === groupName.toLowerCase());
  if (existing) return existing;

  const team = { id: id('group'), name: groupName, members: [] };
  game.teams[team.id] = team;
  return team;
}

function onlinePlayers() {
  return Object.values(game.players).filter((p) => p.online);
}

function playerForSocket(socket) {
  return game.players[socket.data.playerId] || null;
}

function playerHasConnection(playerId) {
  return Array.from(io.sockets.sockets.values())
    .some((connectedSocket) => connectedSocket.data.playerId === playerId);
}

function clearEmptyRoomTimer() {
  if (emptyRoomTimer) {
    clearTimeout(emptyRoomTimer);
    emptyRoomTimer = null;
  }
}

function scheduleEmptyRoomReset() {
  clearEmptyRoomTimer();
  if (onlinePlayers().length > 0) return;

  emptyRoomTimer = setTimeout(() => {
    emptyRoomTimer = null;
    if (onlinePlayers().length > 0) return;
    game = createInitialGame();
    console.log('Room was empty; game state reset to the lobby.');
    broadcastState();
  }, EMPTY_ROOM_RESET_MS);
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
  return socket.data.playerId === game.hostId;
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
    groupName: game.teams[p.teamId]?.name || 'Chưa có nhóm',
    answered: p.answered
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

function buildSelfState(playerId) {
  const p = game.players[playerId];
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
    lastAnswer: p.lastAnswer || null,
    entityId: getEntityByPlayerId(p.id)?.id || null
  };
}

function getEntityByPlayerId(playerId) {
  return Object.values(game.entities || {}).find((entity) => entity.members.includes(playerId));
}

function getStateFor(socket) {
  ensureHost();
  return {
    phase: game.phase,
    hostId: game.hostId,
    maxPlayers: MAX_PLAYERS,
    rules: {
      questionCount: QUESTION_COUNT,
      auctionRounds: AUCTION_ROUNDS,
      auctionStartPrice: AUCTION_START_PRICE,
      bidStep: BID_STEP
    },
    players: getLeaderboard(),
    teams: Object.values(game.teams).map((t) => ({
      ...t,
      money: t.members.reduce((sum, playerId) => sum + (game.players[playerId]?.money || 0), 0)
    })),
    entities: getEntitiesLeaderboard(),
    institutions: INSTITUTIONS,
    landLots: AUCTION_ITEMS,
    auction: { ...game.auction },
    notifications: game.notifications,
    feedback: game.feedback,
    self: buildSelfState(socket.data.playerId)
  };
}

function broadcastState() {
  ensureHost();
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('state:update', getStateFor(socket));
  }
}

function allQuizDone() {
  const players = onlinePlayers();
  return players.length > 0 && players.every((p) => p.quizDone);
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
  const item = AUCTION_ITEMS[nextIndex - 1];
  const institution = INSTITUTIONS.find((entry) => entry.id === game.auction.institutionId) || INSTITUTIONS[0];
  game.auction = {
    ...game.auction,
    roundIndex: nextIndex,
    active: true,
    currentPrice: item.reservePrice + institution.reserveIncrease,
    leaderEntityId: null,
    leaderName: '--',
    lastBidAt: Date.now(),
    item,
    flash: null
  };

  addNotification(`Vòng đấu giá ${nextIndex} đã bắt đầu.`, 'gold');
  broadcastState();
}

function closeAuctionRound(reason = 'host') {
  if (game.phase !== 'auction' || !game.auction.active) return;
  const item = game.auction.item;
  const institution = INSTITUTIONS.find((entry) => entry.id === game.auction.institutionId) || INSTITUTIONS[0];
  const leaderId = game.auction.leaderEntityId;
  const price = game.auction.currentPrice;

  if (leaderId && game.entities[leaderId]) {
    const entity = game.entities[leaderId];
    const surcharge = Math.round(price * institution.surchargeRate);
    const totalCost = price + surcharge;
    entity.money = Math.max(0, entity.money - totalCost);
    entity.items.push({ ...item, price, surcharge, totalCost, round: game.auction.roundIndex });
    game.auction.winners.push({
      round: game.auction.roundIndex,
      item,
      winnerId: entity.id,
      winnerName: entity.name,
      price,
      surcharge,
      totalCost,
      institution,
      reason
    });
    addNotification(`${entity.name} thắng ${item.name} với tổng chi $${totalCost}.`, 'success');
  } else {
    game.auction.winners.push({
      round: game.auction.roundIndex,
      item,
      winnerId: null,
      winnerName: 'Không có người thắng',
      price: 0,
      surcharge: 0,
      totalCost: 0,
      institution,
      reason
    });
    addNotification(`${item.name} không có người thắng.`, 'info');
  }

  game.auction.active = false;
  game.auction.leaderEntityId = null;
  game.auction.leaderName = '--';
  game.auction.currentPrice = item.reservePrice;
  game.auction.flash = null;

  if (game.auction.roundIndex >= AUCTION_ROUNDS) {
    finishGame();
  }

  broadcastState();
}

function finishGame() {
  game.phase = 'result';
  game.auction.active = false;
  addNotification('Trò chơi kết thúc. Bảng xếp hạng cuối đã sẵn sàng.', 'gold');
}

io.on('connection', (socket) => {
  socket.emit('state:update', getStateFor(socket));

  socket.on('player:join', ({ name, groupName, sessionToken } = {}, acknowledge = () => {}) => {
    const cleanToken = String(sessionToken || '').trim();
    const returningPlayer = cleanToken
      ? Object.values(game.players).find((p) => p.sessionToken === cleanToken)
      : null;

    if (returningPlayer) {
      socket.data.playerId = returningPlayer.id;
      returningPlayer.online = true;
      clearEmptyRoomTimer();

      for (const otherSocket of io.sockets.sockets.values()) {
        if (otherSocket.id !== socket.id && otherSocket.data.playerId === returningPlayer.id) {
          otherSocket.disconnect(true);
        }
      }

      acknowledge({
        ok: true,
        name: returningPlayer.name,
        groupName: game.teams[returningPlayer.teamId]?.name || '',
        sessionToken: returningPlayer.sessionToken,
        resumed: true
      });
      broadcastState();
      return;
    }

    // Automatic reconnects send only the private token. If the server has
    // restarted and no longer knows it, fail quietly and show the join form.
    if (!visibleName(name)) {
      acknowledge({ ok: false, error: 'Phiên chơi đã hết hạn.' });
      return;
    }

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

    const group = findOrCreateGroup(groupName);
    if (!group) {
      socket.emit('notification', { tone: 'error', text: 'Vui lòng nhập tên nhóm ngay từ đầu.' });
      acknowledge({ ok: false, error: 'Vui lòng nhập tên nhóm ngay từ đầu.' });
      return;
    }

    const names = onlinePlayers().map((p) => p.name.toLowerCase());
    const original = cleanName;
    let count = 2;
    while (names.includes(cleanName.toLowerCase())) {
      cleanName = `${original} ${count}`;
      count += 1;
    }

    const playerId = id('player');
    const newSessionToken = id('session');
    socket.data.playerId = playerId;
    clearEmptyRoomTimer();
    game.players[playerId] = {
      id: playerId,
      sessionToken: newSessionToken,
      name: cleanName,
      money: 0,
      online: true,
      quizIndex: 0,
      quizDone: false,
      answered: false,
      lastAnswer: null,
      teamId: group.id
    };
    group.members.push(playerId);

    if (!game.hostId) game.hostId = playerId;
    addNotification(`${cleanName} đã vào phòng.`, 'info');
    acknowledge({ ok: true, name: cleanName, groupName: group.name, sessionToken: newSessionToken });
    broadcastState();
  });

  socket.on('host:claim', () => {
    const player = playerForSocket(socket);
    if (!player) {
      socket.emit('notification', { tone: 'error', text: 'Bạn cần vào phòng trước.' });
      return;
    }
    game.hostId = player.id;
    addNotification(`${player.name} hiện là chủ phòng.`, 'gold');
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
      p.lastAnswer = null;
    }
    game.entities = {};
    game.auction = createInitialGame().auction;
    game.questionIds = selectQuestionIds();
    game.phase = 'quiz';
    addNotification(`Game bắt đầu. Mỗi người chơi trả lời ${QUESTION_COUNT} câu hỏi.`, 'gold');
    broadcastState();
  });

  socket.on('quiz:answer', ({ answerIndex, questionIndex } = {}) => {
    const p = playerForSocket(socket);
    if (!p || game.phase !== 'quiz' || p.quizDone) return;
    if (Number(questionIndex) !== p.quizIndex) return;
    const question = getQuestion(p.quizIndex);
    if (!question) return;

    const correct = Number(answerIndex) === question.correctIndex;
    if (correct) p.money += QUIZ_CORRECT_BONUS;
    p.lastAnswer = {
      correct,
      selectedIndex: Number(answerIndex),
      correctIndex: question.correctIndex,
      bonus: correct ? QUIZ_CORRECT_BONUS : 0
    };
    p.quizIndex += 1;

    if (p.quizIndex >= QUESTION_COUNT) {
      p.quizDone = true;
      addNotification(`${p.name} đã hoàn thành phần câu hỏi với ${p.money} coin.`, 'success');
    }

    socket.emit('notification', {
      tone: correct ? 'success' : 'error',
      text: correct ? `Đúng! Nhóm của bạn được cộng ${QUIZ_CORRECT_BONUS} coin.` : 'Chưa chính xác. Câu này không được cộng coin.'
    });

    if (allQuizDone()) {
      finalizeAuctionParticipants();
      game.phase = 'auction';
      addNotification('Tất cả nhóm đã hoàn thành phần câu hỏi. Chuyển sang đấu giá đất.', 'gold');
    }

    broadcastState();
  });

  socket.on('auction:startRound', () => startAuctionRound(socket));

  socket.on('auction:setInstitution', ({ institutionId } = {}) => {
    if (!requireHost(socket)) return;
    if (game.phase !== 'auction' || game.auction.active) return;
    const institution = INSTITUTIONS.find((entry) => entry.id === institutionId);
    if (!institution) return;
    game.auction.institutionId = institution.id;
    addNotification(`Ban tổ chức chọn thể chế: ${institution.name}.`, 'gold');
    broadcastState();
  });

  socket.on('auction:recordBid', ({ entityId, amount } = {}) => {
    if (!requireHost(socket)) return;
    if (game.phase !== 'auction' || !game.auction.active) return;

    const entity = game.entities[entityId];
    if (!entity) {
      socket.emit('auction:bidRejected', { reason: 'Hãy chọn đúng nhóm vừa trả giá.' });
      return;
    }

    const bidAmount = Math.round(Number(amount));
    const minimumBid = game.auction.currentPrice + BID_STEP;
    if (!Number.isFinite(bidAmount) || bidAmount < minimumBid) {
      socket.emit('auction:bidRejected', { reason: `Mức giá mới phải từ ${minimumBid} coin.` });
      return;
    }

    const institution = INSTITUTIONS.find((entry) => entry.id === game.auction.institutionId) || INSTITUTIONS[0];
    if (institution.ownershipLimit !== null && entity.items.length >= institution.ownershipLimit) {
      socket.emit('auction:bidRejected', { reason: `${entity.name} đã đạt giới hạn sở hữu của thể chế vòng này.` });
      return;
    }

    const projectedCost = bidAmount + Math.round(bidAmount * institution.surchargeRate);
    if (entity.money < projectedCost) {
      socket.emit('auction:bidRejected', { reason: `${entity.name} không đủ quỹ. Tổng chi dự kiến là ${projectedCost} coin.` });
      return;
    }

    const now = Date.now();
    game.auction.currentPrice = bidAmount;
    game.auction.leaderEntityId = entity.id;
    game.auction.leaderName = entity.name;
    game.auction.lastBidAt = now;
    game.auction.bidLedger.push({
      id: id('bid'),
      round: game.auction.roundIndex,
      entityId: entity.id,
      entityName: entity.name,
      amount: bidAmount,
      at: now
    });
    game.auction.flash = { id: id('flash'), name: entity.name, price: bidAmount, at: now };

    io.emit('auction:bidAccepted', { name: entity.name, price: bidAmount, at: now });
    broadcastState();
  });

  socket.on('auction:closeRound', () => {
    if (!requireHost(socket)) return;
    closeAuctionRound('host');
  });

  socket.on('feedback:submit', ({ rating, policyChange, comment } = {}, acknowledge = () => {}) => {
    const player = playerForSocket(socket);
    if (!player || game.phase !== 'result') {
      acknowledge({ ok: false, error: 'Chỉ góp ý sau khi đấu giá kết thúc.' });
      return;
    }

    const cleanPolicyChange = String(policyChange || '').trim().slice(0, 160);
    const cleanComment = String(comment || '').trim().slice(0, 500);
    const cleanRating = Math.min(5, Math.max(1, Math.round(Number(rating) || 0)));
    if (!cleanPolicyChange && !cleanComment) {
      acknowledge({ ok: false, error: 'Hãy nhập ít nhất một ý kiến.' });
      return;
    }

    const entry = {
      id: id('feedback'),
      playerId: player.id,
      playerName: player.name,
      groupName: game.teams[player.teamId]?.name || 'Không rõ nhóm',
      rating: cleanRating,
      policyChange: cleanPolicyChange,
      comment: cleanComment,
      at: Date.now()
    };
    game.feedback = [entry, ...game.feedback.filter((item) => item.playerId !== player.id)];
    acknowledge({ ok: true });
    broadcastState();
  });

  socket.on('game:reset', () => {
    if (!requireHost(socket)) return;
    const oldPlayers = Object.values(game.players)
      .filter((p) => p.online)
      .map((p) => ({ id: p.id, name: p.name, sessionToken: p.sessionToken, teamId: p.teamId, online: true }));
    const oldTeams = Object.values(game.teams).map((team) => ({ ...team, members: [...team.members] }));
    const oldHostId = game.hostId;
    game = createInitialGame();
    for (const p of oldPlayers) {
      game.players[p.id] = {
        id: p.id,
        name: p.name,
        sessionToken: p.sessionToken,
        money: 0,
        online: true,
        quizIndex: 0,
        quizDone: false,
        answered: false,
        lastAnswer: null,
        teamId: p.teamId
      };
    }
    for (const team of oldTeams) {
      const members = team.members.filter((playerId) => game.players[playerId]);
      if (members.length) game.teams[team.id] = { ...team, members };
    }
    game.hostId = game.players[oldHostId] ? oldHostId : oldPlayers[0]?.id || null;
    addNotification('Game đã được reset.', 'gold');
    broadcastState();
  });

  socket.on('disconnect', () => {
    const p = playerForSocket(socket);
    if (p) {
      p.online = playerHasConnection(p.id);
      if (!p.online) addNotification(`${p.name} đã rời phòng.`, 'info');
    }
    ensureHost();
    broadcastState();
    scheduleEmptyRoomReset();
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
