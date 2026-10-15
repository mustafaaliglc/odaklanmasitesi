/**
 * Odaklanma ve Pomodoro Uygulaması - Ana Mantık (app.js)
 * Saf JavaScript (Vanilla JS) - Herhangi bir derleme adımı gerektirmez.
 * Doğrudan tarayıcıda çalıştırılabilir.
 */

// ==========================================
// 1. Durum (State) Yönetimi & Varsayılan Ayarlar
// ==========================================

const DEFAULT_SETTINGS = {
  pomodoroTime: 25,     // dakika
  shortBreakTime: 5,    // dakika
  longBreakTime: 15,    // dakika
  longBreakInterval: 4, // 4 pomodoroda bir uzun mola
  autoStartBreaks: false,
  autoStartPomodoros: false,
  dailyGoal: 8,         // günlük hedef pomodoro sayısı
  soundType: 'zen',     // 'zen', 'digital', 'tibetan'
  soundVolume: 0.8,
  theme: 'default'      // 'default', 'sunset', 'forest', 'indigo'
};

const APP_STATE = {
  currentMode: 'pomodoro', // 'pomodoro' | 'shortBreak' | 'longBreak'
  timeLeft: 25 * 60,       // saniye cinsinden
  totalDuration: 25 * 60,  // mevcut modun tam süresi
  isRunning: false,
  timerInterval: null,
  cycleCount: 0,           // ardışık tamamlanan pomodoro sayısı (döngü için)
  activeTaskId: null,
  
  settings: { ...DEFAULT_SETTINGS },
  tasks: [],
  history: {}              // tarih -> { pomodoros: number, focusMinutes: number, sessions: [] }
};

// ==========================================
// 2. Web Audio API - Ses Sentezleyici
// (Harici dosya bağımlılığı olmadan %100 yerel ses üretimi)
// ==========================================

class SoundEngine {
  constructor() {
    this.audioCtx = null;
    this.ambientNodes = {};
    this.ambientPlaying = null;
    this.masterAmbientGain = null;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // Mola & Seans Tamamlanma Çanı
  playAlarm(type = 'zen', volume = 0.8) {
    this.init();
    if (!this.audioCtx) return;

    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(volume, now);
    masterGain.connect(ctx.destination);

    if (type === 'zen') {
      // 3 Ahenkli Harmonik Çan
      const freqs = [528, 1056, 1584];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        const amp = (0.3 / (idx + 1));
        gain.gain.setValueAtTime(amp, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now);
        osc.stop(now + 3.2);
      });
    } else if (type === 'digital') {
      // Dijital 2 tonlu uyarı
      [0, 0.18, 0.36].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880 + (i * 220), now + delay);

        gain.gain.setValueAtTime(0.25, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.15);

        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(now + delay);
        osc.stop(now + delay + 0.16);
      });
    } else if (type === 'tibetan') {
      // Derin Tibet Meditasyon Kasesi
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(261.63, now); // C4

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(264.0, now); // Hafif vuru (beat frequency)

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.5);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(masterGain);

      osc.start(now);
      osc2.start(now);
      osc.stop(now + 4.5);
      osc2.stop(now + 4.5);
    }
  }

  // Tıklama / Arayüz Geri Bildirim Sesi
  playClick() {
    this.init();
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);

    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  // Ortam Sesleri Sentezleyicisi (Yağmur, Dalga, Rüzgar, Kahve / Brown Noise)
  startAmbient(soundKey, volume = 0.5) {
    this.init();
    if (!this.audioCtx) return;

    this.stopAmbient();

    const ctx = this.audioCtx;
    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);

    if (soundKey === 'rain') {
      // Yağmur: Pembe gürültü + Lowpass filtre
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1000, ctx.currentTime);

      whiteNoise.connect(filter);
      filter.connect(gainNode);
    } else if (soundKey === 'waves') {
      // Dalga: Periyodik yükselip alçalan düşük frekans
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(400, ctx.currentTime);
      filter.Q.setValueAtTime(1.5, ctx.currentTime);

      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.setValueAtTime(0.12, ctx.currentTime); // ~8 saniyede bir dalga
      lfoGain.gain.setValueAtTime(0.3, ctx.currentTime);

      lfo.connect(lfoGain);
      lfoGain.connect(gainNode.gain);

      whiteNoise.connect(filter);
      filter.connect(gainNode);
      lfo.start();
      this.ambientNodes.lfo = lfo;
    } else if (soundKey === 'wind') {
      // Orman Rüzgarı: Resonant Lowpass
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(600, ctx.currentTime);
      filter.Q.setValueAtTime(3.0, ctx.currentTime);

      whiteNoise.connect(filter);
      filter.connect(gainNode);
    } else if (soundKey === 'brown') {
      // Brown Noise / Kafe arka plan uğultusu
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        output[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = output[i];
        output[i] *= 3.5;
      }
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, ctx.currentTime);

      whiteNoise.connect(filter);
      filter.connect(gainNode);
    }

    gainNode.connect(ctx.destination);
    whiteNoise.start();

    this.ambientNodes.source = whiteNoise;
    this.ambientNodes.gain = gainNode;
    this.ambientPlaying = soundKey;
  }

  setAmbientVolume(vol) {
    if (this.ambientNodes.gain && this.audioCtx) {
      this.ambientNodes.gain.gain.setValueAtTime(vol, this.audioCtx.currentTime);
    }
  }

  stopAmbient() {
    try {
      if (this.ambientNodes.source) {
        this.ambientNodes.source.stop();
        this.ambientNodes.source.disconnect();
      }
      if (this.ambientNodes.lfo) {
        this.ambientNodes.lfo.stop();
        this.ambientNodes.lfo.disconnect();
      }
    } catch {
      // Yok say
    }
    this.ambientNodes = {};
    this.ambientPlaying = null;
  }
}

