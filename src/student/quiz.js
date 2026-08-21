import { rpc } from '../lib/supabase.js';
import {
  sanitizeInput,
  escapeHtml,
  formatTime,
  backupKey,
  validateStudentData,
  seededShuffle,
  showCustomAlert,
} from '../lib/utils.js';
import { state } from '../state.js';
import { showStudentDashboard } from './results.js';
import { showDashboard } from '../admin/dashboard.js';

/** Bekleyen (offline) gönderim anahtarı */
function pendingSubmitKey(examCode, number) {
  return `exam_pending_submit_${examCode}_${number}`;
}

let onlineFlushBound = false;
let isFlushingPending = false;

export function restoreFromLocalBackup(examCode, number) {
  try {
    const raw = localStorage.getItem(backupKey(examCode, number));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveToLocalBackup() {
  if (!validateStudentData(state.studentData)) return;
  const now = Date.now();
  const remaining = Math.floor((state.examEndTimestamp - now) / 1000);
  const data = {
    answers: state.selectedAnswers,
    timeLeft: remaining > 0 ? remaining : 0,
    lastQuestionIndex: state.currentQuestionIndex,
    focusLossCount: state.focusLossCount,
    questionOrder: state.questionOrder,
    timestamp: now,
  };
  localStorage.setItem(
    backupKey(state.studentData.examCode, state.studentData.number),
    JSON.stringify(data)
  );
}

/** Bitirme isteğini cihaza kuyruğa al (internet gelince otomatik gönder) */
function queuePendingSubmit(extra = {}) {
  if (!validateStudentData(state.studentData) || !state.sessionId || !state.clientToken) return;

  const timeSpent =
    extra.timeSpent ??
    state.currentExamConfig.time_limit -
      Math.max(0, Math.floor((state.examEndTimestamp - Date.now()) / 1000));

  const payload = {
    sessionId: state.sessionId,
    clientToken: state.clientToken,
    answers: state.selectedAnswers,
    durations: state.questionDurations,
    questionOrder: state.questionOrder,
    timeSpent: Math.max(0, timeSpent),
    focusLoss: state.focusLossCount,
    student: { ...state.studentData },
    password: state.studentPassword,
    examCode: state.studentData.examCode,
    number: state.studentData.number,
    queuedAt: Date.now(),
    reason: extra.reason || 'offline',
  };

  localStorage.setItem(
    pendingSubmitKey(state.studentData.examCode, state.studentData.number),
    JSON.stringify(payload)
  );
  saveToLocalBackup();
  ensureOnlineListener();
}

function loadPendingSubmit(examCode, number) {
  try {
    const raw = localStorage.getItem(pendingSubmitKey(examCode, number));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearPendingSubmit(examCode, number) {
  localStorage.removeItem(pendingSubmitKey(examCode, number));
}

function ensureOnlineListener() {
  if (onlineFlushBound) return;
  onlineFlushBound = true;
  window.addEventListener('online', () => {
    // Kısa gecikme: tarayıcı "online" der demez soket bazen henüz hazır olmaz
    setTimeout(() => {
      tryFlushPendingSubmit();
    }, 800);
  });
}

/** Girişte veya online olunca çağrılır */
export async function tryFlushPendingSubmit(opts = {}) {
  const examCode = opts.examCode || state.studentData?.examCode;
  const number = opts.number || state.studentData?.number;
  if (!examCode || !number) return { ok: false, reason: 'no_student' };
  if (isFlushingPending) return { ok: false, reason: 'busy' };
  if (!navigator.onLine) return { ok: false, reason: 'offline' };

  const pending = loadPendingSubmit(examCode, number);
  if (!pending) return { ok: false, reason: 'none' };

  isFlushingPending = true;
  showPendingSubmitUI('İnternet geldi — cevaplarınız gönderiliyor...', true);

  try {
    let ip = '';
    try {
      const r = await fetch('https://api.ipify.org?format=json');
      const d = await r.json();
      ip = d.ip || '';
    } catch {
      /* ignore */
    }

    const res = await Promise.race([
      rpc('submit_exam', {
        p_session_id: pending.sessionId,
        p_token: pending.clientToken,
        p_answers: pending.answers,
        p_durations: pending.durations,
        p_time_spent: pending.timeSpent,
        p_focus_loss: pending.focusLoss,
        p_ip: ip,
        p_question_order: pending.questionOrder,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
    ]);

    if (!res?.ok) throw new Error(res?.error || 'Gönderilemedi');

    clearPendingSubmit(examCode, number);
    localStorage.removeItem(backupKey(examCode, number));

    // state'i doldur (sonuç ekranı için)
    if (pending.password) state.studentPassword = pending.password;
    if (pending.student) state.studentData = pending.student;

    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.autoSaveInterval) clearInterval(state.autoSaveInterval);
    window.onblur = null;

    showStudentDashboard(res.submission, { password: pending.password || state.studentPassword });
    return { ok: true };
  } catch (e) {
    console.warn('Pending flush failed', e);
    showPendingSubmitUI(
      `Gönderilemedi (${e.message}). İnternet varken "Tekrar Dene"ye basın. Sayfayı kapatmayın.`,
      false
    );
    return { ok: false, reason: e.message };
  } finally {
    isFlushingPending = false;
  }
}

function showPendingSubmitUI(message, spinning) {
  const app = document.getElementById('mainContentArea');
  if (!app) return;
  app.innerHTML = `
    <div class="text-center py-10 space-y-4">
      ${spinning ? '<div class="loader mb-4"></div>' : '<div class="text-5xl">📡</div>'}
      <p class="font-bold text-gray-800 text-lg">Gönderim bekleniyor</p>
      <p class="text-sm text-gray-600 max-w-md mx-auto">${escapeHtml(message)}</p>
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 max-w-md mx-auto text-left">
        <b>Ne oldu?</b> İnternet yokken sınavı bitirdiniz. Cevaplarınız bu cihazda kuyruğa alındı.
        İnternet gelince <b>otomatik</b> gönderilir. Öğretmen sınavı kapatsa bile
        <b>sizin oturumunuzdan gönderim kabul edilir</b>.
        <br/><br/>
        ⚠️ Bu sekmeyi kapatmayın / yenilemeyin (mümkünse).
      </div>
      <button id="btnRetryPending" class="button bg-indigo-600 text-white px-6 py-3 rounded-lg font-bold">
        🔄 Tekrar Dene
      </button>
      <button id="btnBackQuizPending" class="block mx-auto text-xs text-gray-500 underline mt-2">
        Sınav ekranına dön (işaret değiştirebilirsin)
      </button>
    </div>`;

  document.getElementById('btnRetryPending').onclick = () => tryFlushPendingSubmit();
  document.getElementById('btnBackQuizPending').onclick = () => {
    // Kuyruk durur; tekrar bitirince yenilenir
    if (state.sessionId && state.quizQuestions?.length) startQuiz();
    else location.reload();
  };
}

export function startQuiz() {
  ensureOnlineListener();

  // Varsa bekleyen gönderimi dene
  if (state.studentData?.examCode && state.studentData?.number) {
    const pending = loadPendingSubmit(state.studentData.examCode, state.studentData.number);
    if (pending) {
      if (navigator.onLine) {
        tryFlushPendingSubmit();
        return;
      }
      showPendingSubmitUI(
        'İnternet yok. Bağlantı gelince cevaplarınız otomatik gönderilecek.',
        false
      );
      return;
    }
  }

  document.getElementById('connectionStatus').classList.add('hidden');
  document.getElementById('app').className = 'app-card max-w-3xl w-full';
  document.getElementById('loginHeader').innerHTML = `
    <div class="flex justify-between px-4">
      <span class="text-sm opacity-80">${escapeHtml(state.studentData.name)}</span>
      <span>${escapeHtml(state.studentData.examCode)}</span>
    </div>`;

  document.getElementById('mainContentArea').innerHTML = `
    <div class="flex justify-between items-center mb-4 border-b pb-2">
      <span class="font-bold text-indigo-600">Soru: <span id="qCount">1</span> / ${state.quizQuestions.length}</span>
      <div id="timerDisplay" class="text-xl font-mono font-bold text-white bg-indigo-600 p-1 px-3 rounded shadow">--:--</div>
    </div>
    <div id="questionArea" class="min-h-[250px]"></div>
    <div id="focusWarn" class="hidden mt-4 p-2 bg-red-100 text-red-800 text-sm font-bold text-center rounded border border-red-300"></div>
    <div class="mt-6 flex justify-between">
      <button id="prevBtn" class="button bg-gray-500 hover:bg-gray-600 text-white py-2 px-4 rounded opacity-50" disabled>Önceki</button>
      <button id="nextBtn" class="button bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-6 rounded font-bold">Sonraki</button>
    </div>
  `;

  renderQuestion(state.currentQuestionIndex);
  startTimer();
  setupSecurityListeners();
  startAutoSave();

  document.getElementById('prevBtn').onclick = () => {
    if (state.currentQuestionIndex > 0) {
      updateQuestionTime();
      state.currentQuestionIndex--;
      renderQuestion(state.currentQuestionIndex);
    }
  };
  document.getElementById('nextBtn').onclick = () => {
    if (state.currentQuestionIndex < state.quizQuestions.length - 1) {
      updateQuestionTime();
      state.currentQuestionIndex++;
      renderQuestion(state.currentQuestionIndex);
    } else {
      updateQuestionTime();
      finishQuiz(false);
    }
  };
}

function updateQuestionTime() {
  const now = Date.now();
  const spent = (now - state.lastQuestionStartTime) / 1000;
  const realIdx = state.questionOrder[state.currentQuestionIndex];
  if (state.questionDurations[realIdx] === undefined) state.questionDurations[realIdx] = 0;
  state.questionDurations[realIdx] += spent;
  state.lastQuestionStartTime = now;
}

function renderQuestion(idx) {
  const realIdx = state.questionOrder[idx];
  const q = state.quizQuestions[realIdx];
  if (!q) return;

  const seed = state.studentData.number + '_q' + realIdx;
  const shuffledOpts = seededShuffle(q.options || [], seed);
  const currAns = state.selectedAnswers[realIdx];
  const imageHtml = q.image
    ? `<div class="mb-4 flex justify-center"><img src="${escapeHtml(q.image)}" class="max-h-64 rounded-lg shadow border object-contain" alt=""></div>`
    : '';

  document.getElementById('questionArea').innerHTML = `
    <div class="font-semibold text-lg text-gray-800 mb-4 select-none">Soru ${idx + 1}: ${sanitizeInput(q.question)}</div>
    ${imageHtml}
    <div class="space-y-3">
      ${shuffledOpts
        .map(
          (opt) => `
        <label class="flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
          currAns === opt ? 'bg-indigo-50 border-indigo-500 shadow-md' : 'border-gray-200 hover:bg-gray-50'
        }">
          <input type="radio" name="opt" value="${escapeHtml(opt)}" class="w-5 h-5 text-indigo-600" ${
            currAns === opt ? 'checked' : ''
          } />
          <span class="ml-3 text-gray-700 font-medium select-none">${sanitizeInput(opt)}</span>
        </label>`
        )
        .join('')}
    </div>
  `;

  document.getElementById('qCount').innerText = String(idx + 1);

  document.querySelectorAll('input[name="opt"]').forEach((el) => {
    el.onchange = (e) => {
      state.selectedAnswers[realIdx] = e.target.value;
      document.querySelectorAll('#questionArea label').forEach((l) => {
        l.className =
          'flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all border-gray-200 hover:bg-gray-50';
      });
      e.target.closest('label').className =
        'flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all bg-indigo-50 border-indigo-500 shadow-md';
      saveToLocalBackup();
    };
  });

  document.getElementById('prevBtn').disabled = idx === 0;
  document.getElementById('prevBtn').classList.toggle('opacity-50', idx === 0);

  const nextBtn = document.getElementById('nextBtn');
  if (idx === state.quizQuestions.length - 1) {
    nextBtn.innerText = 'SINAVI BİTİR';
    nextBtn.className =
      'button bg-green-600 hover:bg-green-700 text-white py-2 px-6 rounded font-bold shadow-lg';
  } else {
    nextBtn.innerText = 'Sonraki';
    nextBtn.className = 'button bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-6 rounded font-bold';
  }
}

function startTimer() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  const tick = () => {
    const diff = Math.ceil((state.examEndTimestamp - Date.now()) / 1000);
    const el = document.getElementById('timerDisplay');
    if (!el) return;
    if (diff <= 0) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      finishQuiz(true);
      return;
    }
    if (diff < 60) {
      el.className =
        'text-xl font-mono font-bold text-white bg-red-600 p-1 px-3 rounded shadow animate-pulse';
    }
    el.innerText = formatTime(diff);
  };
  tick();
  state.timerInterval = setInterval(tick, 1000);
}

function setupSecurityListeners() {
  window.onblur = () => {
    if (state.isTeacherMode && !state.isPreviewMode) return;
    if (state.isPreviewMode) return;
    state.focusLossCount++;
    const w = document.getElementById('focusWarn');
    if (w) {
      w.classList.remove('hidden');
      w.innerText = `⚠️ DİKKAT: Sınav ekranından ${state.focusLossCount} kez ayrıldınız!`;
    }
    saveToLocalBackup();
    saveProgress(false);
  };
  document.addEventListener('contextmenu', preventCtx);
}

function preventCtx(e) {
  if (document.getElementById('timerDisplay')) e.preventDefault();
}

function startAutoSave() {
  state.autoSaveInterval = setInterval(() => saveProgress(true), 60_000);
}

async function saveProgress(isAuto = false) {
  if (state.isPreviewMode) return;
  if (!state.sessionId || !state.clientToken) return;

  const currentAnswersStr = JSON.stringify(state.selectedAnswers);
  if (isAuto && state.lastSavedAnswers === currentAnswersStr && state.focusLossCount === state.lastSavedFocus) {
    return;
  }

  saveToLocalBackup();

  try {
    const remaining = Math.floor((state.examEndTimestamp - Date.now()) / 1000);
    const res = await rpc('save_progress', {
      p_session_id: state.sessionId,
      p_token: state.clientToken,
      p_answers: state.selectedAnswers,
      p_durations: state.questionDurations,
      p_current_idx: state.currentQuestionIndex,
      p_time_left: remaining > 0 ? remaining : 0,
      p_focus_loss: state.focusLossCount,
      p_question_order: state.questionOrder,
    });
    if (res?.ok) {
      state.lastSavedAnswers = currentAnswersStr;
      state.lastSavedFocus = state.focusLossCount;
      const statusDiv = document.getElementById('connectionStatus');
      if (statusDiv && statusDiv.innerHTML.includes('BAĞLANTI')) {
        statusDiv.classList.add('hidden');
      }
    }
  } catch (e) {
    console.warn('Autosave failed', e);
    const statusDiv = document.getElementById('connectionStatus');
    if (statusDiv) {
      statusDiv.classList.remove('hidden');
      statusDiv.innerHTML =
        '⚠️ BAĞLANTI HATASI: Cevaplarınız cihazınıza yedekleniyor.';
      statusDiv.className =
        'mb-4 text-xs font-bold text-center p-2 rounded border bg-red-600 text-white animate-pulse';
    }
  }
}

async function finishQuiz(force = false) {
  if (state.isPreviewMode) {
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.autoSaveInterval) clearInterval(state.autoSaveInterval);
    window.onblur = null;
    alert('Önizleme tamamlandı.');
    state.isPreviewMode = false;
    document.getElementById('app').className = 'app-card teacher-mode';
    showDashboard();
    window.changeTab?.('myexams');
    return;
  }

  // --- OFFLINE: kuyruğa al, internet gelince otomatik gönder ---
  if (!navigator.onLine) {
    if (!force && !confirm('İnternet yok. Bitirme isteği kaydedilsin mi? Net gelince otomatik gönderilecek.')) {
      return;
    }
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.autoSaveInterval) clearInterval(state.autoSaveInterval);
    window.onblur = null;

    queuePendingSubmit({ reason: force ? 'time_up_offline' : 'user_finish_offline' });
    showPendingSubmitUI(
      'İnternet yok. Cevaplarınız bu cihazda saklandı. Bağlantı gelince OTOMATİK gönderilecek. Sayfayı kapatmayın.',
      false
    );
    return;
  }

  if (!force && !confirm('Sınavı bitirmek istediğinize emin misiniz?')) return;

  await doSubmitNow(force);
}

