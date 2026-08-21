import { rpc } from '../lib/supabase.js';
import {
  sanitizeExamCode,
  sanitizeInput,
  showCustomAlert,
  escapeHtml,
  backupKey,
} from '../lib/utils.js';
import { state } from '../state.js';
import { startQuiz, restoreFromLocalBackup, tryFlushPendingSubmit } from './quiz.js';
import { showStudentDashboard } from './results.js';
import { showTeacherLogin } from '../admin/login.js';

let typingTimer;

// ══════════════════════════════════════════════════════════════════
// okuyOS OTOMATİK GİRİŞ (YENİ)
// ------------------------------------------------------------------
// okuyOS'tan gelen öğrenci, URL'de şu parametrelerle bu siteye yönlendirilir:
//   ?auto=1&code=QUIZ1&number=1427&name=Ad+Soyad&class=9-E&expiry=...&sig=...
// Bu fonksiyon, showLoginForm() çağrılırken URL'de bu parametreler varsa,
// normal (sınav kodu/sınıf/isim seçme) ekranı hiç GÖSTERMEDEN, doğrudan
// student_auto_enter RPC'sini çağırıp sınava/sonuca yönlendirir. Parametreler
// yoksa (öğrenci sitenin kendi adresinden girmişse) ESKİ akış AYNEN çalışır
// — bu fonksiyon sessizce false döner, showLoginForm normal formu gösterir.
// ══════════════════════════════════════════════════════════════════
export async function tryAutoLoginFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('auto') !== '1') return false;

  const code = sanitizeExamCode(params.get('code') || '');
  const number = (params.get('number') || '').trim();
  const name = (params.get('name') || '').trim();
  const className = (params.get('class') || '').trim();
  const expiry = parseInt(params.get('expiry') || '0', 10);
  const sig = (params.get('sig') || '').trim();

  if (!code || !number || !name || !className || !expiry || !sig) {
    return false; // eksik parametre — normal girişe düş
  }

  // URL'i temizle (adres çubuğunda bilet kalıcı görünmesin, geri tuşuyla tekrar
  // kullanılmasın); bilet zaten süresi dolunca sunucu tarafında geçersiz olur.
  window.history.replaceState({}, document.title, window.location.pathname);

  document.getElementById('loginHeader').innerHTML =
    '<h1 class="text-2xl font-extrabold">okuyOS ile Giriş</h1>';
  document.getElementById('mainContentArea').innerHTML = `
    <div class="text-center py-10">
      <div class="loader mb-4"></div>
      <p class="font-bold text-gray-600">okuyOS'tan otomatik giriş yapılıyor...</p>
    </div>`;

  try {
    const res = await rpc('student_auto_enter', {
      p_code: code,
      p_number: number,
      p_name: name,
      p_class: className,
      p_expiry: expiry,
      p_signature: sig,
    });

    if (!res?.ok) {
      document.getElementById('mainContentArea').innerHTML = `
        <div class="text-center text-red-500 py-10">
          <p class="font-bold">Otomatik giriş başarısız</p>
          <p class="text-sm">${escapeHtml(res?.error || 'Bilinmeyen hata')}</p>
          <button id="autoLoginFallbackBtn" class="mt-4 bg-indigo-600 text-white px-4 py-2 rounded font-bold">Manuel Giriş Ekranına Dön</button>
        </div>`;
      document.getElementById('autoLoginFallbackBtn').onclick = showLoginForm;
      return true; // bir "giriş denemesi" oldu, ama başarısız — normal formu tekrar göstermeyelim, kullanıcı butona bassın
    }

    if (res.mode === 'result') {
      await showStudentDashboard(res.submission, { password: null, viaAutoLogin: true });
      return true;
    }

    await enterExamMode(res, { code, number, className });
    return true;
  } catch (e) {
    document.getElementById('mainContentArea').innerHTML = `
      <div class="text-center text-red-500 py-10">
        <p class="font-bold">Bağlantı hatası</p>
        <p class="text-sm">${escapeHtml(e.message)}</p>
        <button id="autoLoginFallbackBtn2" class="mt-4 bg-indigo-600 text-white px-4 py-2 rounded font-bold">Manuel Giriş Ekranına Dön</button>
      </div>`;
    document.getElementById('autoLoginFallbackBtn2').onclick = showLoginForm;
    return true;
  }
}

