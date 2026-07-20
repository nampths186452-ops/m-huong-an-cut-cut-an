import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const socket = io({ autoConnect: true });

function money(value = 0) {
  return `${Number(value || 0).toLocaleString('vi-VN')} coin`;
}

function App() {
  const [state, setState] = useState(null);
  const [joinedGroup, setJoinedGroup] = useState(localStorage.getItem('playerGroupName') || '');
  const [savedRoomCode, setSavedRoomCode] = useState(localStorage.getItem('roomCode') || '');
  const [toasts, setToasts] = useState([]);
  const [flash, setFlash] = useState(null);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const saveSession = (response) => {
      if (!response?.ok || !response.sessionToken) return;
      localStorage.setItem('sessionRole', response.role);
      localStorage.setItem('roomCode', response.roomCode);
      setSavedRoomCode(response.roomCode);
      if (response.role === 'admin') localStorage.setItem('adminSessionToken', response.sessionToken);
      if (response.role === 'player') localStorage.setItem('playerSessionToken', response.sessionToken);
      if (response.groupName) {
        localStorage.setItem('playerGroupName', response.groupName);
        setJoinedGroup(response.groupName);
      }
    };
    const resumeSession = () => {
      const role = localStorage.getItem('sessionRole');
      const roomCode = localStorage.getItem('roomCode');
      const eventName = role === 'admin' ? 'admin:resume' : 'player:join';
      const sessionToken = role === 'admin'
        ? localStorage.getItem('adminSessionToken')
        : localStorage.getItem('playerSessionToken');
      if (!role || !roomCode || !sessionToken) return;
      socket.timeout(8000).emit(eventName, { roomCode, sessionToken }, (error, response) => {
        if (!error && response?.ok) saveSession(response);
        if (!error && response && !response.ok) {
          clearStoredSession();
          setState(null);
        }
      });
    };
    const onConnect = () => {
      setConnected(true);
      resumeSession();
    };
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
    const onRoomEnded = (payload) => {
      clearStoredSession();
      setState(null);
      pushToast(payload?.text || 'Phòng đã kết thúc.', 'info');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('state:update', onState);
    socket.on('notification', onNotification);
    socket.on('auction:bidRejected', onBidRejected);
    socket.on('auction:bidAccepted', onBidAccepted);
    socket.on('room:ended', onRoomEnded);
    if (socket.connected) resumeSession();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('state:update', onState);
      socket.off('notification', onNotification);
      socket.off('auction:bidRejected', onBidRejected);
      socket.off('auction:bidAccepted', onBidAccepted);
      socket.off('room:ended', onRoomEnded);
    };
  }, []);

  function clearStoredSession() {
    localStorage.removeItem('sessionRole');
    localStorage.removeItem('adminSessionToken');
    localStorage.removeItem('playerSessionToken');
  }

  function pushToast(text, tone = 'info') {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((current) => [{ id, text, tone }, ...current].slice(0, 4));
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }

  const isAdmin = state?.self?.role === 'admin';
  const joined = Boolean(state?.self);

  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      {flash && <FlashOverlay flash={flash} />}
      <ToastStack toasts={toasts} />

      <div className="mx-auto max-w-7xl">
        <Header state={state} connected={connected} isAdmin={isAdmin} joined={joined} />

        {!joined ? (
          <JoinScreen joinedGroup={joinedGroup} savedRoomCode={savedRoomCode} setJoinedGroup={setJoinedGroup} setSavedRoomCode={setSavedRoomCode} connected={connected} pushToast={pushToast} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <section className="glass rounded-[2rem] p-5 md:p-8">
              {state?.phase === 'lobby' && <Lobby state={state} isAdmin={isAdmin} />}
              {state?.phase === 'quiz' && <QuizPhase state={state} isAdmin={isAdmin} />}
              {state?.phase === 'auction' && <AuctionPhase state={state} isAdmin={isAdmin} />}
              {state?.phase === 'result' && <Results state={state} isAdmin={isAdmin} />}
            </section>
            <aside className="space-y-5">
              <Leaderboard state={state} />
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function Header({ state, connected, isAdmin, joined }) {
  const phaseLabel = {
    lobby: 'Sảnh chờ',
    quiz: 'Tích lũy coin',
    auction: 'Đấu giá đất',
    result: 'Lật ô đất'
  }[state?.phase] || 'Đang kết nối';

  return (
    <header className="mb-6 flex flex-col gap-4 rounded-[2rem] border border-amber-300/20 bg-slate-950/50 p-5 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-amber-200/70">Luxury Auction Game</p>
        <h1 className="font-display mt-2 text-3xl font-extrabold text-amber-200 md:text-5xl">
          Đấu Giá Đất Theo Nhóm
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={connected ? 'success' : 'error'}>{connected ? 'Online' : 'Mất kết nối'}</Badge>
        <Badge>{phaseLabel}</Badge>
        {joined && <Badge tone="gold">Phòng: {state.roomCode}</Badge>}
        {joined && isAdmin && <Badge tone="gold">Admin</Badge>}
        {joined && isAdmin && (
          <button
            className="btn-maroon"
            onClick={() => {
              if (window.confirm(`Kết thúc phòng ${state.roomCode}? Tất cả người chơi sẽ bị đưa ra ngoài.`)) socket.emit('admin:endRoom');
            }}
          >
            Kết thúc phòng
          </button>
        )}
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

function JoinScreen({ joinedGroup, savedRoomCode, setJoinedGroup, setSavedRoomCode, connected, pushToast }) {
  const [mode, setMode] = useState('player');
  const [roomCode, setRoomCode] = useState(savedRoomCode);
  const [groupName, setGroupName] = useState(joinedGroup);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [joining, setJoining] = useState(false);

  function rememberSession(response) {
    localStorage.setItem('sessionRole', response.role);
    localStorage.setItem('roomCode', response.roomCode);
    setSavedRoomCode(response.roomCode);
    if (response.role === 'admin') localStorage.setItem('adminSessionToken', response.sessionToken);
    if (response.role === 'player') localStorage.setItem('playerSessionToken', response.sessionToken);
    if (response.groupName) {
      localStorage.setItem('playerGroupName', response.groupName);
      setJoinedGroup(response.groupName);
    }
  }

  function emitWithReply(eventName, payload) {
    setJoining(true);
    socket.timeout(8000).emit(eventName, payload, (error, response) => {
      setJoining(false);
      if (error) {
        pushToast('Máy chủ không phản hồi. Có thể Render đang khởi động, hãy thử lại sau vài giây.', 'error');
        return;
      }
      if (!response?.ok) {
        pushToast(response?.error || 'Không thể thực hiện yêu cầu.', 'error');
        return;
      }
      rememberSession(response);
      if (response.role === 'admin') pushToast(`Đã vào phòng ${response.roomCode} với quyền Admin.`, 'success');
    });
  }

  function joinPlayer(event) {
    event.preventDefault();
    const cleanCode = roomCode.trim().toUpperCase();
    const cleanGroup = groupName.trim();
    if (!cleanCode || !cleanGroup) {
      pushToast('Hãy nhập mã phòng và tên nhóm.', 'error');
      return;
    }
    if (!connected) {
      pushToast('Chưa kết nối được máy chủ. Hãy chờ trạng thái Online rồi thử lại.', 'error');
      return;
    }
    emitWithReply('player:join', { roomCode: cleanCode, groupName: cleanGroup });
  }

  function submitAdmin(event, action) {
    event.preventDefault();
    if (!username.trim() || !password) {
      pushToast('Hãy nhập tài khoản và mật khẩu Admin.', 'error');
      return;
    }
    if (action === 'login' && !roomCode.trim()) {
      pushToast('Hãy nhập mã phòng để đăng nhập Admin.', 'error');
      return;
    }
    if (!connected) {
      pushToast('Chưa kết nối được máy chủ. Hãy chờ trạng thái Online rồi thử lại.', 'error');
      return;
    }
    emitWithReply(
      action === 'create' ? 'admin:create' : 'admin:login',
      action === 'create'
        ? { username: username.trim(), password }
        : { roomCode: roomCode.trim().toUpperCase(), username: username.trim(), password }
    );
  }

  return (
    <section className="glass mx-auto max-w-2xl rounded-[2rem] p-8 text-center">
      <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-full border border-amber-300/40 bg-amber-300/10 text-4xl">🔨</div>
      <h2 className="font-display text-3xl font-bold text-amber-200">Phòng đấu giá đất</h2>
      <div className="mt-6 grid grid-cols-2 gap-3 rounded-2xl bg-black/25 p-2">
        <button className={mode === 'player' ? 'btn-gold' : 'btn-navy'} onClick={() => setMode('player')}>Người chơi</button>
        <button className={mode === 'admin' ? 'btn-gold' : 'btn-navy'} onClick={() => setMode('admin')}>Admin tổ chức</button>
      </div>

      {mode === 'player' ? (
        <form onSubmit={joinPlayer} className="mt-6 space-y-4">
          <p className="text-slate-200/80">Người chơi chỉ cần mã phòng và tên nhóm để tham gia.</p>
          <input className="input-lux text-center uppercase tracking-[0.25em]" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="MÃ PHÒNG" maxLength={6} />
          <input className="input-lux text-center" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Tên nhóm (ví dụ: Nhóm 1)" maxLength={28} />
          <button className="btn-gold w-full" type="submit" disabled={!connected || joining}>
            {joining ? 'Đang vào phòng...' : connected ? 'Vào phòng với quyền người chơi' : 'Đang kết nối máy chủ...'}
          </button>
          <p className="text-sm text-slate-300/70">Người chơi chỉ được trả lời câu hỏi lấy coin và bấm Space trong vòng đấu giá.</p>
        </form>
      ) : (
        <form className="mt-6 space-y-4">
          <p className="text-slate-200/80">Tạo tài khoản Admin để nhận mã phòng và toàn quyền điều khiển trò chơi.</p>
          <input className="input-lux text-center" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tài khoản Admin" maxLength={28} autoComplete="username" />
          <input className="input-lux text-center" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu Admin" minLength={4} autoComplete="current-password" />
          <button className="btn-gold w-full" type="button" disabled={!connected || joining} onClick={(event) => submitAdmin(event, 'create')}>
            {joining ? 'Đang xử lý...' : 'Tạo tài khoản Admin và phòng mới'}
          </button>
          <div className="flex items-center gap-3 py-1 text-sm text-slate-400"><span className="h-px flex-1 bg-white/10" />Hoặc đăng nhập lại<span className="h-px flex-1 bg-white/10" /></div>
          <input className="input-lux text-center uppercase tracking-[0.25em]" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="MÃ PHÒNG ĐÃ TẠO" maxLength={6} />
          <button className="btn-navy w-full" type="button" disabled={!connected || joining} onClick={(event) => submitAdmin(event, 'login')}>Đăng nhập Admin</button>
        </form>
      )}
    </section>
  );
}

function Lobby({ state, isAdmin }) {
  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Giai đoạn 1" title="Các nhóm tham gia từ đầu" />
      {isAdmin && (
        <div className="rounded-3xl border border-amber-300/30 bg-amber-300/10 p-6 text-center">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-amber-200/70">Mã phòng gửi cho người chơi</p>
          <div className="font-display mt-2 text-5xl font-black tracking-[0.2em] text-amber-100">{state.roomCode}</div>
          <button
            className="btn-navy mt-4"
            onClick={() => navigator.clipboard?.writeText(state.roomCode)}
          >
            Sao chép mã phòng
          </button>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {state.teams.map((team) => {
          const members = team.members.map((id) => state.players.find((player) => player.id === id)).filter(Boolean);
          return (
            <div key={team.id} className="card p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-2xl font-bold text-amber-200">{team.name}</h3>
                <span className="rounded-full bg-amber-300/15 px-3 py-1 text-sm font-bold text-amber-100">{members.length} thành viên</span>
              </div>
              <div className="mt-3 text-slate-200/80">{members.map((member) => member.name).join(', ')}</div>
            </div>
          );
        })}
      </div>
      <div className="rounded-3xl border border-amber-300/15 bg-black/20 p-5">
        <p className="text-slate-200/80">Số người chơi: <b className="text-amber-200">{state.players.length}/{state.maxPlayers}</b> · Số nhóm: <b className="text-amber-200">{state.teams.length}</b></p>
        <p className="mt-2 text-sm text-slate-300/70">Mỗi thành viên trả lời câu hỏi để góp coin vào quỹ chung của nhóm. Không có bước lập đội sau đó.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {isAdmin ? (
            <button className="btn-gold" onClick={() => socket.emit('game:start')}>Bắt đầu tích lũy coin</button>
          ) : (
            <p className="font-bold text-amber-100">Đang chờ Admin bắt đầu trò chơi…</p>
          )}
        </div>
      </div>
    </div>
  );
}

function QuizPhase({ state, isAdmin }) {
  if (isAdmin) {
    const completed = state.players.filter((player) => player.quizDone).length;
    return (
      <div className="space-y-6">
        <SectionTitle eyebrow="Bảng điều khiển Admin" title="Theo dõi phần trả lời câu hỏi" />
        <div className="card p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Đã hoàn thành" value={`${completed}/${state.players.length} nhóm`} />
            <Stat label="Mã phòng" value={state.roomCode} />
          </div>
          <p className="mt-4 text-slate-300/80">Trò chơi tự chuyển sang đấu giá khi các nhóm hoàn thành. Admin có thể chuyển sớm nếu cần.</p>
          <button className="btn-gold mt-4" onClick={() => socket.emit('game:skipToAuction')}>Chuyển sang đấu giá</button>
        </div>
      </div>
    );
  }

  const self = state.self;
  const question = self?.question;

  if (self?.quizDone) {
    return (
      <div className="space-y-5 text-center">
        <SectionTitle eyebrow="Hoàn tất" title={`Bạn đã trả lời ${state.rules.questionCount} câu hỏi`} />
        <p className="text-xl text-slate-200">Bạn đã góp vào quỹ nhóm: <b className="text-amber-200">{money(self.money)}</b></p>
        <p className="text-slate-300/80">Vui lòng chờ các thành viên và nhóm khác hoàn thành.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow={`Câu ${question?.index + 1 || 1}/${question?.total || state.rules.questionCount}`} title="Trả lời để tích lũy coin cho nhóm" />
      {question?.chapter && <p className="text-sm font-bold uppercase tracking-[0.16em] text-amber-200/70">{question.chapter}</p>}
      <div className="card p-6">
        <p className="text-2xl font-extrabold leading-relaxed text-amber-100">{question?.text}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {question?.options.map((option, index) => (
          <button key={option} className="rounded-2xl border border-amber-300/20 bg-slate-950/50 p-5 text-left text-lg font-bold text-slate-100 transition hover:-translate-y-1 hover:bg-amber-300/10" onClick={() => socket.emit('quiz:answer', { answerIndex: index, questionIndex: question.index })}>
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
      {self.lastAnswer.correct ? `Chính xác! Quỹ nhóm được cộng ${money(self.lastAnswer.bonus)}.` : 'Chưa chính xác. Câu này không được cộng coin.'}
    </div>
  );
}

function AuctionPhase({ state, isAdmin }) {
  const auction = state.auction;
  const selfEntity = state.entities.find((entity) => entity.id === state.self?.entityId);
  const canBuzz = auction.active && selfEntity;
  const visibleLot = auction.item || state.landLots[auction.roundIndex] || state.landLots.at(-1);

  useEffect(() => {
    function handleKeyDown(event) {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || !canBuzz) return;
      if (event.code === 'Space') {
        event.preventDefault();
        socket.emit('auction:bid');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canBuzz]);

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Giai đoạn 3" title="Đấu giá các lô đất" />

      <div className="card overflow-hidden">
        <div className="land-banner p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full border border-amber-200/40 bg-amber-100/15 px-4 py-2 font-black text-amber-100">VÒNG {auction.active ? auction.roundIndex : Math.min(auction.roundIndex + 1, state.rules.auctionRounds)}/{state.rules.auctionRounds}</span>
            <span className="text-sm font-bold text-amber-100/80">{auction.active ? 'ĐANG ĐẤU GIÁ' : 'CHỜ BAN TỔ CHỨC MỞ VÒNG'}</span>
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-[1fr_220px] md:items-end">
            <div>
              <div className="text-sm font-black uppercase tracking-[0.25em] text-amber-200/70">{visibleLot?.code}</div>
              <h3 className="font-display mt-2 text-4xl font-extrabold text-amber-100">{visibleLot?.name}</h3>
              <p className="mt-3 text-lg text-slate-100/85">📍 {visibleLot?.location}</p>
            </div>
            <Stat label="Giá trị bonus" value={money(visibleLot?.bonus)} />
          </div>
        </div>

        <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Diện tích" value={visibleLot?.area || '--'} />
          <Stat label="Mục đích sử dụng" value={visibleLot?.purpose || '--'} />
          <Stat label="Giá khởi điểm tham khảo" value={money(visibleLot?.reservePrice || 0)} />
          <Stat label="Cách tham gia" value="Bấm Space" />
        </div>
        <p className="px-6 pb-6 text-slate-200/80"><b>Lợi thế:</b> {visibleLot?.advantage}</p>
      </div>

      <div className="card p-5">
        <h3 className="font-display text-2xl font-bold text-amber-200">Bấm Space giành quyền ra giá</h3>
        <p className="mt-2 text-slate-300/80">Mọi nhóm có thể bấm Space liên tục. Mỗi lần bấm sẽ cập nhật nhóm vừa giành quyền ra giá; chỉ dừng khi người tổ chức chốt vòng. Hệ thống không trừ coin.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Stat label="Nhóm vừa bấm Space" value={auction.leaderName || '--'} />
          <Stat label="Quỹ nhóm của bạn" value={money(selfEntity?.money || 0)} />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          {isAdmin && !auction.active && auction.roundIndex < state.rules.auctionRounds && <button className="btn-gold" onClick={() => socket.emit('auction:startRound')}>Mở vòng đấu giá</button>}
          {!isAdmin && auction.active && <button className="btn-gold text-lg" disabled={!canBuzz} onClick={() => socket.emit('auction:bid')}>BẤM SPACE</button>}
          {isAdmin && auction.active && <button className="btn-maroon" onClick={() => socket.emit('auction:closeRound')}>Chốt giá và kết thúc vòng</button>}
        </div>
        {auction.active && <p className="mt-3 text-sm text-amber-100">Space vẫn mở cho tất cả nhóm cho đến khi vòng được chốt.</p>}
      </div>

      <div className="card p-6">
        <h3 className="font-display text-center text-3xl font-bold text-amber-200">Thẻ tình huống trong đấu giá</h3>
        <p className="mt-2 text-center text-slate-300/80">
          Các thẻ chạy song song với vòng đấu giá. Chỉ Admin được lật; toàn bộ người chơi sẽ nhìn thấy nội dung sau khi lật.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {state.auctionPolicyCards.map((card) => (
            <button
              key={card.id}
              className={`land-flip-card policy-flip-card ${card.revealed ? 'is-flipped' : ''}`}
              onClick={() => socket.emit('auction:flipPolicyCard', { cardId: card.id })}
              disabled={!isAdmin || !auction.active || card.revealed}
              aria-label={card.revealed ? `${card.title}: ${card.detail}` : `Lật thẻ ${card.title}`}
            >
              <span className="land-flip-inner policy-flip-inner">
                <span className="land-flip-face land-flip-front policy-flip-front">
                  <span className="text-5xl">{card.icon}</span>
                  <span className="font-display mt-4 text-2xl font-black text-amber-100">{card.title}</span>
                  <span className="mt-4 text-sm font-bold text-slate-300">{isAdmin ? (auction.active ? 'Bấm để lật thẻ' : 'Mở vòng để sử dụng') : 'Chờ Admin lật thẻ'}</span>
                </span>
                <span className="land-flip-face land-flip-back policy-flip-back">
                  <span className="text-4xl">{card.icon}</span>
                  <span className="font-display mt-3 text-xl font-black text-amber-100">{card.title}</span>
                  <span className="mt-3 text-base font-semibold leading-relaxed text-slate-100">{card.detail || 'Nội dung đang được giữ kín'}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-4 text-center text-sm text-amber-100/75">Các thẻ tự úp lại khi Admin mở vòng đấu giá tiếp theo.</p>
      </div>
    </div>
  );
}

function Results({ state, isAdmin }) {
  const ranking = state.entities.length > 0 ? state.entities : [];
  const winner = ranking[0];
  const landIcons = ['🌊', '🏙️', '🏛️', '🏭', '⛰️'];

  return (
    <div className="space-y-6">
      <SectionTitle eyebrow="Giai đoạn 4" title="Tổng kết và lật 5 ô đất" />
      <div className="rounded-[2rem] border border-amber-300/30 bg-amber-300/10 p-8 text-center">
        <div className="text-6xl">🏆</div>
        <h2 className="font-display mt-4 text-4xl font-extrabold text-amber-100">Chúc mừng {winner?.name || 'người thắng cuộc'}!</h2>
        <p className="mt-3 text-xl text-slate-200">Giá trị cuối cùng: <b className="text-amber-200">{money(winner?.finalScore || 0)}</b></p>
      </div>

      <div className="card p-5">
        <h3 className="font-display text-2xl font-bold text-amber-200">Kết quả đấu giá</h3>
        <div className="mt-4 grid gap-3">
          {state.auction.winners.map((winner) => (
            <div key={winner.round} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="font-display text-xl font-bold text-amber-100">Vòng {winner.round}: {winner.item?.name}</div>
              <div className="text-slate-200">Người thắng: <b>{winner.winnerName}</b></div>
              {winner.winnerId && <div className="text-slate-300/80">Không trừ coin · Bonus đất: {money(winner.item?.bonus || 0)}</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h3 className="font-display text-center text-3xl font-bold text-amber-200">Lật ô đất nhận kết quả bí mật</h3>
        <p className="mt-2 text-center text-slate-300/80">Năm ô chứa ngẫu nhiên: 5 điểm, 1 điểm, hai phần quà và một hình phạt.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {state.landReveals.map((entry, index) => {
            const lot = state.landLots.find((item) => item.id === entry.lotId);
            const lotWinner = state.auction.winners.find((item) => item.item?.id === entry.lotId);
            return (
              <button key={entry.lotId} className={`land-flip-card ${entry.revealed ? 'is-flipped' : ''}`} onClick={() => socket.emit('result:flipLand', { index })} disabled={entry.revealed || !isAdmin} aria-label={entry.revealed ? `Ô đất ${index + 1}: ${entry.reward?.label}` : `Lật ô đất ${index + 1}`}>
                <span className="land-flip-inner">
                  <span className="land-flip-face land-flip-front">
                    <span className="land-card-image">{landIcons[index]}</span>
                    <span className="text-xs font-black uppercase tracking-[0.18em] text-amber-200/70">{lot?.code}</span>
                    <span className="font-display mt-2 text-lg font-bold text-amber-100">{lot?.name}</span>
                    <span className="mt-2 text-xs text-emerald-200">{lotWinner?.winnerId ? `Thuộc về ${lotWinner.winnerName}` : 'Chưa có chủ sở hữu'}</span>
                    <span className="mt-3 text-sm text-slate-300">{isAdmin ? 'Bấm để lật' : 'Chờ Admin lật'}</span>
                  </span>
                  <span className={`land-flip-face land-flip-back reward-${entry.reward?.tone || 'hidden'}`}>
                    <span className="text-5xl">{entry.reward?.icon || '❓'}</span>
                    <span className="font-display mt-3 text-2xl font-black">{entry.reward?.label || 'Bí mật'}</span>
                    <span className="mt-2 text-sm">{lotWinner?.winnerId ? lotWinner.winnerName : 'Không có người thắng'}</span>
                    <span className="mt-2 text-xs uppercase tracking-[0.2em]">Ô đất {index + 1}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {isAdmin && <button className="btn-gold" onClick={() => socket.emit('game:reset')}>Mở phiên đấu giá mới</button>}
    </div>
  );
}

function Leaderboard({ state }) {
  const rows = state?.phase === 'auction' || state?.phase === 'result'
    ? state.entities
    : state?.teams || [];

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
                  <div className="text-xs text-slate-400">Nhóm · {row.members?.length || 0} thành viên</div>
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
        <div className="mt-3 text-2xl font-black text-emerald-200">Giành quyền ra giá trước!</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