const sounds = new SoundEngine();

// ==========================================
// 3. Yerel Depolama (LocalStorage) Yardımcıları
// ==========================================

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadFromStorage() {
  try {
    const savedSettings = localStorage.getItem('pomodoro_settings');
    if (savedSettings) {
      APP_STATE.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) };
    }

    const savedTasks = localStorage.getItem('pomodoro_tasks');
    if (savedTasks) {
      APP_STATE.tasks = JSON.parse(savedTasks);
    }

    const savedHistory = localStorage.getItem('pomodoro_history');
    if (savedHistory) {
      APP_STATE.history = JSON.parse(savedHistory);
    }
  } catch (err) {
    console.error('Veriler yüklenirken hata oluştu:', err);
  }
}

function saveToStorage() {
  try {
    localStorage.setItem('pomodoro_settings', JSON.stringify(APP_STATE.settings));
    localStorage.setItem('pomodoro_tasks', JSON.stringify(APP_STATE.tasks));
    localStorage.setItem('pomodoro_history', JSON.stringify(APP_STATE.history));
  } catch (err) {
    console.error('Veriler kaydedilirken hata oluştu:', err);
  }
}

// ==========================================
// 4. Zamanlayıcı ve Mod Mantığı
// ==========================================

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getModeTitle(mode) {
  switch (mode) {
    case 'pomodoro': return 'Odaklanma';
    case 'shortBreak': return 'Kısa Mola';
    case 'longBreak': return 'Uzun Mola';
    default: return 'Odaklanma';
  }
}

function setMode(mode, autoStart = false) {
  APP_STATE.currentMode = mode;
  clearInterval(APP_STATE.timerInterval);
  APP_STATE.isRunning = false;

  let minutes = APP_STATE.settings.pomodoroTime;
  if (mode === 'shortBreak') minutes = APP_STATE.settings.shortBreakTime;
  if (mode === 'longBreak') minutes = APP_STATE.settings.longBreakTime;

  APP_STATE.totalDuration = minutes * 60;
  APP_STATE.timeLeft = minutes * 60;

  updateThemeColors();
  updateTimerUI();
  updateModeTabsUI();
  updateCycleDotsUI();

  if (autoStart) {
    startTimer();
  }
}

function updateThemeColors() {
  const body = document.body;
  const root = document.documentElement;

  if (APP_STATE.currentMode === 'pomodoro') {
    root.style.setProperty('--current-theme', 'var(--mode-pomodoro)');
    root.style.setProperty('--current-glow', 'var(--mode-pomodoro-glow)');
    root.style.setProperty('--current-bg', 'var(--mode-pomodoro-bg)');
  } else if (APP_STATE.currentMode === 'shortBreak') {
    root.style.setProperty('--current-theme', 'var(--mode-shortBreak)');
    root.style.setProperty('--current-glow', 'var(--mode-shortBreak-glow)');
    root.style.setProperty('--current-bg', 'var(--mode-shortBreak-bg)');
  } else if (APP_STATE.currentMode === 'longBreak') {
    root.style.setProperty('--current-theme', 'var(--mode-longBreak)');
    root.style.setProperty('--current-glow', 'var(--mode-longBreak-glow)');
    root.style.setProperty('--current-bg', 'var(--mode-longBreak-bg)');
  }
}

