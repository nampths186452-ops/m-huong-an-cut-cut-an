import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const socket = io({ autoConnect: true });

function money(value = 0) {
  return `$${Number(value || 0).toLocaleString('en-US')}`;
}

function App() {
  const [state, setState] = useState(null);
  const [joinedName, setJoinedName] = useState(localStorage.getItem('playerName') || '');
  const [toasts, setToasts] = useState([]);
  const [flash, setFlash] = useState(null);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onConnectError = (error) => {
      setConnected(false);
      pushToast(`Không kết nối được máy chủ: ${error.message}`, 'error');
    };
    const onState = (nextState) => setState(nextState);
    const onNotification = (payload) => pushToast(payload.text, payload.tone);
    const onBidRejected = (payload) => pushToast(payload.reason || 'Bid không hợp lệ.', 'error');
    const onBidAccepted = (payload) => {
      setFlash(payload);
      setTimeout(() => setFlash(null), 1050);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('state:update', onState);
    socket.on('notification', onNotification);
    socket.on('auction:bidRejected', onBidRejected);
    socket.on('auction:bidAccepted', onBidAccepted);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('state:update', onState);
      socket.off('notification', onNotification);
      socket.off('auction:bidRejected', onBidRejected);
      socket.off('auction:bidAccepted', onBidAccepted);
    };
  }, []);

  function pushToast(text, tone = 'info') {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((current) => [{ id, text, tone }, ...current].slice(0, 4));
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }

  const isHost = Boolean(state?.self && state?.hostId === state.self.id);
  const joined = Boolean(state?.self);

  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      {flash && <FlashOverlay flash={flash} />}
      <ToastStack toasts={toasts} />

      <div className="mx-auto max-w-7xl">
        <Header state={state} connected={connected} isHost={isHost} joined={joined} />

        {!joined ? (
          <JoinScreen joinedName={joinedName} setJoinedName={setJoinedName} connected={connected} pushToast={pushToast} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <section className="glass rounded-[2rem] p-5 md:p-8">
              {state?.phase === 'lobby' && <Lobby state={state} isHost={isHost} />}
              {state?.phase === 'quiz' && <QuizPhase state={state} />}
              {state?.phase === 'team' && <TeamPhase state={state} isHost={isHost} />}
              {state?.phase === 'auction' && <AuctionPhase state={state} isHost={isHost} />}
              {state?.phase === 'result' && <Results state={state} isHost={isHost} />}
            </section>
            <aside className="space-y-5">
              <Leaderboard state={state} />
              <HostPanel state={state} isHost={isHost} />
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function Header({ state, connected, isHost, joined }) {
  const phaseLabel = {
    lobby: 'Sảnh chờ',
    quiz: 'Quiz & Mở hộp',
    team: 'Ghép đội',
    auction: 'Đấu giá',
    result: 'Tổng kết'
  }[state?.phase] || 'Đang kết nối';

  return (
    <header className="mb-6 flex flex-col gap-4 rounded-[2rem] border border-amber-300/20 bg-slate-950/50 p-5 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-amber-200/70">Luxury Auction Game</p>
        <h1 className="font-display mt-2 text-3xl font-extrabold text-amber-200 md:text-5xl">
          Money Mash & Secret Auction
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={connected ? 'success' : 'error'}>{connected ? 'Online' : 'Mất kết nối'}</Badge>
        <Badge>{phaseLabel}</Badge>
        {joined && isHost && <Badge tone="gold">Chủ phòng</Badge>}
      </div>
    </header>
  );
}

function Badge({ children, tone = 'info' }) {
  const classes = {
    info: 'border-sky-300/20 bg-sky-300/10 text-sky-100',
    success: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100',
    error: 'border-red-300/20 bg-red-300/10 text-red-100',
    gold: 'border-amber-300/30 bg-amber-300/15 text-amber-100'
  };
  return <span className={`rounded-full border px-3 py-1 font-bold ${classes[tone] || classes.info}`}>{children}</span>;
}

function JoinScreen({ joinedName, setJoinedName, connected, pushToast }) {
  const [name, setName] = useState(joinedName);
  const [joining, setJoining] = useState(false);

  function submit(event) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    if (!connected) {
      pushToast('Chưa kết nối được máy chủ. Hãy chờ trạng thái Online rồi thử lại.', 'error');
      return;
    }
    localStorage.setItem('playerName', clean);
    setJoinedName(clean);
    setJoining(true);
    socket.timeout(8000).emit('player:join', { name: clean }, (error, response) => {
      setJoining(false);
      if (error) {
        pushToast('Máy chủ không phản hồi. Có thể Render đang khởi động, hãy thử lại sau vài giây.', 'error');
        return;
      }
      if (!response?.ok) pushToast(response?.error || 'Không thể vào phòng.', 'error');
    });
  }

  return (
    <section className="glass mx-auto max-w-xl rounded-[2rem] p-8 text-center">
      <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-full border border-amber-300/40 bg-amber-300/10 text-4xl">🔨</div>
      <h2 className="font-display text-3xl font-bold text-amber-200">Vào nhà đấu giá</h2>
      <p className="mt-3 text-slate-200/80">Nhập tên để vào phòng chơi cùng mọi người.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input className="input-lux text-center" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên người chơi" maxLength={28} />
        <button className="btn-gold w-full" type="submit" disabled={!connected || joining}>
          {joining ? 'Đang vào phòng...' : connected ? 'Vào phòng' : 'Đang kết nối máy chủ...'}
        </button>
      </form>
    </section>
  );
}

function Lobby({ state, isHost }) {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Giai đoạn 1" title="Sảnh chờ người chơi" />
      <div className="grid gap-4 md:grid-cols-2">
        {state.players.map((player) => <PlayerCard key={player.id} player={player} />)}
      </div>
      <div className="rounded-3xl border border-amber-300/15 bg-black/20 p-5">
        <p className="text-slate-200/80">Số người chơi: <b className="text-amber-200">{state.players.length}/{state.maxPlayers}</b></p>
        <p className="mt-2 text-sm text-slate-300/70">Người đầu tiên vào phòng sẽ là chủ phòng. Chủ phòng bấm bắt đầu để tất cả vào phần quiz.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {isHost ? (
            <button className="btn-gold" onClick={() => socket.emit('game:start')}>Bắt đầu game</button>
          ) : (
            <button className="btn-navy" onClick={() => socket.emit('host:claim')}>Nhận quyền chủ phòng</button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuizPhase({ state }) {
  const self = state.self;
  const question = self?.question;

  if (self?.quizDone) {
    return (
      <div className="space-y-5 text-center">
        <SectionTitle eyebrow="Quiz hoàn tất" title="Bạn đã hoàn thành 5 câu hỏi" />
        <p className="text-xl text-slate-200">Số tiền hiện tại của bạn: <b className="text-amber-200">{money(self.money)}</b></p>
        <p className="text-slate-300/80">Vui lòng chờ những người chơi khác hoàn thành.</p>
      </div>
    );
  }

  if (self?.boxPending) {
    return <BoxSelection self={self} />;
  }

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow={`Câu ${question?.index + 1 || 1}/${question?.total || 5}`} title="Trả lời câu hỏi" />
      {question?.chapter && <p className="text-sm font-bold uppercase tracking-[0.16em] text-amber-200/70">{question.chapter}</p>}
      <div className="card p-6">
        <p className="text-2xl font-extrabold leading-relaxed text-amber-100">{question?.text}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {question?.options.map((option, index) => (
          <button key={option} className="rounded-2xl border border-amber-300/20 bg-slate-950/50 p-5 text-left text-lg font-bold text-slate-100 transition hover:-translate-y-1 hover:bg-amber-300/10" onClick={() => socket.emit('quiz:answer', { answerIndex: index })}>
            <span className="mr-3 text-amber-200">{String.fromCharCode(65 + index)}.</span>{option}
          </button>
        ))}
      </div>
      <AnswerFeedback self={self} />
    </div>
  );
}

function AnswerFeedback({ self }) {
  if (!self?.lastAnswer) return null;
  return (
    <div className={`rounded-3xl border p-4 ${self.lastAnswer.correct ? 'border-emerald-300/20 bg-emerald-300/10' : 'border-red-300/20 bg-red-300/10'}`}>
      {self.lastAnswer.correct ? `Chính xác! Bạn được +${money(self.lastAnswer.bonus)}.` : 'Sai rồi. Bạn vẫn được chọn một hộp may mắn.'}
    </div>
  );
}

function BoxSelection({ self }) {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Hộp may mắn" title="Chọn 1 trong 3 hộp bí mật" />
      <div className="grid gap-4 md:grid-cols-3">
        {self.boxOptions.map((box) => (
          <button key={box.index} className="gift-box p-6 text-center" onClick={() => socket.emit('quiz:chooseBox', { index: box.index })}>
            <div className="text-5xl">🎁</div>
            <div className="font-display mt-4 text-2xl font-bold text-amber-100">Hộp {box.index + 1}</div>
            <div className="mt-2 text-sm text-slate-300/70">Bấm để mở</div>
          </button>
        ))}
      </div>
      {self.lastAnswer && <AnswerFeedback self={self} />}
    </div>
  );
}

function TeamPhase({ state, isHost }) {
  const [teamName, setTeamName] = useState('');
  const [selected, setSelected] = useState([]);
  const self = state.self;
  const availablePlayers = state.players.filter((player) => !player.teamId && player.id !== self.id);

  function togglePlayer(id) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  }

  function createTeam() {
    socket.emit('team:create', { name: teamName, memberIds: selected });
    setSelected([]);
  }

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Giai đoạn 2" title="Xếp hạng & chọn đội" />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <h3 className="font-display text-2xl font-bold text-amber-200">Chơi đơn</h3>
          <p className="mt-2 text-slate-300/80">Giữ nguyên số tiền cá nhân để tham gia đấu giá.</p>
          <button className="btn-navy mt-4" disabled={self.solo || self.teamId} onClick={() => socket.emit('team:solo')}>
            {self.solo ? 'Đã chọn solo' : 'Chọn chơi đơn'}
          </button>
        </div>
        <div className="card p-5">
          <h3 className="font-display text-2xl font-bold text-amber-200">Lập đội</h3>
          <p className="mt-2 text-slate-300/80">Chọn tối đa 3 người khác. Tổng đội tối đa 4 người.</p>
          <div className="mt-4 space-y-3">
            <input className="input-lux" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Tên đội" disabled={Boolean(self.teamId)} />
            <div className="grid max-h-56 gap-2 overflow-auto pr-2 scrollbar-thin">
              {availablePlayers.length === 0 && <p className="text-sm text-slate-400">Không còn người chơi khả dụng để chọn.</p>}
              {availablePlayers.map((player) => (
                <label key={player.id} className="flex cursor-pointer items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-3">
                  <span>{player.name} <b className="text-amber-200">{money(player.money)}</b></span>
                  <input type="checkbox" checked={selected.includes(player.id)} onChange={() => togglePlayer(player.id)} disabled={Boolean(self.teamId) || (!selected.includes(player.id) && selected.length >= 3)} />
                </label>
              ))}
            </div>
            <button className="btn-gold" disabled={Boolean(self.teamId)} onClick={createTeam}>Tạo đội</button>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-display text-2xl font-bold text-amber-200">Danh sách đội</h3>
        <div className="mt-4 grid gap-3">
          {state.teams.length === 0 && <p className="text-slate-400">Chưa có đội nào.</p>}
          {state.teams.map((team) => {
            const members = team.members.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
            const total = members.reduce((sum, p) => sum + p.money, 0);
            return (
              <div key={team.id} className="rounded-2xl border border-amber-300/15 bg-black/20 p-4">
                <div className="font-display text-xl font-bold text-amber-100">{team.name}</div>
                <div className="mt-1 text-sm text-slate-300">{members.map((m) => m.name).join(', ')}</div>
                <div className="mt-2 font-black text-emerald-200">Quỹ đội: {money(total)}</div>
              </div>
            );
          })}
        </div>
        {isHost && <button className="btn-gold mt-5" onClick={() => socket.emit('auction:startPhase')}>Chuyển sang đấu giá</button>}
      </div>
    </div>
  );
}