async function doSubmitNow() {
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (state.autoSaveInterval) clearInterval(state.autoSaveInterval);
  window.onblur = null;

  // Her durumda kuyruğa da yaz (timeout olursa online listener kurtarsın)
  queuePendingSubmit({ reason: 'submitting' });

  document.getElementById('mainContentArea').innerHTML = `
    <div class="text-center py-10">
      <div class="loader mb-4"></div>
      <p class="font-bold text-gray-600">Cevaplarınız gönderiliyor...</p>
    </div>`;

  const timeSpent =
    state.currentExamConfig.time_limit -
    Math.max(0, Math.floor((state.examEndTimestamp - Date.now()) / 1000));

  let ip = '';
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const d = await r.json();
    ip = d.ip || '';
  } catch {
    /* ignore */
  }

  try {
    const submitPromise = rpc('submit_exam', {
      p_session_id: state.sessionId,
      p_token: state.clientToken,
      p_answers: state.selectedAnswers,
      p_durations: state.questionDurations,
      p_time_spent: timeSpent,
      p_focus_loss: state.focusLossCount,
      p_ip: ip,
      p_question_order: state.questionOrder,
    });

    const res = await Promise.race([
      submitPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
    ]);

    if (!res?.ok) throw new Error(res?.error || 'Gönderilemedi');

    clearPendingSubmit(state.studentData.examCode, state.studentData.number);
    localStorage.removeItem(
      backupKey(state.studentData.examCode, state.studentData.number)
    );
    showStudentDashboard(res.submission, { password: state.studentPassword });
  } catch (e) {
    // Kuyruk duruyor — online olunca veya Tekrar Dene ile
    const msg =
      e.message === 'timeout'
        ? 'Bağlantı yavaş/koptu. Cevaplar kuyrukta; internet düzelince otomatik veya Tekrar Dene ile gönderilir.'
        : e.message;
    showPendingSubmitUI(msg, false);
  }
}