function toggleTimer() {
  sounds.init();
  if (APP_STATE.isRunning) {
    pauseTimer();
  } else {
    startTimer();
  }
}

function startTimer() {
  if (APP_STATE.isRunning) return;
  APP_STATE.isRunning = true;
  updatePlayButtonUI();

  const startTime = Date.now();
  const initialTimeLeft = APP_STATE.timeLeft;

  APP_STATE.timerInterval = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const newTimeLeft = Math.max(0, initialTimeLeft - elapsedSeconds);

    APP_STATE.timeLeft = newTimeLeft;
    updateTimerUI();

    if (newTimeLeft <= 0) {
      clearInterval(APP_STATE.timerInterval);
      APP_STATE.isRunning = false;
      handleSessionComplete();
    }
  }, 250);
}

function pauseTimer() {
  clearInterval(APP_STATE.timerInterval);
  APP_STATE.isRunning = false;
  updatePlayButtonUI();
}

function resetTimer() {
  clearInterval(APP_STATE.timerInterval);
  APP_STATE.isRunning = false;
  APP_STATE.timeLeft = APP_STATE.totalDuration;
  updatePlayButtonUI();
  updateTimerUI();
}

function skipTimer() {
  pauseTimer();
  advanceToNextSession(false);
}

// Oturum tamamlandığında çalışan ana süreç
function handleSessionComplete() {
  const finishedMode = APP_STATE.currentMode;
  sounds.playAlarm(APP_STATE.settings.soundType, APP_STATE.settings.soundVolume);

  let nextMode = 'shortBreak';
  let notificationTitle = '';
  let notificationBody = '';

  if (finishedMode === 'pomodoro') {
    APP_STATE.cycleCount += 1;
    recordCompletedPomodoro();

    // 4 pomodoroda bir uzun mola
    const isLongBreak = (APP_STATE.cycleCount % APP_STATE.settings.longBreakInterval === 0);
    nextMode = isLongBreak ? 'longBreak' : 'shortBreak';

    notificationTitle = isLongBreak ? '🎉 Harika Seri! Uzun Mola Vakti' : '☕ Tebrikler! Kısa Mola Zamanı';
    notificationBody = `${APP_STATE.settings.pomodoroTime} dakikalık odaklanma seansını başarıyla tamamladın. Biraz dinlenmeyi hak ettin!`;

    showToast(notificationTitle, notificationBody, 'break', () => {
      setMode(nextMode, true);
    });
    sendBrowserNotification(notificationTitle, notificationBody);

    if (APP_STATE.settings.autoStartBreaks) {
      setMode(nextMode, true);
    } else {
      setMode(nextMode, false);
    }
  } else {
    // Mola tamamlandı -> Tekrar Odaklanma Modu
    nextMode = 'pomodoro';
    notificationTitle = '🎯 Mola Bitti! Çalışmaya Başla';
    notificationBody = 'Zihnini tazeledin. Şimdi yeni bir odaklanma seansına hazırsın!';

    showToast(notificationTitle, notificationBody, 'focus', () => {
      setMode('pomodoro', true);
    });
    sendBrowserNotification(notificationTitle, notificationBody);

    if (APP_STATE.settings.autoStartPomodoros) {
      setMode('pomodoro', true);
    } else {
      setMode('pomodoro', false);
    }
  }

  updateQuickStatsUI();
  updateTasksUI();
}

function advanceToNextSession(autoStart = false) {
  if (APP_STATE.currentMode === 'pomodoro') {
    const isLongBreak = ((APP_STATE.cycleCount + 1) % APP_STATE.settings.longBreakInterval === 0);
    setMode(isLongBreak ? 'longBreak' : 'shortBreak', autoStart);
  } else {
    setMode('pomodoro', autoStart);
  }
}

// ==========================================
// 5. İstatistikler & Geçmiş Kayıtları
// ==========================================