function AuctionPhase({ state, isHost }) {
  const auction = state.auction;
  const selfEntity = state.entities.find((entity) => entity.id === state.self?.entityId);
  const nextPrice = auction.currentPrice + state.rules.bidStep;
  const canBid = auction.active && selfEntity && selfEntity.money >= nextPrice;

  useEffect(() => {
    function handleKeyDown(event) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (event.code === 'Space') {
        event.preventDefault();
        socket.emit('auction:bid');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Giai đoạn 3" title="Đấu giá hộp quà bí mật" />
      <div className="card p-6 text-center">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-amber-200/70">Vòng đấu giá</p>
        <div className="font-display mt-2 text-5xl font-extrabold text-amber-100">{auction.roundIndex || 1}/{state.rules.auctionRounds}</div>
        <div className="mx-auto mt-5 max-w-xl rounded-[2rem] border border-amber-300/25 bg-black/25 p-6">
          <div className="text-5xl">📦</div>
          <h3 className="font-display mt-3 text-3xl font-bold text-amber-200">{auction.item?.name || 'Chờ mở vòng đấu giá'}</h3>
          <p className="mt-2 text-slate-300/80">Nội dung bên trong chỉ được tiết lộ khi chốt giá.</p>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <Stat label="Giá hiện tại" value={money(auction.currentPrice)} />
          <Stat label="Người đang dẫn" value={auction.leaderName || '--'} />
          <Stat label="Giá tiếp theo" value={money(nextPrice)} />
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {isHost && !auction.active && auction.roundIndex < state.rules.auctionRounds && (
            <button className="btn-gold" onClick={() => socket.emit('auction:startRound')}>Bắt đầu vòng tiếp theo</button>
          )}
          {isHost && auction.active && (
            <button className="btn-maroon" onClick={() => socket.emit('auction:closeRound')}>Chốt giá</button>
          )}
          {auction.active && (
            <button className="btn-gold text-lg" disabled={!canBid} onClick={() => socket.emit('auction:bid')}>
              Bấm SPACE / BUZZER {canBid ? '' : '(Không đủ tiền)'}
            </button>
          )}
        </div>
        <p className="mt-4 text-sm text-slate-300/70">Vòng sẽ tự chốt nếu 10 giây không có ai bấm Space.</p>
      </div>

      <div className="card p-5">
        <h3 className="font-display text-2xl font-bold text-amber-200">Người/đội tham gia đấu giá</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {state.entities.map((entity) => (
            <div key={entity.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="font-bold text-amber-100">{entity.name}</div>
              <div className="text-sm text-slate-300/75">{entity.type === 'team' ? 'Đội' : 'Solo'} · {entity.members.length} thành viên</div>
              <div className="mt-2 font-black text-emerald-200">{money(entity.money)}</div>
              {entity.items.length > 0 && <div className="mt-2 text-sm text-amber-100/80">Đã thắng: {entity.items.map((item) => item.name).join(', ')}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Results({ state, isHost }) {
  const ranking = state.entities.length > 0 ? state.entities : [];
  const winner = ranking[0];

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Giai đoạn 4" title="Tổng kết & trao thưởng" />
      <div className="rounded-[2rem] border border-amber-300/30 bg-amber-300/10 p-8 text-center">
        <div className="text-6xl">🏆</div>
        <h2 className="font-display mt-4 text-4xl font-extrabold text-amber-100">Chúc mừng {winner?.name || 'người thắng cuộc'}!</h2>
        <p className="mt-3 text-xl text-slate-200">Tổng điểm: <b className="text-amber-200">{money(winner?.finalScore || 0)}</b></p>
      </div>

      <div className="card p-5">
        <h3 className="font-display text-2xl font-bold text-amber-200">Kết quả đấu giá</h3>
        <div className="mt-4 grid gap-3">
          {state.auction.winners.map((winner) => (
            <div key={winner.round} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="font-display text-xl font-bold text-amber-100">Vòng {winner.round}: {winner.item?.name}</div>
              <div className="text-slate-200">Người thắng: <b>{winner.winnerName}</b></div>
              {winner.winnerId && <div className="text-slate-300/80">Giá chốt: {money(winner.price)} · Thưởng: {money(winner.item?.bonus || 0)}</div>}
            </div>
          ))}
        </div>
      </div>

      {isHost && <button className="btn-gold" onClick={() => socket.emit('game:reset')}>Reset game</button>}
    </div>
  );
}

function Leaderboard({ state }) {
  const rows = state?.phase === 'auction' || state?.phase === 'result'
    ? state.entities
    : state?.players || [];

  return (
    <section className="glass rounded-[2rem] p-5">
      <h2 className="font-display text-2xl font-bold text-amber-200">Bảng xếp hạng</h2>
      <div className="mt-4 max-h-[620px] space-y-3 overflow-auto pr-1 scrollbar-thin">
        {rows.length === 0 && <p className="text-slate-400">Chưa có dữ liệu.</p>}
        {rows.map((row, index) => (
          <div key={row.id} className={`rounded-2xl border border-white/10 p-4 ${index === 0 ? 'rank-1' : 'bg-black/22'}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-amber-300/15 font-black text-amber-100">#{index + 1}</div>
                <div>
                  <div className="font-extrabold text-slate-50">{row.name}</div>
                  <div className="text-xs text-slate-400">{row.type === 'team' ? 'Đội' : row.type === 'solo' ? 'Solo' : row.online ? 'Online' : 'Offline'}</div>
                </div>
              </div>
              <div className="text-right font-black text-emerald-200">{money(row.finalScore ?? row.money)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HostPanel({ state, isHost }) {
  return (
    <section className="glass rounded-[2rem] p-5">
      <h2 className="font-display text-2xl font-bold text-amber-200">Điều phối</h2>
      <p className="mt-2 text-sm text-slate-300/80">Chủ phòng hiện tại: <b className="text-amber-100">{state.players.find((p) => p.id === state.hostId)?.name || '--'}</b></p>
      {!isHost && <button className="btn-navy mt-4 w-full" onClick={() => socket.emit('host:claim')}>Nhận quyền chủ phòng</button>}
      <div className="mt-5 space-y-2">
        {state.notifications?.slice(0, 5).map((note) => (
          <div key={note.id} className="rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-slate-200">{note.text}</div>
        ))}
      </div>
    </section>
  );
}

function PlayerCard({ player }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-bold text-slate-50">{player.name}</div>
          <div className="text-sm text-slate-400">{player.online ? 'Online' : 'Offline'}</div>
        </div>
        <div className="font-black text-emerald-200">{money(player.money)}</div>
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.32em] text-amber-200/60">{eyebrow}</p>
      <h2 className="font-display mt-2 text-3xl font-extrabold text-amber-100 md:text-4xl">{title}</h2>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
      <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-black text-amber-100">{value}</div>
    </div>
  );
}

function ToastStack({ toasts }) {
  return (
    <div className="fixed right-4 top-4 z-50 w-[min(360px,calc(100vw-2rem))] space-y-2">
      {toasts.map((toast) => (
        <div key={toast.id} className={`rounded-2xl border p-4 shadow-2xl ${toast.tone === 'error' ? 'border-red-300/30 bg-red-950/90' : toast.tone === 'success' ? 'border-emerald-300/30 bg-emerald-950/90' : 'border-amber-300/30 bg-slate-950/90'}`}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}

function FlashOverlay({ flash }) {
  return (
    <div className="flash-overlay">
      <div className="flash-card">
        <div className="font-display text-5xl font-extrabold text-amber-200">{flash.name}</div>
        <div className="mt-3 text-2xl font-black text-emerald-200">Bid thành công: {money(flash.price)}</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
