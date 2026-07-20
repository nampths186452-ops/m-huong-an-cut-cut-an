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
const AUCTION_ROUNDS = 5;
const AUCTION_START_PRICE = 100;

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
  },
  {
    id: 'land_industrial',
    code: 'LÔ D-21',
    name: 'Đất công nghiệp Tân Phát',
    location: 'Cụm sản xuất phía Bắc của thành phố giả định',
    area: '320 m²',
    purpose: 'Sản xuất – kho vận',
    advantage: 'Gần tuyến vận tải, khả năng khai thác dài hạn',
    reservePrice: 550,
    bonus: 1_000
  },
  {
    id: 'land_tourism',
    code: 'LÔ E-30',
    name: 'Đất du lịch Đồi Ánh Dương',
    location: 'Khu cảnh quan trên đồi của thành phố giả định',
    area: '450 m²',
    purpose: 'Du lịch – nghỉ dưỡng',
    advantage: 'Quỹ đất lớn, cảnh quan đẹp và giá trị cao nhất',
    reservePrice: 700,
    bonus: 1_300
  }
];

const LAND_REWARDS = [
  { id: 'five_points', label: '+5 điểm', icon: '⭐', tone: 'points' },
  { id: 'one_point', label: '+1 điểm', icon: '✨', tone: 'points' },
  { id: 'gift_one', label: 'Quà', icon: '🎁', tone: 'gift' },
  { id: 'gift_two', label: 'Quà', icon: '🎁', tone: 'gift' },
  { id: 'penalty', label: 'Phạt', icon: '⚠️', tone: 'penalty' }
];

function shuffled(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

const rooms = new Map();

const createInitialGame = ({ roomCode, admin }) => ({
  roomCode,
  admin,
  phase: 'lobby',
  questionIds: [],
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
    flash: null
  },
  landReveals: shuffled(LAND_REWARDS).map((reward, index) => ({
    lotId: AUCTION_ITEMS[index].id,
    reward,
    revealed: false
  }))
});