function recordCompletedPomodoro() {
  const today = getTodayString();
  if (!APP_STATE.history[today]) {
    APP_STATE.history[today] = {
      pomodoros: 0,
      focusMinutes: 0,
      sessions: []
    };
  }

  const durationMin = APP_STATE.settings.pomodoroTime;
  APP_STATE.history[today].pomodoros += 1;
  APP_STATE.history[today].focusMinutes += durationMin;

  // Aktif görev varsa onun sayacını da artır
  let taskName = 'Genel Odaklanma';
  if (APP_STATE.activeTaskId) {
    const task = APP_STATE.tasks.find(t => t.id === APP_STATE.activeTaskId);
    if (task) {
      task.pomodorosSpent = (task.pomodorosSpent || 0) + 1;
      taskName = task.title;
    }
  }

  const now = new Date();
  const timeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  APP_STATE.history[today].sessions.push({
    time: timeString,
    duration: durationMin,
    task: taskName,
    type: 'pomodoro'
  });

  saveToStorage();
}

function calculateStreak() {
  let streak = 0;
  const d = new Date();

  // Bugünden geriye doğru günleri kontrol et
  while (true) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    const record = APP_STATE.history[dateStr];
    if (record && record.pomodoros > 0) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      // Eğer bugün henüz pomodoro yapılmadıysa dünü kontrol etmeye izin ver
      if (streak === 0 && dateStr === getTodayString()) {
        d.setDate(d.getDate() - 1);
        continue;
      }
      break;
    }
  }
  return streak;
}

function getLast7DaysData() {
  const result = [];
  const daysShort = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    const record = APP_STATE.history[dateStr];
    const minutes = record ? record.focusMinutes : 0;
    const count = record ? record.pomodoros : 0;
    
    result.push({
      dateStr,
      dayName: daysShort[d.getDay()],
      minutes,
      count,
      isToday: (i === 0)
    });
  }
  return result;
}

// ==========================================
// 6. UI Güncellemeleri
// ==========================================

function updateTimerUI() {
  const display = document.getElementById('timer-display');
  const badge = document.getElementById('timer-mode-badge');
  const circle = document.getElementById('progress-ring-circle');
  
  if (display) {
    display.textContent = formatTime(APP_STATE.timeLeft);
  }

  if (badge) {
    badge.textContent = getModeTitle(APP_STATE.currentMode);
  }

  // Dairesel İlerleme
  if (circle) {
    const circumference = 2 * Math.PI * 130; // r = 130
    const progress = (APP_STATE.totalDuration - APP_STATE.timeLeft) / APP_STATE.totalDuration;
    const offset = circumference * (1 - progress);
    circle.style.strokeDashoffset = offset;
  }

  // Sekme Başlığını Güncelle
  const icon = APP_STATE.currentMode === 'pomodoro' ? '🎯' : '☕';
  document.title = `(${formatTime(APP_STATE.timeLeft)}) ${icon} ${getModeTitle(APP_STATE.currentMode)} | Pomodoro`;
}

