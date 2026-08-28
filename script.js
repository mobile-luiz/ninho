(function(){
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ];

  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  let audioCtx = null;
  function ensureAudio(){ if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  function beep(freq, duration, muted){
    if (muted) return;
    ensureAudio();
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + duration);
  }
  function addLog(listEl, msg, type){
    const li = document.createElement('li');
    li.className = 'tag-' + type;
    const time = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const label = type === 'alert' ? 'alerta' : (type === 'warn' ? 'aviso' : 'info');
    li.innerHTML = `<span>${msg}</span><span class="tag">${label} · ${time}</span>`;
    listEl.prepend(li);
    while (listEl.children.length > 40) listEl.removeChild(listEl.lastChild);
  }
  function generateCode(){
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  document.getElementById('pickCrib').addEventListener('click', () => startMode('crib'));
  document.getElementById('pickParent').addEventListener('click', () => startMode('parent'));

  function startMode(mode){
    document.getElementById('modeSelect').classList.add('hidden');
    if (mode === 'crib'){
      document.getElementById('cribView').classList.remove('hidden');
      initCrib();
    } else {
      document.getElementById('parentView').classList.remove('hidden');
      initParent();
    }
  }

  /* ---------------- MODO BERÇO ---------------- */
  function initCrib(){
    const video = document.getElementById('cribVideo');
    const captureCanvas = document.getElementById('captureCanvas');
    const ctx = captureCanvas.getContext('2d', { willReadFrequently: true });
    const ring = document.getElementById('cribRing');
    const waveCanvas = document.getElementById('cribWave');
    const waveCtx = waveCanvas.getContext('2d');
    const alertBanner = document.getElementById('cribAlertBanner');
    const roiOverlay = document.getElementById('roiOverlay');
    const calibrateBtn = document.getElementById('calibrateBtn');
    const muteBtn = document.getElementById('cribMuteBtn');
    const sensitivityInput = document.getElementById('sensitivity');
    const silenceTimeoutInput = document.getElementById('silenceTimeout');
    const silenceTimeoutLabel = document.getElementById('silenceTimeoutLabel');
    const log = document.getElementById('cribLog');
    const placeholder = document.getElementById('cribPlaceholder');
    const codeLabel = document.getElementById('cribCode');
    const connState = document.getElementById('cribConnState');
    const remoteAudioEl = document.getElementById('cribRemoteAudio');

    let roi = { x: 0.25, y: 0.18, w: 0.5, h: 0.55 };
    let prevFrame = null, running = false, muted = false;
    let silentSince = null, alerting = false, lastHighMotionLog = 0, lastAlertBeep = 0;
    const waveHistory = []; const WAVE_MAX = 160;
    const circumference = 2 * Math.PI * 100;
    ring.style.strokeDasharray = circumference; ring.style.strokeDashoffset = circumference;

    let localStream = null, peer = null, dataConn = null;
    const code = generateCode();
    codeLabel.textContent = code;

    function drawRoiBox(){
      roiOverlay.querySelectorAll('.roi-box').forEach(el => el.remove());
      const box = document.createElement('div');
      box.className = 'roi-box';
      box.style.left = (roi.x*100)+'%'; box.style.top=(roi.y*100)+'%'; box.style.width=(roi.w*100)+'%'; box.style.height=(roi.h*100)+'%';
      roiOverlay.appendChild(box);
    }
    drawRoiBox();

    function sendData(msg){ if (dataConn && dataConn.open) dataConn.send(msg); }

    async function startCameraAndPeer(){
      try{
        localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
        video.srcObject = localStream;
        await video.play();
        running = true;
        statusPill.classList.add('live'); statusText.textContent = 'Aguardando responsável…';
        connState.textContent = 'Câmera pronta — aguardando o responsável conectar';
        addLog(log, 'Câmera ativada. Aguardando conexão do responsável.', 'info');
        requestAnimationFrame(loop);
      }catch(err){
        connState.textContent = 'Não foi possível acessar a câmera/microfone';
        addLog(log, 'Falha ao acessar câmera: ' + err.message, 'warn');
        return;
      }

      peer = new Peer('ninho-' + code, { config: { iceServers: ICE_SERVERS } });
      peer.on('open', () => { addLog(log, 'Pronto para conectar. Código: ' + code, 'info'); });
      peer.on('call', call => {
        call.answer(localStream);
        call.on('stream', remoteStream => { remoteAudioEl.srcObject = remoteStream; });
        connState.textContent = 'Responsável conectado';
      });
      peer.on('connection', conn => {
        dataConn = conn;
        dataConn.on('open', () => {
          placeholder.classList.add('hidden');
          statusText.textContent = 'Monitorando · responsável conectado';
          addLog(log, 'Responsável conectado.', 'info');
        });
        dataConn.on('close', () => {
          statusText.textContent = 'Monitorando · responsável desconectado';
          addLog(log, 'Responsável desconectou.', 'warn');
        });
      });
      peer.on('error', err => addLog(log, 'Erro de conexão: ' + err.type, 'warn'));
    }
    startCameraAndPeer();

    let lastTick = 0, lastSend = 0;
    function loop(ts){
      if (!running) return;
      requestAnimationFrame(loop);
      if (ts - lastTick < 100) return;
      lastTick = ts;

      const w = captureCanvas.width, h = captureCanvas.height;
      ctx.save(); ctx.translate(w,0); ctx.scale(-1,1); ctx.drawImage(video,0,0,w,h); ctx.restore();
      const rx = Math.floor(roi.x*w), ry = Math.floor(roi.y*h);
      const rw = Math.max(4, Math.floor(roi.w*w)), rh = Math.max(4, Math.floor(roi.h*h));
      const frame = ctx.getImageData(rx, ry, rw, rh);

      let motion = 0;
      if (prevFrame && prevFrame.width === frame.width && prevFrame.height === frame.height){
        let diffSum = 0; const a = frame.data, b = prevFrame.data;
        for (let i=0;i<a.length;i+=4){ diffSum += Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]); }
        motion = diffSum / ((a.length/4)*255*3);
      }
      prevFrame = frame;

      const sensitivity = parseInt(sensitivityInput.value,10);
      const gain = sensitivity/5;
      const normalized = Math.min(1, motion*40*gain);

      updateRing(ring, normalized, alerting);
      pushWave(waveCanvas, waveCtx, waveHistory, WAVE_MAX, normalized, alerting);
      evaluateAlerts(normalized);

      if (ts - lastSend > 150){ sendData({ type:'motion', value: normalized }); lastSend = ts; }
    }

    function evaluateAlerts(value){
      const noMovementThreshold = 0.035, highMovementThreshold = 0.55;
      const silenceTimeoutMs = parseInt(silenceTimeoutInput.value,10)*1000;
      const now = Date.now();
      if (value < noMovementThreshold){
        if (silentSince === null) silentSince = now;
        const elapsed = now - silentSince;
        if (elapsed > silenceTimeoutMs){
          if (!alerting){
            alerting = true; ring.classList.add('alerting'); alertBanner.classList.add('show');
            statusPill.classList.add('alert'); statusPill.classList.remove('live');
            statusText.textContent = 'Alerta: sem movimento';
            const msg = 'Nenhum movimento detectado por mais de ' + Math.round(silenceTimeoutMs/1000) + 's.';
            addLog(log, msg, 'alert'); sendData({type:'event', msg, tag:'alert'}); sendData({type:'alerting', state:true});
            beep(880,0.4,muted); lastAlertBeep = now;
          } else if (now - lastAlertBeep > 4000){ beep(880,0.4,muted); lastAlertBeep = now; }
        }
      } else {
        if (alerting){
          alerting = false; ring.classList.remove('alerting'); alertBanner.classList.remove('show');
          statusPill.classList.remove('alert'); statusPill.classList.add('live');
          statusText.textContent = 'Monitorando · responsável conectado';
          addLog(log, 'Movimento retomado.', 'info'); sendData({type:'event', msg:'Movimento retomado.', tag:'info'}); sendData({type:'alerting', state:false});
        }
        silentSince = null;
      }
      if (value > highMovementThreshold && now - lastHighMotionLog > 8000){
        const msg = 'Bastante movimento detectado — bebê pode estar acordado.';
        addLog(log, msg, 'warn'); sendData({type:'event', msg, tag:'warn'}); lastHighMotionLog = now;
      }
    }

    silenceTimeoutInput.addEventListener('input', () => { silenceTimeoutLabel.textContent = silenceTimeoutInput.value + ' segundos'; });
    muteBtn.addEventListener('click', () => { muted = !muted; muteBtn.textContent = muted ? '🔇 Som desativado' : '🔊 Som ativado'; muteBtn.classList.toggle('active', muted); });

    let calibrating = false, dragStart = null;
    calibrateBtn.addEventListener('click', () => {
      calibrating = !calibrating;
      calibrateBtn.classList.toggle('active', calibrating);
      calibrateBtn.textContent = calibrating ? 'Arraste sobre o vídeo para definir a zona' : 'Ajustar zona de observação';
      roiOverlay.classList.toggle('editing', calibrating);
    });
    function pointerPos(e){
      const rect = roiOverlay.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: Math.min(1,Math.max(0,(clientX-rect.left)/rect.width)), y: Math.min(1,Math.max(0,(clientY-rect.top)/rect.height)) };
    }
    roiOverlay.addEventListener('mousedown', e => { if (calibrating) dragStart = pointerPos(e); });
    roiOverlay.addEventListener('mousemove', e => {
      if (!calibrating || !dragStart) return;
      const p = pointerPos(e);
      const x = Math.min(dragStart.x,p.x), y = Math.min(dragStart.y,p.y), w = Math.abs(p.x-dragStart.x), h = Math.abs(p.y-dragStart.y);
      if (w>0.03 && h>0.03){ roi = {x,y,w,h}; drawRoiBox(); }
    });
    window.addEventListener('mouseup', () => {
      if (!calibrating || !dragStart) return;
      dragStart = null; calibrating = false; calibrateBtn.classList.remove('active');
      calibrateBtn.textContent = 'Ajustar zona de observação'; roiOverlay.classList.remove('editing');
      prevFrame = null; addLog(log, 'Zona de observação atualizada.', 'info');
    });
  }

  /* ---------------- MODO RESPONSÁVEL ---------------- */
  function initParent(){
    const video = document.getElementById('parentVideo');
    const ring = document.getElementById('parentRing');
    const waveCanvas = document.getElementById('parentWave');
    const waveCtx = waveCanvas.getContext('2d');
    const alertBanner = document.getElementById('parentAlertBanner');
    const placeholder = document.getElementById('parentPlaceholder');
    const codeInput = document.getElementById('codeInput');
    const connectBtn = document.getElementById('connectBtn');
    const talkBtn = document.getElementById('talkBtn');
    const muteBtn = document.getElementById('parentMuteBtn');
    const log = document.getElementById('parentLog');

    const waveHistory = []; const WAVE_MAX = 160;
    const circumference = 2 * Math.PI * 100;
    ring.style.strokeDasharray = circumference; ring.style.strokeDashoffset = circumference;
    let muted = false, alerting = false, lastAlertBeep = 0;
    let peer = null, dataConn = null, call = null, micStream = null;

    connectBtn.addEventListener('click', () => {
      const code = codeInput.value.trim().toUpperCase();
      if (code.length < 4) return;
      connect(code);
    });

    async function connect(code){
      statusText.textContent = 'Conectando…';
      try{
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getAudioTracks()[0].enabled = false; // começa mudo (empurra-para-falar)
      }catch(err){
        addLog(log, 'Sem microfone disponível — só será possível ouvir e ver.', 'warn');
      }
      peer = new Peer({ config: { iceServers: ICE_SERVERS } });
      peer.on('open', () => {
        dataConn = peer.connect('ninho-' + code);
        dataConn.on('open', () => {
          placeholder.classList.add('hidden');
          statusPill.classList.add('live'); statusText.textContent = 'Conectado ao berço';
          addLog(log, 'Conectado ao berço.', 'info');
        });
        dataConn.on('data', handleData);
        dataConn.on('close', () => { statusText.textContent = 'Desconectado do berço'; statusPill.classList.remove('live'); addLog(log, 'Conexão com o berço encerrada.', 'warn'); });

        call = peer.call('ninho-' + code, micStream || new MediaStream());
        call.on('stream', remoteStream => { video.srcObject = remoteStream; video.play(); });
      });
      peer.on('error', err => addLog(log, 'Erro de conexão: ' + err.type, 'warn'));
    }

    function handleData(data){
      if (data.type === 'motion'){ updateRing(ring, data.value, alerting); pushWave(waveCanvas, waveCtx, waveHistory, WAVE_MAX, data.value, alerting); }
      else if (data.type === 'event'){ addLog(log, data.msg, data.tag); }
      else if (data.type === 'alerting'){
        alerting = data.state;
        ring.classList.toggle('alerting', alerting);
        alertBanner.classList.toggle('show', alerting);
        if (alerting){ beep(880,0.4,muted); lastAlertBeep = Date.now(); }
      }
      if (alerting && Date.now() - lastAlertBeep > 4000){ beep(880,0.4,muted); lastAlertBeep = Date.now(); }
    }

    function setTalking(on){
      if (!micStream) return;
      micStream.getAudioTracks()[0].enabled = on;
      talkBtn.classList.toggle('talking', on);
      talkBtn.textContent = on ? '🎙️ Falando…' : '🎙️ Segure para falar com o bebê';
    }
    talkBtn.addEventListener('mousedown', () => setTalking(true));
    talkBtn.addEventListener('mouseup', () => setTalking(false));
    talkBtn.addEventListener('mouseleave', () => setTalking(false));
    talkBtn.addEventListener('touchstart', e => { e.preventDefault(); setTalking(true); });
    talkBtn.addEventListener('touchend', e => { e.preventDefault(); setTalking(false); });

    muteBtn.addEventListener('click', () => {
      muted = !muted;
      video.muted = muted;
      muteBtn.textContent = muted ? '🔇 Som desativado' : '🔊 Som ativado';
      muteBtn.classList.toggle('active', muted);
    });
  }

  /* ---------------- Funções compartilhadas de visual ---------------- */
  function updateRing(ringEl, value, alerting){
    const circumference = 2 * Math.PI * 100;
    ringEl.style.strokeDashoffset = circumference * (1 - value);
    ringEl.classList.toggle('alerting', !!alerting);
  }
  function pushWave(canvasEl, waveCtx, history, maxPoints, value, alerting){
    history.push(value);
    if (history.length > maxPoints) history.shift();
    const cw = canvasEl.clientWidth, ch = canvasEl.clientHeight;
    if (canvasEl.width !== cw) canvasEl.width = cw;
    if (canvasEl.height !== ch) canvasEl.height = ch;
    waveCtx.clearRect(0,0,cw,ch);
    waveCtx.beginPath();
    waveCtx.strokeStyle = alerting ? '#F2707C' : '#86D9C4';
    waveCtx.lineWidth = 2;
    const step = cw / (maxPoints - 1);
    history.forEach((v,i) => { const x = i*step, y = ch - (v*(ch-10)) - 5; if (i===0) waveCtx.moveTo(x,y); else waveCtx.lineTo(x,y); });
    waveCtx.stroke();
  }
})();