export function showLoginForm() {
  document.getElementById('loginHeader').innerHTML =
    '<h1 class="text-2xl font-extrabold">Öğrenci Girişi</h1>';
  document.getElementById('mainContentArea').innerHTML = `
    <div class="space-y-4 min-h-[400px] flex flex-col">
      <div id="teacherDisplayArea" class="text-center p-2 bg-indigo-50 rounded-lg border border-indigo-100 opacity-0 transition-opacity duration-500">
        <p class="text-xs text-gray-500">Uygulayıcı Öğretmen</p>
        <p id="teacherNameDisplay" class="font-bold text-indigo-700 text-lg"></p>
      </div>
      <div id="examInfoArea" class="hidden bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm text-yellow-800"></div>
      <input id="examCodeInput" type="text" placeholder="SINAV KODU" class="w-full p-3 border rounded-lg uppercase font-bold text-center tracking-widest focus:ring-2 focus:ring-indigo-400 outline-none" />
      <div id="studentLoginFields" class="space-y-4 flex-grow">
        <p class="text-sm text-center text-gray-400 italic mt-2">Sınav kodunu girince liste açılacaktır.</p>
      </div>
      <button id="startQuizButton" class="button w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg shadow-lg opacity-50 cursor-not-allowed" disabled>Sınava Başla</button>
      <div class="border-t pt-4 mt-4">
        <button id="teacherLoginButton" class="text-gray-400 hover:text-gray-600 text-xs w-full text-center">Yönetici Girişi</button>
      </div>
    </div>
  `;
  document.getElementById('teacherLoginButton').onclick = showTeacherLogin;
  document.getElementById('examCodeInput').oninput = handleCodeEntry;
  document.getElementById('startQuizButton').onclick = handleStudentLogin;
}