function updatePlayButtonUI() {
  const btn = document.getElementById('btn-play-pause');
  if (!btn) return;

  if (APP_STATE.isRunning) {
    btn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
      </svg>
      <span>Duraklat</span>
    `;
    btn.style.filter = 'brightness(1.1)';
  } else {
    btn.innerHTML = `
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      <span>Başlat</span>
    `;
    btn.style.filter = 'none';
  }
}

function updateModeTabsUI() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    const mode = tab.dataset.mode;
    if (mode === APP_STATE.currentMode) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
}

function updateCycleDotsUI() {
  const container = document.getElementById('cycle-dots-container');
  const label = document.getElementById('cycle-label');
  if (!container || !label) return;

  container.innerHTML = '';
  const totalInCycle = APP_STATE.settings.longBreakInterval || 4;
  const currentStep = (APP_STATE.cycleCount % totalInCycle);

  for (let i = 0; i < totalInCycle; i++) {
    const dot = document.createElement('div');
    dot.className = 'cycle-dot';
    if (i < currentStep) {
      dot.classList.add('completed');
    } else if (i === currentStep && APP_STATE.currentMode === 'pomodoro') {
      dot.classList.add('current');
    }
    container.appendChild(dot);
  }

  label.textContent = `Döngü: ${currentStep + 1}/${totalInCycle} • Toplam: ${APP_STATE.cycleCount}`;
}

function updateQuickStatsUI() {
  const todayStr = getTodayString();
  const todayRecord = APP_STATE.history[todayStr] || { pomodoros: 0, focusMinutes: 0 };
  
  const elPomodoroCount = document.getElementById('quick-stat-pomodoros');
  const elFocusTime = document.getElementById('quick-stat-time');
  const elStreak = document.getElementById('quick-stat-streak');
  const elProgressFill = document.getElementById('target-progress-fill');
  const elTargetText = document.getElementById('target-header-text');

  if (elPomodoroCount) {
    elPomodoroCount.textContent = `${todayRecord.pomodoros}/${APP_STATE.settings.dailyGoal}`;
  }

  if (elFocusTime) {
    const hrs = Math.floor(todayRecord.focusMinutes / 60);
    const mins = todayRecord.focusMinutes % 60;
    elFocusTime.textContent = hrs > 0 ? `${hrs}s ${mins}d` : `${mins}dk`;
  }

  if (elStreak) {
    elStreak.textContent = `${calculateStreak()} Gün`;
  }

  if (elProgressFill && elTargetText) {
    const percent = Math.min(100, Math.round((todayRecord.pomodoros / APP_STATE.settings.dailyGoal) * 100));
    elProgressFill.style.width = `${percent}%`;
    elTargetText.textContent = `Günlük Hedef: %${percent}`;
  }
}

// Görevler Arayüzü
function updateTasksUI() {
  const list = document.getElementById('task-list');
  const activeTaskPill = document.getElementById('active-task-pill');
  if (!list) return;

  list.innerHTML = '';

  if (APP_STATE.tasks.length === 0) {
    list.innerHTML = `<div class="task-empty">Henüz görev eklenmedi. Odaklanmak istediğin görevi yukarıdan ekleyebilirsin.</div>`;
    if (activeTaskPill) activeTaskPill.textContent = 'Aktif Görev: Yok';
    return;
  }

  const activeTask = APP_STATE.tasks.find(t => t.id === APP_STATE.activeTaskId);
  if (activeTaskPill) {
    activeTaskPill.textContent = activeTask ? `🎯 ${activeTask.title}` : 'Aktif Görev: Seçilmedi';
  }

  APP_STATE.tasks.forEach(task => {
    const item = document.createElement('div');
    item.className = `task-item ${task.completed ? 'completed' : ''} ${task.id === APP_STATE.activeTaskId ? 'selected' : ''}`;

    item.innerHTML = `
      <div class="task-left" onclick="window.selectTask('${task.id}')">
        <div class="task-checkbox ${task.completed ? 'checked' : ''}" onclick="event.stopPropagation(); window.toggleTaskComplete('${task.id}')">
          ${task.completed ? `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>` : ''}
        </div>
        <span class="task-text" title="${task.title}">${escapeHTML(task.title)}</span>
      </div>
      <div class="task-right">
        <span class="task-pomo-count" title="Tamamlanan / Hedef Pomodoro">
          🍅 ${task.pomodorosSpent || 0}/${task.estimatedPomodoros || 1}
        </span>
        <button class="btn-task-del" title="Görevi Sil" onclick="event.stopPropagation(); window.deleteTask('${task.id}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
    list.appendChild(item);
  });
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// ==========================================
// 7. Bildirimler (Browser API & Toast)
// ==========================================

function requestNotificationPermission() {
  if ('Notification' in window) {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        showToast('Bildirim İzni Alındı', 'Mola ve seans bitimlerinde artık tarayıcı bildirimi alacaksın.', 'focus');
      }
    });
  }
}

function sendBrowserNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: 'favicon.ico',
        silent: true // Web Audio zaten çan çaldığı için çifte sesi önle
      });
    } catch (err) {
      console.warn('Tarayıcı bildirimi gönderilemedi:', err);
    }
  }
}

function showToast(title, message, type = 'break', actionCallback = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconSvg = type === 'break' 
    ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`
    : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>`;

  toast.innerHTML = `
    <div>${iconSvg}</div>
    <div class="toast-content" style="flex:1;">
      <h4>${escapeHTML(title)}</h4>
      <p>${escapeHTML(message)}</p>
      ${actionCallback ? `<button class="btn-toast-action" id="toast-action-btn">Hemen Başlat</button>` : ''}
    </div>
    <button class="btn-task-del" style="align-self:flex-start;" onclick="this.parentElement.remove()">✕</button>
  `;

  if (actionCallback) {
    const actBtn = toast.querySelector('#toast-action-btn');
    if (actBtn) {
      actBtn.addEventListener('click', () => {
        actionCallback();
        toast.remove();
      });
    }
  }

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(60px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }
  }, 7000);
}

// ==========================================
// 8. İstatistikler Modalı & Haftalık Grafik
// ==========================================