/** Admin önizleme */
export async function previewExamAsAdmin(code, fetchExamFn) {
  await fetchExamFn(code);
  state.isPreviewMode = true;
  state.isTeacherMode = true;
  state.studentData = {
    name: 'YÖNETİCİ (ÖNİZLEME)',
    number: '0000',
    className: 'TEST',
    examCode: code,
  };
  const n = state.quizQuestions.length;
  state.questionOrder = Array.from({ length: n }, (_, i) => i);
  state.selectedAnswers = Array(n).fill(null);
  state.questionDurations = Array(n).fill(0);
  state.currentQuestionIndex = 0;
  state.focusLossCount = 0;
  state.sessionId = null;
  state.clientToken = null;
  state.examEndTimestamp = Date.now() + (state.currentExamConfig.time_limit || 600) * 1000;
  state.lastQuestionStartTime = Date.now();
  startQuiz();
  document.getElementById('loginHeader').innerHTML = `
    <div class="flex justify-between items-center px-4 py-2 bg-orange-600 text-white rounded-t-lg">
      <span class="font-bold">👁️ ÖNİZLEME</span>
      <button id="closePreviewBtn" class="bg-white text-orange-800 px-3 py-1 rounded text-xs font-bold">Kapat</button>
    </div>`;
  document.getElementById('closePreviewBtn').onclick = () => {
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.autoSaveInterval) clearInterval(state.autoSaveInterval);
    state.isPreviewMode = false;
    showDashboard();
    window.changeTab?.('myexams');
  };
}

// unused import guard
void showCustomAlert;