function id(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

function selectQuestionIds() {
  return QUESTION_BANK.map((_, index) => index);
}

function getQuestion(game, index) {
  return QUESTION_BANK[game.questionIds[index]];
}

function visibleName(rawName) {
  return String(rawName || '').trim().slice(0, 28);
}

function findOrCreateGroup(game, rawGroupName) {
  const groupName = visibleName(rawGroupName);
  if (!groupName) return null;
  const existing = Object.values(game.teams)
    .find((team) => team.name.toLowerCase() === groupName.toLowerCase());
  if (existing) return existing;

  const team = { id: id('group'), name: groupName, members: [] };
  game.teams[team.id] = team;
  return team;
}

function onlinePlayers(game) {
  return Object.values(game.players).filter((p) => p.online);
}

function gameForSocket(socket) {
  return rooms.get(socket.data.roomCode) || null;
}

function playerForSocket(game, socket) {
  if (!game) return null;
  return game.players[socket.data.playerId] || null;
}

function playerHasConnection(game, playerId) {
  return Array.from(io.sockets.sockets.values())
    .some((connectedSocket) => connectedSocket.data.roomCode === game.roomCode && connectedSocket.data.playerId === playerId);
}

function roomChannel(roomCode) {
  return `room:${roomCode}`;
}

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function passwordDigest(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function passwordMatches(password, admin) {
  const supplied = Buffer.from(passwordDigest(password, admin.passwordSalt), 'hex');
  const expected = Buffer.from(admin.passwordHash, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function addNotification(game, text, tone = 'info') {
  game.notifications.unshift({ id: id('note'), text, tone, at: Date.now() });
  game.notifications = game.notifications.slice(0, 8);
}

function requireAdmin(socket) {
  const game = gameForSocket(socket);
  if (!game || socket.data.role !== 'admin' || socket.data.adminId !== game.admin.id) {
    socket.emit('notification', { tone: 'error', text: 'Chỉ tài khoản Admin của phòng mới thực hiện được thao tác này.' });
    return false;
  }
  return game;
}

function publicPlayer(game, p) {
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

function getLeaderboard(game) {
  return Object.values(game.players)
    .map((player) => publicPlayer(game, player))
    .sort((a, b) => b.money - a.money || a.name.localeCompare(b.name));
}

function getEntitiesLeaderboard(game) {
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

function buildSelfState(game, playerId) {
  const p = game.players[playerId];
  if (!p) return null;
  const currentQuestion = getQuestion(game, p.quizIndex);
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
    ...publicPlayer(game, p),
    role: 'player',
    question,
    lastAnswer: p.lastAnswer || null,
    entityId: getEntityByPlayerId(game, p.id)?.id || null
  };
}

function getEntityByPlayerId(game, playerId) {
  return Object.values(game.entities || {}).find((entity) => entity.members.includes(playerId));
}

function getStateFor(socket, game) {
  const isAdmin = socket.data.role === 'admin' && socket.data.adminId === game.admin.id;
  return {
    roomCode: game.roomCode,
    adminName: game.admin.username,
    phase: game.phase,
    maxPlayers: MAX_PLAYERS,
    rules: {
      questionCount: QUESTION_COUNT,
      auctionRounds: AUCTION_ROUNDS,
      auctionStartPrice: AUCTION_START_PRICE
    },
    players: getLeaderboard(game),
    teams: Object.values(game.teams).map((t) => ({
      ...t,
      money: t.members.reduce((sum, playerId) => sum + (game.players[playerId]?.money || 0), 0)
    })),
    entities: getEntitiesLeaderboard(game),
    landLots: AUCTION_ITEMS,
    auction: { ...game.auction },
    notifications: game.notifications,
    landReveals: game.landReveals.map((entry) => ({
      lotId: entry.lotId,
      revealed: entry.revealed,
      reward: entry.revealed ? entry.reward : null
    })),
    self: isAdmin
      ? { id: game.admin.id, name: game.admin.username, role: 'admin' }
      : buildSelfState(game, socket.data.playerId)
  };
}

function broadcastState(game) {
  if (!game) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.roomCode === game.roomCode) socket.emit('state:update', getStateFor(socket, game));
  }
}

function allQuizDone(game) {
  const players = onlinePlayers(game);
  return players.length > 0 && players.every((p) => p.quizDone);
}

function finalizeAuctionParticipants(game) {
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
  const game = requireAdmin(socket);
  if (!game) return;
  if (game.phase !== 'auction') return;
  if (game.auction.active) return;
  if (game.auction.roundIndex >= AUCTION_ROUNDS) {
    finishGame(game);
    return;
  }

  const nextIndex = game.auction.roundIndex + 1;
  const item = AUCTION_ITEMS[nextIndex - 1];
  game.auction = {
    ...game.auction,
    roundIndex: nextIndex,
    active: true,
    currentPrice: item.reservePrice,
    leaderEntityId: null,
    leaderName: '--',
    lastBidAt: Date.now(),
    item,
    flash: null
  };

  addNotification(game, `Vòng đấu giá ${nextIndex} đã bắt đầu.`, 'gold');
  broadcastState(game);
}

function closeAuctionRound(game, reason = 'admin') {
  if (game.phase !== 'auction' || !game.auction.active) return;
  const item = game.auction.item;
  const leaderId = game.auction.leaderEntityId;
  const price = game.auction.currentPrice;

  if (leaderId && game.entities[leaderId]) {
    const entity = game.entities[leaderId];
    entity.items.push({ ...item, price: 0, referencePrice: price, round: game.auction.roundIndex });
    game.auction.winners.push({
      round: game.auction.roundIndex,
      item,
      winnerId: entity.id,
      winnerName: entity.name,
      price: 0,
      referencePrice: price,
      reason
    });
    addNotification(game, `${entity.name} thắng ${item.name}. Hệ thống không trừ coin.`, 'success');
  } else {
    game.auction.winners.push({
      round: game.auction.roundIndex,
      item,
      winnerId: null,
      winnerName: 'Không có người thắng',
      price: 0,
      reason
    });
    addNotification(game, `${item.name} không có người thắng.`, 'info');
  }

  game.auction.active = false;
  game.auction.leaderEntityId = null;
  game.auction.leaderName = '--';
  game.auction.currentPrice = item.reservePrice;
  game.auction.flash = null;

  if (game.auction.roundIndex >= AUCTION_ROUNDS) {
    finishGame(game);
  }

  broadcastState(game);
}

function finishGame(game) {
  game.phase = 'result';
  game.auction.active = false;
  addNotification(game, 'Trò chơi kết thúc. Bảng xếp hạng cuối đã sẵn sàng.', 'gold');
}

io.on('connection', (socket) => {
  function attachToRoom(game, identity) {
    if (socket.data.roomCode) socket.leave(roomChannel(socket.data.roomCode));
    socket.data.roomCode = game.roomCode;
    socket.data.role = identity.role;
    socket.data.playerId = identity.playerId || null;
    socket.data.adminId = identity.adminId || null;
    socket.join(roomChannel(game.roomCode));
  }

  function disconnectDuplicate(identityKey, identityValue, roomCode) {
    for (const otherSocket of io.sockets.sockets.values()) {
      if (otherSocket.id !== socket.id && otherSocket.data.roomCode === roomCode && otherSocket.data[identityKey] === identityValue) {
        otherSocket.disconnect(true);
      }
    }
  }

  socket.on('admin:create', ({ username, password } = {}, acknowledge = () => {}) => {
    const cleanUsername = visibleName(username);
    const cleanPassword = String(password || '');
    if (cleanUsername.length < 3) {
      acknowledge({ ok: false, error: 'Tên tài khoản Admin cần ít nhất 3 ký tự.' });
      return;
    }
    if (cleanPassword.length < 4) {
      acknowledge({ ok: false, error: 'Mật khẩu Admin cần ít nhất 4 ký tự.' });
      return;
    }

    const roomCode = generateRoomCode();
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const admin = {
      id: id('admin'),
      username: cleanUsername,
      passwordSalt,
      passwordHash: passwordDigest(cleanPassword, passwordSalt),
      sessionToken: id('admin_session'),
      online: true
    };
    const game = createInitialGame({ roomCode, admin });
    rooms.set(roomCode, game);
    attachToRoom(game, { role: 'admin', adminId: admin.id });
    addNotification(game, `Phòng ${roomCode} đã được tạo bởi Admin ${admin.username}.`, 'gold');
    acknowledge({ ok: true, role: 'admin', username: admin.username, roomCode, sessionToken: admin.sessionToken });
    broadcastState(game);
  });

  socket.on('admin:login', ({ roomCode, username, password } = {}, acknowledge = () => {}) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const game = rooms.get(code);
    if (!game || game.admin.username.toLowerCase() !== visibleName(username).toLowerCase() || !passwordMatches(password, game.admin)) {
      acknowledge({ ok: false, error: 'Mã phòng, tài khoản hoặc mật khẩu Admin không đúng.' });
      return;
    }
    game.admin.online = true;
    game.admin.sessionToken = id('admin_session');
    attachToRoom(game, { role: 'admin', adminId: game.admin.id });
    disconnectDuplicate('adminId', game.admin.id, code);
    acknowledge({ ok: true, role: 'admin', username: game.admin.username, roomCode: code, sessionToken: game.admin.sessionToken });
    broadcastState(game);
  });

  socket.on('admin:resume', ({ roomCode, sessionToken } = {}, acknowledge = () => {}) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const game = rooms.get(code);
    if (!game || !sessionToken || sessionToken !== game.admin.sessionToken) {
      acknowledge({ ok: false, error: 'Phiên Admin đã hết hạn.' });
      return;
    }
    game.admin.online = true;
    attachToRoom(game, { role: 'admin', adminId: game.admin.id });
    disconnectDuplicate('adminId', game.admin.id, code);
    acknowledge({ ok: true, role: 'admin', username: game.admin.username, roomCode: code, sessionToken });
    broadcastState(game);
  });

  socket.on('player:join', ({ roomCode, groupName, sessionToken } = {}, acknowledge = () => {}) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const game = rooms.get(code);
    if (!game) {
      acknowledge({ ok: false, error: 'Mã phòng không tồn tại hoặc phòng đã kết thúc.' });
      return;
    }
    const cleanToken = String(sessionToken || '').trim();
    const returningPlayer = cleanToken
      ? Object.values(game.players).find((p) => p.sessionToken === cleanToken)
      : null;

    if (returningPlayer) {
      attachToRoom(game, { role: 'player', playerId: returningPlayer.id });
      returningPlayer.online = true;
      disconnectDuplicate('playerId', returningPlayer.id, code);

      acknowledge({
        ok: true,
        role: 'player',
        name: returningPlayer.name,
        groupName: game.teams[returningPlayer.teamId]?.name || '',
        roomCode: code,
        sessionToken: returningPlayer.sessionToken,
        resumed: true
      });
      broadcastState(game);
      return;
    }

    // Automatic reconnects send only the private token. If the server has
    // restarted and no longer knows it, fail quietly and show the join form.
    if (cleanToken) {
      acknowledge({ ok: false, error: 'Phiên chơi đã hết hạn.' });
      return;
    }

    if (game.phase !== 'lobby') {
      socket.emit('notification', { tone: 'error', text: 'Game đã bắt đầu. Vui lòng chờ ván sau.' });
      acknowledge({ ok: false, error: 'Game đã bắt đầu. Vui lòng chờ ván sau.' });
      return;
    }
    if (onlinePlayers(game).length >= MAX_PLAYERS) {
      socket.emit('notification', { tone: 'error', text: 'Phòng đã đủ người chơi.' });
      acknowledge({ ok: false, error: 'Phòng đã đủ người chơi.' });
      return;
    }

    const group = findOrCreateGroup(game, groupName);
    if (!group) {
      socket.emit('notification', { tone: 'error', text: 'Vui lòng nhập tên nhóm ngay từ đầu.' });
      acknowledge({ ok: false, error: 'Vui lòng nhập tên nhóm ngay từ đầu.' });
      return;
    }

    const groupMemberNumber = group.members.length + 1;
    const cleanName = groupMemberNumber === 1 ? group.name : `${group.name} (${groupMemberNumber})`;

    const playerId = id('player');
    const newSessionToken = id('session');
    attachToRoom(game, { role: 'player', playerId });
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

    addNotification(game, `${group.name} đã vào phòng.`, 'info');
    acknowledge({ ok: true, role: 'player', name: cleanName, groupName: group.name, roomCode: code, sessionToken: newSessionToken });
    broadcastState(game);
  });

  socket.on('game:start', () => {
    const game = requireAdmin(socket);
    if (!game) return;
    if (game.phase !== 'lobby') return;
    if (onlinePlayers(game).length < 1) {
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
    game.auction = createInitialGame({ roomCode: game.roomCode, admin: game.admin }).auction;
    game.questionIds = selectQuestionIds();
    game.phase = 'quiz';
    addNotification(game, `Game bắt đầu. Mỗi nhóm trả lời ${QUESTION_COUNT} câu hỏi.`, 'gold');
    broadcastState(game);
  });

  socket.on('quiz:answer', ({ answerIndex, questionIndex } = {}) => {
    const game = gameForSocket(socket);
    const p = socket.data.role === 'player' ? playerForSocket(game, socket) : null;
    if (!p || game.phase !== 'quiz' || p.quizDone) return;
    if (Number(questionIndex) !== p.quizIndex) return;
    const question = getQuestion(game, p.quizIndex);
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
      addNotification(game, `${p.name} đã hoàn thành phần câu hỏi với ${p.money} coin.`, 'success');
    }

    socket.emit('notification', {
      tone: correct ? 'success' : 'error',
      text: correct ? `Đúng! Nhóm của bạn được cộng ${QUIZ_CORRECT_BONUS} coin.` : 'Chưa chính xác. Câu này không được cộng coin.'
    });

    if (allQuizDone(game)) {
      finalizeAuctionParticipants(game);
      game.phase = 'auction';
      addNotification(game, 'Tất cả nhóm đã hoàn thành phần câu hỏi. Chuyển sang đấu giá đất.', 'gold');
    }

    broadcastState(game);
  });

  socket.on('game:skipToAuction', () => {
    const game = requireAdmin(socket);
    if (!game || game.phase !== 'quiz') return;
    finalizeAuctionParticipants(game);
    game.phase = 'auction';
    addNotification(game, 'Admin đã chuyển trò chơi sang phần đấu giá.', 'gold');
    broadcastState(game);
  });

  socket.on('auction:startRound', () => startAuctionRound(socket));

  socket.on('auction:bid', () => {
    const game = gameForSocket(socket);
    const player = socket.data.role === 'player' ? playerForSocket(game, socket) : null;
    if (!player) return;
    if (game.phase !== 'auction' || !game.auction.active) return;

    const entity = getEntityByPlayerId(game, player.id);
    if (!entity) {
      socket.emit('auction:bidRejected', { reason: 'Bạn chưa thuộc nhóm đấu giá.' });
      return;
    }

    const now = Date.now();
    game.auction.leaderEntityId = entity.id;
    game.auction.leaderName = entity.name;
    game.auction.lastBidAt = now;
    game.auction.flash = { id: id('flash'), name: entity.name, at: now };

    io.to(roomChannel(game.roomCode)).emit('auction:bidAccepted', { name: entity.name, at: now });
    broadcastState(game);
  });

  socket.on('auction:closeRound', () => {
    const game = requireAdmin(socket);
    if (!game) return;
    closeAuctionRound(game, 'admin');
  });

  socket.on('result:flipLand', ({ index } = {}) => {
    const game = requireAdmin(socket);
    if (!game || game.phase !== 'result') return;
    const revealIndex = Number(index);
    const entry = game.landReveals[revealIndex];
    if (!entry || entry.revealed) return;
    entry.revealed = true;
    addNotification(game, `Admin đã lật ô đất số ${revealIndex + 1}: ${entry.reward.label}.`, 'gold');
    broadcastState(game);
  });

  socket.on('game:reset', () => {
    const game = requireAdmin(socket);
    if (!game) return;
    const oldPlayers = Object.values(game.players)
      .filter((p) => p.online)
      .map((p) => ({ id: p.id, name: p.name, sessionToken: p.sessionToken, teamId: p.teamId, online: true }));
    const oldTeams = Object.values(game.teams).map((team) => ({ ...team, members: [...team.members] }));
    const resetGame = createInitialGame({ roomCode: game.roomCode, admin: game.admin });
    for (const p of oldPlayers) {
      resetGame.players[p.id] = {
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
      const members = team.members.filter((playerId) => resetGame.players[playerId]);
      if (members.length) resetGame.teams[team.id] = { ...team, members };
    }
    rooms.set(game.roomCode, resetGame);
    addNotification(resetGame, 'Admin đã mở một phiên đấu giá mới.', 'gold');
    broadcastState(resetGame);
  });

  socket.on('admin:endRoom', () => {
    const game = requireAdmin(socket);
    if (!game) return;
    const channel = roomChannel(game.roomCode);
    io.to(channel).emit('room:ended', { text: `Phòng ${game.roomCode} đã được Admin kết thúc.` });
    rooms.delete(game.roomCode);
    for (const roomSocket of io.sockets.sockets.values()) {
      if (roomSocket.data.roomCode === game.roomCode) {
        roomSocket.leave(channel);
        roomSocket.data.roomCode = null;
        roomSocket.data.role = null;
        roomSocket.data.playerId = null;
        roomSocket.data.adminId = null;
      }
    }
  });

  socket.on('disconnect', () => {
    const game = gameForSocket(socket);
    if (!game) return;
    const p = playerForSocket(game, socket);
    if (p) {
      p.online = playerHasConnection(game, p.id);
      if (!p.online) addNotification(game, `${p.name} đã rời phòng.`, 'info');
    }
    if (socket.data.role === 'admin') game.admin.online = false;
    if (game.phase === 'quiz' && allQuizDone(game)) {
      finalizeAuctionParticipants(game);
      game.phase = 'auction';
      addNotification(game, 'Các nhóm đang online đã hoàn thành câu hỏi. Chuyển sang đấu giá đất.', 'gold');
    }
    broadcastState(game);
  });
});

app.get('/api/health', (req, res) => {
  const players = Array.from(rooms.values()).reduce((total, game) => total + onlinePlayers(game).length, 0);
  res.json({ ok: true, rooms: rooms.size, players });
});

const distPath = path.join(__dirname, 'client', 'dist');
app.use(express.static(distPath));
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Golden Hammer Auction server running at http://127.0.0.1:${PORT}`);
});