function openStatsModal() {
  const modal = document.getElementById('stats-modal');
  if (!modal) return;

  renderStatsSummary();
  renderWeeklyBarChart();
  renderSessionHistoryList();

  modal.classList.add('open');
}

function closeStatsModal() {
  const modal = document.getElementById('stats-modal');
  if (modal) modal.classList.remove('open');
}

function renderStatsSummary() {
  let totalMinutes = 0;
  let totalPomodoros = 0;
  let bestDay = { date: '-', count: 0 };

  Object.entries(APP_STATE.history).forEach(([dateStr, rec]) => {
    totalMinutes += rec.focusMinutes || 0;
    totalPomodoros += rec.pomodoros || 0;
    if (rec.pomodoros > bestDay.count) {
      bestDay = { date: dateStr, count: rec.pomodoros };
    }
  });

  const hours = (totalMinutes / 60).toFixed(1);

  document.getElementById('stats-total-time').textContent = `${hours} Saat`;
  document.getElementById('stats-total-pomo').textContent = `${totalPomodoros} Seans`;
  document.getElementById('stats-best-day').textContent = bestDay.count > 0 ? `${bestDay.count} Seans` : '-';
  document.getElementById('stats-streak').textContent = `${calculateStreak()} Gün`;
}

function renderWeeklyBarChart() {
  const container = document.getElementById('weekly-bar-chart');
  if (!container) return;

  const data = getLast7DaysData();
  const maxMinutes = Math.max(...data.map(d => d.minutes), 60); // minimum 60 dk ölçek

  container.innerHTML = '';

  data.forEach(item => {
    const heightPercent = Math.max(4, Math.round((item.minutes / maxMinutes) * 100));

    const col = document.createElement('div');
    col.className = `bar-col ${item.isToday ? 'today' : ''}`;
    col.innerHTML = `
      <div class="bar-val">${item.minutes > 0 ? item.minutes + 'd' : '0'}</div>
      <div class="bar-pill-track" title="${item.dateStr}: ${item.count} seans (${item.minutes} dk)">
        <div class="bar-pill-fill" style="height: ${heightPercent}%;"></div>
      </div>
      <div class="bar-day">${item.dayName}</div>
    `;
    container.appendChild(col);
  });
}

function renderSessionHistoryList() {
  const list = document.getElementById('session-history-list');
  if (!list) return;

  const todayStr = getTodayString();
  const todayRecord = APP_STATE.history[todayStr];

  if (!todayRecord || !todayRecord.sessions || todayRecord.sessions.length === 0) {
    list.innerHTML = `<div class="task-empty">Bugün henüz tamamlanmış seans bulunmuyor.</div>`;
    return;
  }

  list.innerHTML = '';
  // Sondan başa listele (en yeni üstte)
  const reversed = [...todayRecord.sessions].reverse();

  reversed.forEach(s => {
    const row = document.createElement('div');
    row.className = 'task-item';
    row.style.cursor = 'default';
    row.innerHTML = `
      <div class="task-left">
        <span style="font-size:1.1rem;">🍅</span>
        <div>
          <div style="font-weight:600; font-size:0.85rem;">${escapeHTML(s.task)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${s.time} • ${s.duration} Dakika</div>
        </div>
      </div>
      <span class="task-pomo-count" style="color:var(--mode-longBreak);">Tamamlandı</span>
    `;
    list.appendChild(row);
  });
}

