// ── Board corners ──
  ['bcBR','bcTL'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    for (let i = 0; i < 64; i++) {
      const d = document.createElement('div');
      d.className = 'sq' + (((Math.floor(i/8)+i%8)%2===0)?' l':'');
      el.appendChild(d);
    }
  });

  // ── Canvas engine ──
  const canvas = document.getElementById('c');
  const ctx    = canvas.getContext('2d');
  const PIECES = ['♟','♜','♞','♝','♛','♚'];
  let W, H;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Rising chess pieces ──
  const pieces = [];
  function makeP(randY) {
    return {
      x:    Math.random() * W,
      y:    randY ? Math.random() * H : H + 50,
      vy:   -(0.22 + Math.random() * 0.52),
      vx:   (Math.random() - 0.5) * 0.15,
      rot:  Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.004,
      size: 16 + Math.random() * 24,
      op:   0,
      maxOp: 0.22 + Math.random() * 0.28,   // BRIGHTER: was 0.05-0.14
      piece: PIECES[Math.floor(Math.random() * PIECES.length)],
      life: 0, maxLife: 260 + Math.random() * 200,
      fading: false,
    };
  }
  for (let i = 0; i < 32; i++) pieces.push(makeP(true));

  // ── Sparkle dots ──
  const sparks = [];
  function makeSpark() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.6 + Math.random() * 1.4,
      op: 0,
      maxOp: 0.18 + Math.random() * 0.35,
      life: 0,
      maxLife: 70 + Math.random() * 110,
      fading: false,
    };
  }
  for (let i = 0; i < 70; i++) sparks.push(makeSpark());

  // ── Trailing orbs (slow drifting glows) ──
  const orbs = [];
  function makeOrb() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r:  40 + Math.random() * 80,
      op: 0,
      maxOp: 0.04 + Math.random() * 0.05,
      life: 0, maxLife: 300 + Math.random() * 400,
      fading: false,
    };
  }
  for (let i = 0; i < 6; i++) orbs.push(makeOrb());

  // ── Gold streak lines ──
  const streaks = [];
  function makeStreak() {
    const x = Math.random() * W;
    return {
      x, y: H + 10,
      vy: -(1.5 + Math.random() * 2.5),
      len: 40 + Math.random() * 80,
      op: 0,
      maxOp: 0.12 + Math.random() * 0.18,
      fading: false,
      life: 0, maxLife: 60 + Math.random() * 80,
    };
  }
  // spawn streaks occasionally
  let streakTimer = 0;

  function draw(ts) {
    ctx.clearRect(0,0,W,H);

    // orbs
    orbs.forEach((o, i) => {
      if (!o.fading) {
        o.op = Math.min(o.op + 0.0003, o.maxOp);
        o.life++;
        if (o.life > o.maxLife) o.fading = true;
      } else { o.op -= 0.0002; }
      if (o.op <= 0) { orbs[i] = makeOrb(); return; }
      o.x += o.vx; o.y += o.vy;
      // bounce off edges
      if (o.x < -o.r || o.x > W+o.r) o.vx *= -1;
      if (o.y < -o.r || o.y > H+o.r) o.vy *= -1;

      const g = ctx.createRadialGradient(o.x,o.y,0, o.x,o.y,o.r);
      g.addColorStop(0, `rgba(212,168,67,${o.op})`);
      g.addColorStop(1, 'rgba(212,168,67,0)');
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x,o.y,o.r,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    });

    // sparkles
    sparks.forEach((s, i) => {
      if (!s.fading) {
        s.op = Math.min(s.op + 0.006, s.maxOp);
        s.life++;
        if (s.life > s.maxLife) s.fading = true;
      } else { s.op -= 0.004; }
      if (s.op <= 0) { sparks[i] = makeSpark(); return; }
      ctx.save();
      ctx.globalAlpha = s.op;
      // cross sparkle shape
      ctx.fillStyle = '#f5cc58';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
      if (s.r > 1) {
        ctx.strokeStyle = '#f5cc58';
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = s.op * 0.5;
        ctx.beginPath();
        ctx.moveTo(s.x - s.r*2.5, s.y); ctx.lineTo(s.x + s.r*2.5, s.y);
        ctx.moveTo(s.x, s.y - s.r*2.5); ctx.lineTo(s.x, s.y + s.r*2.5);
        ctx.stroke();
      }
      ctx.restore();
    });

    // streak lines
    streakTimer++;
    if (streakTimer > 28) { streaks.push(makeStreak()); streakTimer = 0; }
    for (let i = streaks.length-1; i >= 0; i--) {
      const s = streaks[i];
      if (!s.fading) {
        s.op = Math.min(s.op + 0.015, s.maxOp);
        s.life++;
        if (s.life > s.maxLife) s.fading = true;
      } else { s.op -= 0.01; }
      if (s.op <= 0) { streaks.splice(i,1); continue; }
      s.y += s.vy;
      ctx.save();
      ctx.globalAlpha = s.op;
      const sg = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.len);
      sg.addColorStop(0, 'rgba(245,204,88,0)');
      sg.addColorStop(0.4, 'rgba(245,204,88,1)');
      sg.addColorStop(1, 'rgba(245,204,88,0)');
      ctx.strokeStyle = sg;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y + s.len);
      ctx.stroke();
      ctx.restore();
    }

    // rising pieces
    pieces.forEach((p, i) => {
      if (!p.fading) {
        p.op = Math.min(p.op + 0.0015, p.maxOp);
        p.life++;
        if (p.life > p.maxLife) p.fading = true;
      } else { p.op -= 0.001; }
      if (p.op <= 0 || p.y < -60) { pieces[i] = makeP(false); return; }
      p.x += p.vx; p.y += p.vy; p.rot += p.vrot;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.op);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      // glow under piece
      ctx.shadowColor = '#d4a843';
      ctx.shadowBlur  = 18;
      ctx.font = p.size + 'px serif';
      ctx.fillStyle = '#f0c050';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.piece, 0, 0);
      ctx.restore();
    });

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