async function handleCodeEntry() {
  clearTimeout(typingTimer);
  const code = sanitizeExamCode(document.getElementById('examCodeInput').value.trim());
  const infoArea = document.getElementById('examInfoArea');
  const loginFields = document.getElementById('studentLoginFields');
  const btn = document.getElementById('startQuizButton');

  if (code.length < 3) {
    infoArea.classList.add('hidden');
    document.getElementById('teacherDisplayArea').classList.add('opacity-0');
    return;
  }

  typingTimer = setTimeout(async () => {
    try {
      const res = await rpc('get_exam_public', { p_code: code });
      if (!res?.ok) {
        infoArea.innerHTML = `<p class="font-bold text-red-700">Sınav bulunamadı</p>`;
        infoArea.classList.remove('hidden');
        loginFields.innerHTML = `<p class="text-sm text-center text-gray-400">Geçerli bir kod girin.</p>`;
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        document.getElementById('teacherDisplayArea').classList.add('opacity-0');
        return;
      }

      const ex = res.exam;
      state.currentExamConfig = {
        exam_code: ex.code,
        teacher_name: ex.teacher_name,
        time_limit: ex.time_limit,
        exam_description: ex.description,
        is_active: ex.is_active,
      };
      state.examClasses = Array.isArray(ex.classes) ? ex.classes : [];

      document.getElementById('teacherNameDisplay').innerText = ex.teacher_name || state.systemPreparerName;
      document.getElementById('teacherDisplayArea').classList.remove('opacity-0');

      let infoHtml = `<p class="font-bold">Sınav: ${escapeHtml(ex.code)}</p>
        <p>${sanitizeInput(ex.description || '')}</p>
        <p class="text-xs mt-1">⏱️ Süre: ${Math.floor(ex.time_limit / 60)} Dk | 📝 Soru: ${ex.question_count} | 👥 ${ex.student_count} öğrenci</p>`;

      if (ex.is_active === false) {
        infoArea.innerHTML =
          `<div class="bg-orange-100 border-l-4 border-orange-500 text-orange-700 p-3 rounded mb-2">
            <p class="font-bold">🔒 Sınav Erişimi Kapalı</p>
            <p class="text-xs">Yeni giriş yok; sadece sonucu olanlar şifre ile bakabilir.</p>
          </div>` + infoHtml;
      } else {
        infoArea.innerHTML = infoHtml;
      }
      infoArea.classList.remove('hidden');

      if (!state.examClasses.length) {
        loginFields.innerHTML = `<div class="bg-red-50 p-4 rounded border border-red-200 text-center">
          <p class="text-red-700 font-bold mb-2">⚠️ Liste Bulunamadı</p>
          <p class="text-xs text-red-600">Bu sınava öğrenci listesi yüklenmemiş.</p>
        </div>`;
        btn.disabled = true;
        return;
      }

      loginFields.innerHTML = `
        <select id="classSelector" class="w-full p-3 border rounded-lg font-bold text-indigo-700 bg-white">
          <option value="">-- Sınıfınızı Seçin --</option>
          ${state.examClasses.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
        </select>
        <select id="studentSelector" class="w-full p-3 border rounded-lg bg-gray-100" disabled>
          <option value="">-- Önce Sınıf Seçin --</option>
        </select>
        <div id="verificationArea" class="hidden mt-2 space-y-2">
          <input id="numberVerify" type="text" inputmode="numeric" placeholder="Doğrulama: Okul Numaranız" class="w-full p-3 border-2 border-indigo-300 rounded-lg" />
          <div>
            <input id="studentPassword" type="text" placeholder="Sınav Şifresi Belirleyiniz (Sonuç İçin)" class="w-full p-3 border-2 border-orange-300 rounded-lg bg-orange-50 text-orange-900 font-bold" />
            <p class="text-[10px] text-gray-400 mt-1 pl-1">* Sonucunuzu daha sonra görmek için bu şifre gereklidir.</p>
          </div>
        </div>
      `;

      document.getElementById('classSelector').onchange = async (e) => {
        const cls = e.target.value;
        const stuSel = document.getElementById('studentSelector');
        stuSel.innerHTML = '<option value="">-- Adınızı Seçin --</option>';
        stuSel.disabled = !cls;
        stuSel.classList.toggle('bg-gray-100', !cls);
        document.getElementById('verificationArea').classList.add('hidden');
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        if (!cls) return;

        if (!state.studentListCache[cls]) {
          const listRes = await rpc('get_students_by_class', { p_code: code, p_class: cls });
          state.studentListCache[cls] = listRes?.ok ? listRes.students : [];
        }
        const filtered = state.studentListCache[cls] || [];
        stuSel.innerHTML += filtered
          .map((s) => `<option value="${escapeHtml(s.number)}_${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`)
          .join('');
      };

      document.getElementById('studentSelector').onchange = (e) => {
        if (e.target.value) {
          document.getElementById('verificationArea').classList.remove('hidden');
          document.getElementById('numberVerify').focus();
        } else {
          document.getElementById('verificationArea').classList.add('hidden');
        }
      };

      document.getElementById('numberVerify').oninput = (e) => {
        const val = e.target.value.trim();
        btn.disabled = !val;
        btn.classList.toggle('opacity-50', !val);
        btn.classList.toggle('cursor-not-allowed', !val);
      };
    } catch (err) {
      infoArea.innerHTML = `<p class="text-red-700 font-bold">Bağlantı hatası: ${escapeHtml(err.message)}</p>`;
      infoArea.classList.remove('hidden');
    }
  }, 400);
}

async function handleStudentLogin() {
  const code = sanitizeExamCode(document.getElementById('examCodeInput').value.trim());
  const selVal = document.getElementById('studentSelector')?.value;
  if (!selVal) return showCustomAlert('Hata', 'Lütfen listeden isminizi seçiniz.');

  const inputNum = document.getElementById('numberVerify').value.trim();
  const password = document.getElementById('studentPassword').value.trim();
  if (!inputNum || !password) {
    return showCustomAlert('Eksik Bilgi', 'Numaranızı doğrulayın ve bir şifre belirleyin.');
  }

  const parts = selVal.split('_');
  const realNum = parts[0];
  const realName = parts.slice(1).join('_').trim();
  const className = document.getElementById('classSelector').value;

  if (realNum !== inputNum) {
    return showCustomAlert('Hatalı Doğrulama', 'Girdiğiniz numara seçilen öğrenciyle eşleşmiyor.');
  }

  const loadBtn = document.getElementById('startQuizButton');
  loadBtn.innerText = 'Kontrol Ediliyor...';
  loadBtn.disabled = true;

  try {
    const res = await rpc('student_enter', {
      p_code: code,
      p_number: realNum,
      p_name: realName,
      p_class: className,
      p_password: password,
    });

    if (!res?.ok) {
      loadBtn.innerText = 'Sınava Başla';
      loadBtn.disabled = false;
      return showCustomAlert('Giriş', res?.error || 'Giriş başarısız');
    }

    state.studentPassword = password;

    if (res.mode === 'result') {
      loadBtn.innerText = 'Giriş';
      loadBtn.disabled = false;
      await showCustomAlert('Giriş Başarılı', 'Sonuç paneline yönlendiriliyorsunuz...');
      return showStudentDashboard(res.submission, { password });
    }

    await enterExamMode(res, { code, number: realNum, className });
  } catch (e) {
    showCustomAlert('Hata', e.message);
    loadBtn.innerText = 'Sınava Başla';
    loadBtn.disabled = false;
  }
}