function exportStatsAsJSON() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(APP_STATE.history, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `pomodoro-istatistikleri-${getTodayString()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

function resetAllStats() {
  if (confirm("Tüm odaklanma istatistiklerini sıfırlamak istediğinden emin misin? Bu işlem geri alınamaz.")) {
    APP_STATE.history = {};
    saveToStorage();
    renderStatsSummary();
    renderWeeklyBarChart();
    renderSessionHistoryList();
    updateQuickStatsUI();
    showToast('İstatistikler Sıfırlandı', 'Tüm geçmiş veriler temizlendi.', 'focus');
  }
}

// ==========================================
// 9. Ayarlar Modalı
// ==========================================

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;

  // Form değerlerini doldur
  document.getElementById('setting-pomo-time').value = APP_STATE.settings.pomodoroTime;
  document.getElementById('setting-short-time').value = APP_STATE.settings.shortBreakTime;
  document.getElementById('setting-long-time').value = APP_STATE.settings.longBreakTime;
  document.getElementById('setting-cycle-interval').value = APP_STATE.settings.longBreakInterval;
  document.getElementById('setting-daily-goal').value = APP_STATE.settings.dailyGoal;
  document.getElementById('setting-auto-breaks').checked = APP_STATE.settings.autoStartBreaks;
  document.getElementById('setting-auto-pomos').checked = APP_STATE.settings.autoStartPomodoros;
  document.getElementById('setting-sound-type').value = APP_STATE.settings.soundType;
  document.getElementById('setting-theme').value = APP_STATE.settings.theme;

  modal.classList.add('open');
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.remove('open');
}

function saveSettingsFromForm() {
  const pTime = parseInt(document.getElementById('setting-pomo-time').value, 10) || 25;
  const sTime = parseInt(document.getElementById('setting-short-time').value, 10) || 5;
  const lTime = parseInt(document.getElementById('setting-long-time').value, 10) || 15;
  const cycleInt = parseInt(document.getElementById('setting-cycle-interval').value, 10) || 4;
  const goal = parseInt(document.getElementById('setting-daily-goal').value, 10) || 8;
  const autoBrk = document.getElementById('setting-auto-breaks').checked;
  const autoPomo = document.getElementById('setting-auto-pomos').checked;
  const soundType = document.getElementById('setting-sound-type').value;
  const theme = document.getElementById('setting-theme').value;

  APP_STATE.settings = {
    ...APP_STATE.settings,
    pomodoroTime: Math.max(1, Math.min(120, pTime)),
    shortBreakTime: Math.max(1, Math.min(60, sTime)),
    longBreakTime: Math.max(1, Math.min(90, lTime)),
    longBreakInterval: Math.max(1, Math.min(12, cycleInt)),
    dailyGoal: Math.max(1, Math.min(50, goal)),
    autoStartBreaks: autoBrk,
    autoStartPomodoros: autoPomo,
    soundType,
    theme
  };

  applyTheme(theme);
  saveToStorage();

  // Çalışmıyorsa mevcut modu yeni süreye güncelle
  if (!APP_STATE.isRunning) {
    setMode(APP_STATE.currentMode, false);
  }

  updateQuickStatsUI();
  updateCycleDotsUI();
  closeSettingsModal();
  showToast('Ayarlar Kaydedildi', 'Yeni tercihleriniz başarıyla uygulandı.', 'focus');
}

function applyTheme(themeName) {
  document.body.classList.remove('theme-sunset', 'theme-forest', 'theme-indigo');
  if (themeName !== 'default') {
    document.body.classList.add(`theme-${themeName}`);
  }
}

// ==========================================
// 10. Görev Yönetimi Fonksiyonları
// ==========================================

function addTask() {
  const input = document.getElementById('input-new-task');
  const pomoEstInput = document.getElementById('input-task-est');
  if (!input) return;

  const title = input.value.trim();
  if (!title) return;

  const est = parseInt(pomoEstInput ? pomoEstInput.value : 1, 10) || 1;

  const newTask = {
    id: 'task_' + Date.now(),
    title,
    estimatedPomodoros: est,
    pomodorosSpent: 0,
    completed: false,
    createdAt: Date.now()
  };

  APP_STATE.tasks.push(newTask);
  if (!APP_STATE.activeTaskId) {
    APP_STATE.activeTaskId = newTask.id;
  }

  input.value = '';
  saveToStorage();
  updateTasksUI();
}

window.selectTask = function(taskId) {
  sounds.playClick();
  APP_STATE.activeTaskId = (APP_STATE.activeTaskId === taskId) ? null : taskId;
  saveToStorage();
  updateTasksUI();
};

window.toggleTaskComplete = function(taskId) {
  sounds.playClick();
  const task = APP_STATE.tasks.find(t => t.id === taskId);
  if (task) {
    task.completed = !task.completed;
    saveToStorage();
    updateTasksUI();
  }
};

window.deleteTask = function(taskId) {
  sounds.playClick();
  APP_STATE.tasks = APP_STATE.tasks.filter(t => t.id !== taskId);
  if (APP_STATE.activeTaskId === taskId) {
    APP_STATE.activeTaskId = null;
  }
  saveToStorage();
  updateTasksUI();
};

// ==========================================
// 11. Zen / Odak Tam Ekran Modu
// ==========================================

function toggleZenMode() {
  document.body.classList.toggle('zen-active');
  const isZen = document.body.classList.contains('zen-active');

  const btnZen = document.getElementById('btn-toggle-zen');
  if (btnZen) {
    btnZen.classList.toggle('active', isZen);
  }

  if (isZen && document.fullscreenEnabled && !document.fullscreenElement) {
    try {
      document.documentElement.requestFullscreen().catch(() => {});
    } catch {}
  }
}

function exitZenMode() {
  document.body.classList.remove('zen-active');
  const btnZen = document.getElementById('btn-toggle-zen');
  if (btnZen) btnZen.classList.remove('active');

  if (document.fullscreenElement) {
    try {
      document.exitFullscreen().catch(() => {});
    } catch {}
  }
}

// ==========================================
// 12. Başlatma ve Olay Dinleyicileri (Event Listeners)
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  applyTheme(APP_STATE.settings.theme);

  // Başlangıç modunu ayarla
  setMode('pomodoro', false);
  updateQuickStatsUI();
  updateTasksUI();

  // Zamanlayıcı Kontrolleri
  document.getElementById('btn-play-pause')?.addEventListener('click', toggleTimer);
  document.getElementById('btn-reset')?.addEventListener('click', () => {
    sounds.playClick();
    resetTimer();
  });
  document.getElementById('btn-skip')?.addEventListener('click', () => {
    sounds.playClick();
    skipTimer();
  });

  // Mod Değiştirme Butonları
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sounds.playClick();
      setMode(btn.dataset.mode, false);
    });
  });

  // Görev Ekleme
  document.getElementById('btn-add-task')?.addEventListener('click', addTask);
  document.getElementById('input-new-task')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
  });

  // Ortam Sesleri Tıklamaları
  document.querySelectorAll('.ambient-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const soundKey = btn.dataset.sound;
      const isAlreadyPlaying = (sounds.ambientPlaying === soundKey);

      document.querySelectorAll('.ambient-btn').forEach(b => b.classList.remove('playing'));

      if (isAlreadyPlaying) {
        sounds.stopAmbient();
      } else {
        const vol = parseFloat(document.getElementById('ambient-volume-slider')?.value || 0.5);
        sounds.startAmbient(soundKey, vol);
        btn.classList.add('playing');
      }
    });
  });

  // Ortam Sesi Ses Düzeyi
  document.getElementById('ambient-volume-slider')?.addEventListener('input', (e) => {
    sounds.setAmbientVolume(parseFloat(e.target.value));
  });

  // Üst Başlık Butonları (İstatistik, Ayarlar, Zen, Bildirim)
  document.getElementById('btn-open-stats')?.addEventListener('click', () => {
    sounds.playClick();
    openStatsModal();
  });

  document.getElementById('btn-open-settings')?.addEventListener('click', () => {
    sounds.playClick();
    openSettingsModal();
  });

  document.getElementById('btn-toggle-zen')?.addEventListener('click', toggleZenMode);
  document.getElementById('zen-exit-btn')?.addEventListener('click', exitZenMode);

  document.getElementById('btn-request-notification')?.addEventListener('click', () => {
    sounds.playClick();
    requestNotificationPermission();
  });

  // İstatistik Modalı Olayları
  document.getElementById('btn-close-stats')?.addEventListener('click', closeStatsModal);
  document.getElementById('stats-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'stats-modal') closeStatsModal();
  });
  document.getElementById('btn-export-stats')?.addEventListener('click', exportStatsAsJSON);
  document.getElementById('btn-reset-stats')?.addEventListener('click', resetAllStats);

  // Ayarlar Modalı Olayları
  document.getElementById('btn-close-settings')?.addEventListener('click', closeSettingsModal);
  document.getElementById('settings-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') closeSettingsModal();
  });
  document.getElementById('btn-save-settings')?.addEventListener('click', saveSettingsFromForm);
  document.getElementById('btn-test-sound')?.addEventListener('click', () => {
    const sType = document.getElementById('setting-sound-type').value;
    sounds.playAlarm(sType, 0.8);
  });

  // Klavye Kısayolları (Space: Başlat/Duraklat, R: Sıfırla, S: Geç)
  window.addEventListener('keydown', (e) => {
    // Input alanındayken kısayolları tetikleme
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      toggleTimer();
    } else if (e.key === 'r' || e.key === 'R') {
      resetTimer();
    } else if (e.key === 's' || e.key === 'S') {
      skipTimer();
    } else if (e.key === 'Escape') {
      exitZenMode();
      closeStatsModal();
      closeSettingsModal();
    }
  });
});