// ── ORTAK MANTIK (YENİ): hem elle giriş (handleStudentLogin) hem otomatik
// giriş (tryAutoLoginFromUrl), student_enter/student_auto_enter'dan "mode:
// exam" cevabı aldıktan SONRA state'i kurup sınavı başlatan bu fonksiyonu
// çağırır — kod tekrarını önler, ikisinin de AYNI davranışta olmasını garantiler.
async function enterExamMode(res, { code, number, className }) {
  state.studentData = {
    name: res.student.name,
    number: res.student.number,
    className: res.student.className,
    examCode: res.student.examCode,
  };
  state.currentExamConfig = {
    exam_code: res.exam.code,
    teacher_name: res.exam.teacher_name,
    time_limit: res.exam.time_limit,
    exam_description: res.exam.description,
    is_active: res.exam.is_active,
  };

  const qs = (res.questions || []).slice().sort((a, b) => a.idx - b.idx);
  state.quizQuestions = qs.map((q) => ({
    question: q.question,
    options: q.options || [],
    image: q.image || '',
  }));

  const ses = res.session;
  state.sessionId = ses.id;
  state.clientToken = ses.client_token;
  state.questionOrder = ses.questionOrder || [];
  state.selectedAnswers = Array.isArray(ses.selectedAnswers)
    ? ses.selectedAnswers.map((a) => (a === undefined ? null : a))
    : [];
  state.questionDurations = Array.isArray(ses.questionDurations)
    ? ses.questionDurations.map((d) => Number(d) || 0)
    : Array(state.quizQuestions.length).fill(0);
  state.currentQuestionIndex = ses.currentQuestionIndex || 0;
  state.focusLossCount = ses.focusLossCount || 0;

  if (
    state.questionOrder.length === state.quizQuestions.length &&
    state.questionOrder.every((v, i) => v === i)
  ) {
    const hasAns = state.selectedAnswers.some((a) => a != null && a !== '');
    if (!hasAns) {
      state.questionOrder = seededOrder(state.quizQuestions.length, number);
    }
  }

  let timeLeft = ses.timeLeft || state.currentExamConfig.time_limit;

  const local = restoreFromLocalBackup(code, number);
  if (local && local.timestamp) {
    const serverGuess = Date.now() - 60_000;
    if (local.timestamp > serverGuess - 5 * 60_000) {
      if (local.answers) state.selectedAnswers = local.answers;
      if (typeof local.timeLeft === 'number') timeLeft = local.timeLeft;
      if (typeof local.lastQuestionIndex === 'number') state.currentQuestionIndex = local.lastQuestionIndex;
      if (typeof local.focusLossCount === 'number') state.focusLossCount = local.focusLossCount;
      await showCustomAlert('Cihaz Yedeği', 'Yerel yedek ile birleştirildi.');
    }
  }

  state.examEndTimestamp = Date.now() + timeLeft * 1000;
  state.lastQuestionStartTime = Date.now();

  if (navigator.onLine) {
    const flushed = await tryFlushPendingSubmit({ examCode: code, number });
    if (flushed?.ok) return;
  }

  startQuiz();
}

function seededOrder(n, seed) {
  const arr = Array.from({ length: n }, (_, i) => i);
  // inline shuffle to avoid circular import issues
  let hash = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) hash = (((hash << 5) - hash) + s.charCodeAt(i)) | 0;
  let len = arr.length;
  while (len > 1) {
    hash = (hash * 9301 + 49297) % 233280;
    const random = (hash < 0 ? hash + 233280 : hash) / 233280.0;
    const k = Math.floor(random * len--);
    [arr[len], arr[k]] = [arr[k], arr[len]];
  }
  return arr;
}

export function applyLocalBackupMerge() {
  /* used externally if needed */
  void backupKey;
  void sanitizeInput;
}
