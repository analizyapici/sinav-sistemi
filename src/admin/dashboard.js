import * as XLSX from 'xlsx';
import Chart from 'chart.js/auto';
import { rpc } from '../lib/supabase.js';
import {
  sanitizeExamCode,
  sanitizeInput,
  escapeHtml,
  showCustomAlert,
  hideModal,
  getAdminToken,
  setAdminToken,
  formatTime,
} from '../lib/utils.js';
import { state, clearExamRuntime } from '../state.js';
import { showLoginForm } from '../student/login.js';
import { showStudentDashboard } from '../student/results.js';
import { previewExamAsAdmin } from '../student/quiz.js';

export function resetApp() {
  clearExamRuntime();
  state.isTeacherMode = false;
  setAdminToken(null);
  document.getElementById('app').className = 'app-card max-w-md';
  document.getElementById('connectionStatus').classList.remove('hidden');
  showLoginForm();
}

export function showDashboard() {
  document.getElementById('connectionStatus').classList.add('hidden');
  document.getElementById('app').className = 'app-card teacher-mode';
  document.getElementById('loginHeader').innerHTML = `
    <h1 class="text-2xl font-bold flex justify-between items-center px-4">
      <span>Yönetim Paneli</span>
      <button id="logoutBtn" class="text-sm bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded">Çıkış</button>
    </h1>`;
  document.getElementById('logoutBtn').onclick = resetApp;

  document.getElementById('mainContentArea').innerHTML = `
    <div class="flex flex-wrap gap-2 mb-6 border-b pb-4">
      <button data-tab="results" class="tab-btn flex-1 min-w-[120px] px-4 py-2 bg-indigo-600 text-white rounded shadow text-sm font-semibold">📊 Sonuçlar</button>
      <button data-tab="settings" class="tab-btn flex-1 min-w-[120px] px-4 py-2 bg-gray-600 text-white rounded shadow text-sm font-semibold">⚙️ Sınav Oluştur</button>
      <button data-tab="questions" class="tab-btn flex-1 min-w-[120px] px-4 py-2 bg-orange-600 text-white rounded shadow text-sm font-semibold">📝 Sorular</button>
      <button data-tab="lists" class="tab-btn flex-1 min-w-[120px] px-4 py-2 bg-teal-600 text-white rounded shadow text-sm font-semibold">👥 Öğrenciler</button>
      <button data-tab="myexams" class="tab-btn flex-1 min-w-[120px] px-4 py-2 bg-purple-600 text-white rounded shadow text-sm font-semibold">📂 Sınavlarım</button>
      <button data-tab="online" class="tab-btn flex-1 min-w-[120px] px-4 py-2 bg-green-600 text-white rounded shadow text-sm font-semibold">👁️ Online</button>
    </div>

    <div id="tab-results" class="tab-content">
      <div class="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h2 class="font-bold text-lg text-gray-700">Sonuç Listesi</h2>
        <div class="flex gap-2 flex-wrap">
          <button id="btnLoadResults" class="bg-indigo-600 text-white px-3 py-1 rounded text-sm">🔄 Yenile</button>
          <button id="btnExcel" class="bg-green-600 text-white px-3 py-1 rounded text-sm">Excel</button>
          <button id="btnExcelDet" class="bg-blue-600 text-white px-3 py-1 rounded text-sm">Detaylı Excel</button>
        </div>
      </div>
      <div class="flex flex-wrap gap-2 mb-4">
        <input id="filterCode" placeholder="Kod" class="p-2 border rounded text-sm w-24" />
        <input id="filterName" placeholder="İsim" class="p-2 border rounded text-sm flex-1" />
        <select id="filterClass" class="p-2 border rounded text-sm w-32"><option value="">Tüm Sınıflar</option></select>
        <button id="btnBulkDel" class="bg-red-600 text-white px-3 py-1 rounded text-sm">Filtrelenmişleri Sil</button>
        <button id="btnDelAll" class="bg-red-800 text-white px-3 py-1 rounded text-sm">Tümünü Sil</button>
      </div>
      <div class="overflow-auto max-h-[500px] border rounded-lg">
        <table class="min-w-full divide-y text-sm">
          <thead class="bg-gray-100 sticky top-0">
            <tr>
              <th class="p-3 text-left">No</th>
              <th class="p-3 text-left">Öğrenci</th>
              <th class="p-3 text-left">Kod</th>
              <th class="p-3 text-left cursor-pointer" id="sortScore">Puan</th>
              <th class="p-3 text-left">D/Y/B</th>
              <th class="p-3 text-left">Süre</th>
              <th class="p-3 text-left">Odak</th>
              <th class="p-3 text-left">IP</th>
              <th class="p-3 text-left cursor-pointer" id="sortTime">Tarih</th>
              <th class="p-3 text-left">İşlem</th>
            </tr>
          </thead>
          <tbody id="resultsTableBody"></tbody>
        </table>
      </div>
    </div>

    <div id="tab-online" class="tab-content hidden">
      <div class="flex justify-between mb-4">
        <h2 class="font-bold text-lg">🟢 Online Öğrenciler</h2>
        <button id="btnRefreshOnline" class="bg-green-600 text-white px-3 py-1 rounded text-sm">Yenile</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-green-50 p-4 rounded-xl border text-center"><div class="text-3xl font-bold text-green-700" id="totalOnlineCount">0</div><div class="text-sm">Toplam Online</div></div>
        <div class="bg-blue-50 p-4 rounded-xl border text-center"><div class="text-3xl font-bold text-blue-700" id="activeExamsCount">0</div><div class="text-sm">Aktif Sınav</div></div>
        <div class="bg-purple-50 p-4 rounded-xl border text-center"><div class="text-3xl font-bold text-purple-700" id="totalClassesCount">0</div><div class="text-sm">Sınıf</div></div>
      </div>
      <div class="overflow-x-auto border rounded">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100"><tr>
            <th class="p-3 text-left">Öğrenci</th><th class="p-3 text-left">Sınıf</th><th class="p-3 text-left">Kod</th>
            <th class="p-3 text-left">Soru</th><th class="p-3 text-left">Kalan</th><th class="p-3 text-left">Odak</th>
          </tr></thead>
          <tbody id="onlineStudentsTable"></tbody>
        </table>
      </div>
    </div>

    <div id="tab-questions" class="tab-content hidden">
      <div class="max-w-2xl mx-auto">
        <div class="bg-orange-50 p-4 rounded-lg border mb-4">
          <label class="block font-bold text-orange-800 mb-1">Sınav</label>
          <select id="uploadQCode" class="w-full p-2 border rounded uppercase font-bold bg-white"></select>
        </div>
        <textarea id="jsonInput" rows="10" class="w-full p-3 font-mono text-xs border rounded bg-gray-900 text-green-400" placeholder='[{"question":"...","options":["A","B"],"answer":"A"}]'></textarea>
        <div class="flex justify-between mt-2">
          <button id="btnSampleJson" class="text-xs text-gray-500 underline">Örnek</button>
          <button id="btnUploadQ" class="bg-orange-600 text-white px-6 py-2 rounded font-bold">SORULARI YÜKLE</button>
        </div>
      </div>
    </div>

    <div id="tab-settings" class="tab-content hidden">
      <div class="max-w-lg mx-auto space-y-4">
        <div class="bg-gray-50 p-4 rounded border">
          <h3 class="font-bold mb-2">Sınav Oluştur / Düzenle</h3>
          <input id="setExamCode" class="w-full p-2 border rounded mb-2 uppercase" placeholder="Kod (9A_MAT)" />
          <input id="setTeacherName" class="w-full p-2 border rounded mb-2" placeholder="Öğretmen" />
          <div class="flex gap-2">
            <input id="setTime" type="number" class="w-1/3 p-2 border rounded mb-2" placeholder="Süre Dk" value="40" />
            <input id="setDesc" class="flex-1 p-2 border rounded mb-2" placeholder="Açıklama" />
          </div>
          <button id="btnSaveSettings" class="w-full bg-gray-700 text-white p-2 rounded font-bold">Kaydet</button>
        </div>
        <div class="bg-red-50 p-4 rounded border border-red-200">
          <h3 class="font-bold text-red-700 mb-2">Yönetici Şifresi</h3>
          <input id="newAdminPass" type="password" class="w-full p-2 border rounded mb-2" placeholder="Yeni şifre" />
          <button id="btnChangePass" class="w-full bg-red-600 text-white p-2 rounded font-bold">Güncelle</button>
        </div>
      </div>
    </div>

    <div id="tab-lists" class="tab-content hidden">
      <div class="max-w-2xl mx-auto">
        <div class="bg-teal-50 p-4 rounded border mb-4">
          <label class="font-bold text-teal-800">Sınav</label>
          <select id="uploadListCode" class="w-full p-2 border rounded uppercase font-bold bg-white"></select>
        </div>
        <div class="paste-area" id="listInput" contenteditable="true"></div>
        <p class="text-xs text-gray-500 mt-1">E-Okul Excel sürükle-bırak veya yapıştır (No | Sınıf | Ad). Alternatif: her satır <code>numara;sınıf;ad soyad</code></p>
        <button id="btnUploadList" class="w-full mt-2 bg-teal-600 text-white py-2 rounded font-bold">Listeyi Kaydet</button>
      </div>
    </div>

    <div id="tab-myexams" class="tab-content hidden">
      <div id="myExamsList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">Yükleniyor...</div>
    </div>
  `;

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.onclick = () => changeTab(btn.dataset.tab);
  });

  document.getElementById('btnLoadResults').onclick = loadResults;
  document.getElementById('btnExcel').onclick = exportToExcel;
  document.getElementById('btnExcelDet').onclick = exportDetailed;
  document.getElementById('btnBulkDel').onclick = bulkDeleteFiltered;
  document.getElementById('btnDelAll').onclick = bulkDeleteAll;
  document.getElementById('filterCode').oninput = renderResultsTable;
  document.getElementById('filterName').oninput = renderResultsTable;
  document.getElementById('filterClass').onchange = renderResultsTable;
  document.getElementById('sortScore').onclick = () => toggleSort('score');
  document.getElementById('sortTime').onclick = () => toggleSort('timestamp');

  document.getElementById('btnRefreshOnline').onclick = loadOnlineStudents;
  document.getElementById('btnSampleJson').onclick = () => {
    document.getElementById('jsonInput').value = JSON.stringify(
      [
        {
          question: "Türkiye'nin başkenti neresidir?",
          options: ['İstanbul', 'Ankara', 'İzmir', 'Bursa'],
          answer: 'Ankara',
        },
      ],
      null,
      2
    );
  };
  document.getElementById('btnUploadQ').onclick = uploadQuestions;
  document.getElementById('btnSaveSettings').onclick = saveSettings;
  document.getElementById('btnChangePass').onclick = changePass;
  document.getElementById('btnUploadList').onclick = uploadList;
  setupListDragDrop();

  window.changeTab = changeTab;
  window.viewStudentResult = viewStudentResult;
  window.deleteSub = deleteSub;
  window.showTimeAnalysis = showTimeAnalysis;
  window.toggleExamStatus = toggleExamStatus;
  window.showExamStatistics = showExamStatistics;
  window.previewExam = previewExam;
  window.deleteExam = deleteExam;
  window.updateExamTeacher = updateExamTeacher;
  window.updateExamName = updateExamName;
  window.showExamQuestions = showExamQuestions;
  window.showExamStudents = showExamStudents;
  window.askExportFormat = askExportFormat;
  window.importExamQuestions = importExamQuestions;

  loadResults();
}

function token() {
  return getAdminToken();
}

function changeTab(t) {
  document.querySelectorAll('.tab-content').forEach((el) => el.classList.add('hidden'));
  document.getElementById('tab-' + t)?.classList.remove('hidden');
  if (t === 'results') loadResults();
  if (t === 'myexams') loadMyExams();
  if (t === 'questions' || t === 'lists') populateExamSelects();
  if (t === 'online') loadOnlineStudents();
}

async function populateExamSelects() {
  const res = await rpc('admin_list_exams', { p_token: token() });
  if (!res?.ok) return;
  const opts =
    '<option value="">-- Sınav Seçiniz --</option>' +
    (res.exams || []).map((e) => `<option value="${escapeHtml(e.code)}">${escapeHtml(e.code)}</option>`).join('');
  const q = document.getElementById('uploadQCode');
  const l = document.getElementById('uploadListCode');
  if (q) q.innerHTML = opts;
  if (l) l.innerHTML = opts;
}

async function saveSettings() {
  const code = sanitizeExamCode(document.getElementById('setExamCode').value);
  const teacher = document.getElementById('setTeacherName').value.trim();
  const time = parseInt(document.getElementById('setTime').value, 10) || 40;
  const desc = document.getElementById('setDesc').value.trim();
  if (!code || !teacher) return alert('Kod ve öğretmen gerekli');
  const res = await rpc('admin_upsert_exam', {
    p_token: token(),
    p_code: code,
    p_teacher: teacher,
    p_time_min: time,
    p_desc: desc,
  });
  if (!res?.ok) return alert(res?.error || 'Hata');
  alert('Sınav kaydedildi: ' + res.code);
  populateExamSelects();
}

async function changePass() {
  const p = document.getElementById('newAdminPass').value;
  if (p.length < 4) return alert('Şifre kısa');
  if (!confirm('Şifreyi değiştir?')) return;
  const res = await rpc('admin_change_password', { p_token: token(), p_new: p });
  if (!res?.ok) return alert(res?.error || 'Hata');
  alert('Şifre güncellendi');
}

async function uploadQuestions() {
  const code = document.getElementById('uploadQCode').value;
  const raw = document.getElementById('jsonInput').value;
  if (!code) return alert('Sınav seçin');
  if (!confirm('Sorular yüklensin mi? (öncekiler silinir)')) return;
  try {
    const parsed = JSON.parse(raw);
    const res = await rpc('admin_set_questions', {
      p_token: token(),
      p_code: code,
      p_questions: parsed,
    });
    if (!res?.ok) throw new Error(res?.error);
    alert(res.count + ' soru yüklendi');
    document.getElementById('jsonInput').value = '';
  } catch (e) {
    alert('JSON/Hata: ' + e.message);
  }
}

function parseStudentPaste(txt) {
  const students = [];
  const lines = txt.split('\n');
  let currentClass = '';

  for (let line of lines) {
    line = line.trim().replace(/"/g, '').replace(/(\d{3,}[A-Z]{3,}\d{3,})$/, '').trim();
    if (!line) continue;

    // simple CSV: number;class;name OR number,class,name
    if (line.includes(';') || (line.split(',').length >= 3 && !/\sSınıf/i.test(line))) {
      const parts = line.includes(';') ? line.split(';') : line.split(',');
      if (parts.length >= 3) {
        const num = parts[0].trim();
        const cls = parts[1].trim();
        const name = parts.slice(2).join(' ').trim();
        if (num && cls && name.length > 1) students.push({ number: num, className: cls, name });
        continue;
      }
    }

    const classMatch = line.match(/(\d+)\.\s*Sınıf\s*\/\s*([A-Z])/i);
    if (classMatch) {
      currentClass = classMatch[1] + classMatch[2];
      continue;
    }
    if (!currentClass) continue;
    const studentMatch = line.match(/^\s*\d+\s+(\d+)\s+(.+)\s+(Erkek|Kız)/i);
    if (studentMatch) {
      const num = studentMatch[1].trim();
      const rawName = studentMatch[2].trim();
      if (rawName.includes('Adı Soyadı')) continue;
      if (!isNaN(num) && rawName.length > 2) {
        students.push({ number: num, className: currentClass, name: rawName });
      }
    }
  }
  return students;
}

async function uploadList() {
  const code = document.getElementById('uploadListCode').value;
  const txt = document.getElementById('listInput').innerText;
  if (!code || !txt.trim()) return alert('Sınav ve liste gerekli');
  const btn = document.getElementById('btnUploadList');
  btn.disabled = true;
  btn.innerText = 'İşleniyor...';
  try {
    const students = parseStudentPaste(txt);
    if (!students.length) throw new Error('Öğrenci bulunamadı. Format: numara;sınıf;ad soyad');
    const res = await rpc('admin_set_students', {
      p_token: token(),
      p_code: code,
      p_students: students,
    });
    if (!res?.ok) throw new Error(res?.error);
    alert(`✅ ${res.count} öğrenci kaydedildi`);
    document.getElementById('listInput').innerText = '';
  } catch (e) {
    alert(e.message);
  } finally {
    btn.innerText = 'Listeyi Kaydet';
    btn.disabled = false;
  }
}

function setupListDragDrop() {
  const area = document.getElementById('listInput');
  if (!area) return;
  area.addEventListener('dragover', (e) => {
    e.preventDefault();
    area.classList.add('border-indigo-500', 'bg-indigo-50');
  });
  area.addEventListener('dragleave', (e) => {
    e.preventDefault();
    area.classList.remove('border-indigo-500', 'bg-indigo-50');
  });
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('border-indigo-500', 'bg-indigo-50');
    if (e.dataTransfer.files?.[0]) readExcelFile(e.dataTransfer.files[0]);
  });
}

function readExcelFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawText = XLSX.utils.sheet_to_csv(sheet, { FS: ' ' });
      document.getElementById('listInput').innerText = rawText.replace(/"/g, '');
      alert('Excel okundu');
    } catch (err) {
      alert(err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

async function loadResults() {
  const tbody = document.getElementById('resultsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" class="p-4 text-center">Yükleniyor...</td></tr>';
  try {
    const res = await rpc('admin_list_submissions', {
      p_token: token(),
      p_code: null,
      p_name: null,
      p_class: null,
      p_limit: 250,
      p_offset: 0,
    });
    if (!res?.ok) throw new Error(res?.error);
    state.allSubmissions = (res.submissions || []).map((s) => {
      let formattedDateTime = '-';
      if (s.submitted_at) {
        const d = new Date(s.submitted_at);
        formattedDateTime = d.toLocaleString('tr-TR');
      }
      return { ...s, formattedDateTime, timestamp: s.submitted_at ? new Date(s.submitted_at).getTime() / 1000 : 0 };
    });
    updateClassFilter();
    renderResultsTable();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="p-4 text-red-500">${escapeHtml(e.message)}</td></tr>`;
  }
}

function updateClassFilter() {
  const cf = document.getElementById('filterClass');
  if (!cf) return;
  const cls = [...new Set(state.allSubmissions.map((s) => s.className).filter(Boolean))].sort();
  cf.innerHTML =
    '<option value="">Tüm Sınıflar</option>' +
    cls.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

function toggleSort(col) {
  if (state.currentSort.column === col) {
    state.currentSort.direction = state.currentSort.direction === 'desc' ? 'asc' : 'desc';
  } else {
    state.currentSort.column = col;
    state.currentSort.direction = 'desc';
  }
  renderResultsTable();
}

function renderResultsTable() {
  const fCode = (document.getElementById('filterCode')?.value || '').toLowerCase();
  const fName = (document.getElementById('filterName')?.value || '').toLowerCase();
  const fClass = document.getElementById('filterClass')?.value || '';
  const tbody = document.getElementById('resultsTableBody');
  if (!tbody) return;

  let filtered = state.allSubmissions.filter(
    (s) =>
      (s.examCode || '').toLowerCase().includes(fCode) &&
      (s.name || '').toLowerCase().includes(fName) &&
      (!fClass || s.className === fClass)
  );

  filtered.sort((a, b) => {
    let valA;
    let valB;
    if (state.currentSort.column === 'score') {
      valA = parseFloat(a.score || 0);
      valB = parseFloat(b.score || 0);
    } else {
      valA = a.timestamp || 0;
      valB = b.timestamp || 0;
    }
    if (valA < valB) return state.currentSort.direction === 'asc' ? -1 : 1;
    if (valA > valB) return state.currentSort.direction === 'asc' ? 1 : -1;
    return 0;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="p-4 text-center text-gray-400">Kayıt yok</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((s, index) => {
      const min = Math.floor((s.timeSpent || 0) / 60);
      const sec = (s.timeSpent || 0) % 60;
      return `<tr class="hover:bg-gray-50 border-b">
        <td class="p-3 font-bold text-gray-500">${index + 1}</td>
        <td class="p-3"><div class="font-bold">${escapeHtml(s.name)}</div>
          <div class="text-xs text-gray-500">${escapeHtml(s.number)} - ${escapeHtml(s.className)}</div></td>
        <td class="p-3 font-mono text-xs">${escapeHtml(s.examCode)}</td>
        <td class="p-3 font-bold ${parseFloat(s.score) >= 50 ? 'text-green-600' : 'text-red-600'}">${escapeHtml(s.score)}</td>
        <td class="p-3 text-xs">${s.correct}D / ${s.incorrect}Y / ${s.empty}B</td>
        <td class="p-3 text-xs">${min}:${sec < 10 ? '0' : ''}${sec}</td>
        <td class="p-3 text-xs">${s.focusLossCount || 0}</td>
        <td class="p-3 text-xs font-mono">${escapeHtml(s.ipAddress || 'N/A')}</td>
        <td class="p-3 text-xs">${escapeHtml(s.formattedDateTime)}</td>
        <td class="p-3 flex gap-1 flex-wrap">
          <button data-act="view" data-id="${s.id}" class="bg-indigo-50 text-indigo-600 border px-2 py-1 rounded text-xs font-bold">Karne</button>
          <button data-act="time" data-id="${s.id}" class="text-blue-600 border px-2 py-1 rounded text-xs">Süre</button>
          <button data-act="del" data-id="${s.id}" class="text-red-600 border px-2 py-1 rounded text-xs">Sil</button>
        </td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('button[data-act]').forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.id;
      if (b.dataset.act === 'view') viewStudentResult(id);
      if (b.dataset.act === 'time') showTimeAnalysis(id);
      if (b.dataset.act === 'del') deleteSub(id);
    };
  });
}

async function viewStudentResult(id) {
  state.isAdminViewingResult = true;
  showCustomAlert('Yükleniyor', '<div class="loader"></div>');
  try {
    const res = await rpc('admin_get_submission', { p_token: token(), p_id: id });
    hideModal();
    if (!res?.ok) throw new Error(res?.error);
    showStudentDashboard(res.submission);
  } catch (e) {
    hideModal();
    alert(e.message);
    state.isAdminViewingResult = false;
  }
}

function showTimeAnalysis(id) {
  const sub = state.allSubmissions.find((s) => s.id === id);
  if (!sub?.questionDurations) return alert('Süre verisi yok');
  const durs = Array.isArray(sub.questionDurations) ? sub.questionDurations : [];
  let content = `<div class="max-h-[60vh] overflow-y-auto"><h3 class="font-bold mb-2">${escapeHtml(sub.name)}</h3>
    <table class="w-full text-sm border"><thead class="bg-gray-100"><tr><th class="p-2 border">Soru</th><th class="p-2 border">Sn</th></tr></thead><tbody>`;
  durs.forEach((dur, i) => {
    content += `<tr><td class="p-2 border text-center">${i + 1}</td><td class="p-2 border text-center">${Math.floor(Number(dur) || 0)}</td></tr>`;
  });
  content += '</tbody></table></div>';
  showCustomAlert('Süre Analizi', content);
}

async function deleteSub(id) {
  if (!confirm('Silinsin mi?')) return;
  await rpc('admin_delete_submission', { p_token: token(), p_id: id });
  loadResults();
}

async function bulkDeleteFiltered() {
  const fCode = document.getElementById('filterCode').value;
  const fName = document.getElementById('filterName').value;
  const fClass = document.getElementById('filterClass').value;
  if (!confirm('Filtrelenmiş kayıtlar silinsin mi?')) return;
  const res = await rpc('admin_delete_submissions_filtered', {
    p_token: token(),
    p_code: fCode,
    p_name: fName,
    p_class: fClass,
    p_all: false,
  });
  alert((res?.deleted || 0) + ' silindi');
  loadResults();
}

async function bulkDeleteAll() {
  if (!confirm('TÜM sonuçlar silinecek!')) return;
  await rpc('admin_delete_submissions_filtered', {
    p_token: token(),
    p_code: '',
    p_name: '',
    p_class: '',
    p_all: true,
  });
  loadResults();
}

async function exportToExcel() {
  const res = await rpc('admin_list_submissions', {
    p_token: token(),
    p_limit: 500,
    p_offset: 0,
  });
  const rows = (res.submissions || []).map((d) => ({
    Tarih: d.submitted_at ? new Date(d.submitted_at).toLocaleString('tr-TR') : '-',
    'Öğrenci Adı': d.name,
    Sınıf: d.className,
    Numara: d.number,
    'Sınav Kodu': d.examCode,
    Puan: d.score,
    Doğru: d.correct,
    Yanlış: d.incorrect,
    Boş: d.empty,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sonuclar');
  XLSX.writeFile(wb, 'sinav_sonuclari.xlsx');
}

function exportDetailed() {
  const fCode = (document.getElementById('filterCode')?.value || '').toLowerCase();
  const fName = (document.getElementById('filterName')?.value || '').toLowerCase();
  const fClass = document.getElementById('filterClass')?.value || '';
  const filtered = state.allSubmissions.filter(
    (s) =>
      (s.examCode || '').toLowerCase().includes(fCode) &&
      (s.name || '').toLowerCase().includes(fName) &&
      (!fClass || s.className === fClass)
  );
  const data = filtered.map((s) => {
    const row = {
      Ad: s.name,
      Numara: s.number,
      Sınıf: s.className,
      Kod: s.examCode,
      Puan: s.score,
      D: s.correct,
      Y: s.incorrect,
      B: s.empty,
    };
    (s.allAnswers || []).forEach((a, i) => {
      row['S' + (i + 1)] = a || '';
    });
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detay');
  XLSX.writeFile(wb, 'detayli_sonuclar.xlsx');
}

async function loadOnlineStudents() {
  const tbody = document.getElementById('onlineStudentsTable');
  tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center">Yükleniyor...</td></tr>';
  try {
    const res = await rpc('admin_online_students', { p_token: token() });
    if (!res?.ok) throw new Error(res?.error);
    const list = res.students || [];
    document.getElementById('totalOnlineCount').textContent = list.length;
    const exams = new Set(list.map((s) => s.examCode));
    const classes = new Set(list.map((s) => s.className));
    document.getElementById('activeExamsCount').textContent = exams.size;
    document.getElementById('totalClassesCount').textContent = classes.size;

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-gray-500">Aktif yok</td></tr>';
      return;
    }
    tbody.innerHTML = list
      .map(
        (s) => `<tr class="hover:bg-green-50">
        <td class="p-3"><div class="font-bold">${escapeHtml(s.name)}</div><div class="text-xs">${escapeHtml(s.number)}</div></td>
        <td class="p-3">${escapeHtml(s.className)}</td>
        <td class="p-3 font-mono text-blue-600">${escapeHtml(s.examCode)}</td>
        <td class="p-3">${(s.currentQuestionIndex || 0) + 1}</td>
        <td class="p-3 font-mono">${formatTime(s.timeLeft || 0)}</td>
        <td class="p-3">${s.focusLossCount || 0}</td>
      </tr>`
      )
      .join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-red-500">${escapeHtml(e.message)}</td></tr>`;
  }
}

async function loadMyExams() {
  const container = document.getElementById('myExamsList');
  container.innerHTML = '<div class="col-span-full text-center py-10"><div class="loader"></div></div>';
  try {
    const res = await rpc('admin_list_exams', { p_token: token() });
    if (!res?.ok) throw new Error(res?.error);
    const exams = res.exams || [];
    if (!exams.length) {
      container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-10">Sınav yok</div>';
      return;
    }
    container.innerHTML = exams
      .map((exam) => {
        const isActive = exam.is_active !== false;
        return `
        <div class="bg-white p-6 border rounded-xl shadow-sm flex flex-col ${
          isActive ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-red-500 bg-gray-50'
        }">
          <div class="flex justify-between mb-3">
            <div>
              <h3 class="font-extrabold text-xl text-indigo-700">${escapeHtml(exam.code)}</h3>
              <p class="text-sm text-gray-500 italic">${escapeHtml(exam.description || '')}</p>
              <span class="text-[10px] font-bold ${isActive ? 'text-green-600' : 'text-red-600'}">${
                isActive ? 'AKTİF' : 'KAPALI'
              }</span>
            </div>
            <div class="flex flex-col gap-1">
              <button onclick="window.toggleExamStatus('${escapeHtml(exam.code)}', ${isActive})" class="text-xs font-bold px-2 py-1 rounded border">${
                isActive ? '⛔ Kapat' : '✅ Aç'
              }</button>
              <button onclick="window.showExamStatistics('${escapeHtml(exam.code)}')" class="text-xs font-bold px-2 py-1 rounded border bg-teal-50">📊 İstat</button>
              <button onclick="window.previewExam('${escapeHtml(exam.code)}')" class="text-xs font-bold px-2 py-1 rounded border bg-indigo-50">👁️ Önizle</button>
              <button onclick="window.askExportFormat('${escapeHtml(exam.code)}')" class="text-xs font-bold px-2 py-1 rounded border bg-blue-50">📤 JSON</button>
              <button onclick="window.importExamQuestions('${escapeHtml(exam.code)}')" class="text-xs font-bold px-2 py-1 rounded border bg-purple-50">📥 İçe aktar</button>
            </div>
          </div>
          <div class="text-sm space-y-2 flex-grow">
            <div class="flex justify-between border-b py-1"><span>Öğretmen</span>
              <span class="flex gap-1"><input id="tn-${escapeHtml(exam.code)}" class="border p-1 text-xs w-28" value="${escapeHtml(
                exam.teacher_name || ''
              )}" /><button onclick="window.updateExamTeacher('${escapeHtml(
                exam.code
              )}')" class="bg-green-500 text-white px-1 rounded text-xs">💾</button></span>
            </div>
            <div class="flex justify-between border-b py-1"><span>Süre</span><b>${Math.floor(
              (exam.time_limit || 0) / 60
            )} dk</b></div>
            <div class="flex justify-between border-b py-1"><span>Soru</span>
              <button onclick="window.showExamQuestions('${escapeHtml(exam.code)}')" class="text-blue-600 font-bold">${
                exam.question_count
              }</button></div>
            <div class="flex justify-between border-b py-1"><span>Öğrenci</span>
              <button onclick="window.showExamStudents('${escapeHtml(exam.code)}')" class="text-blue-600 font-bold">${
                exam.student_count
              }</button></div>
            <div class="flex justify-between"><span>Katılım</span><b>${exam.submission_count}</b></div>
          </div>
          <button onclick="window.deleteExam('${escapeHtml(
            exam.code
          )}')" class="mt-4 w-full text-xs text-gray-400 border py-2 rounded hover:bg-red-50 hover:text-red-500">Sınavı Sil</button>
        </div>`;
      })
      .join('');
  } catch (e) {
    container.innerHTML = `<div class="text-red-500 p-4">${escapeHtml(e.message)}</div>`;
  }
}

async function toggleExamStatus(code, current) {
  await rpc('admin_toggle_exam', { p_token: token(), p_code: code, p_active: !current });
  loadMyExams();
}

async function updateExamTeacher(code) {
  const v = document.getElementById('tn-' + code)?.value || '';
  await rpc('admin_update_exam_meta', { p_token: token(), p_code: code, p_teacher: v, p_custom_name: null });
  alert('Kaydedildi');
}

async function updateExamName(code, name) {
  await rpc('admin_update_exam_meta', {
    p_token: token(),
    p_code: code,
    p_teacher: null,
    p_custom_name: sanitizeInput(name).replace(/<br>/g, ''),
  });
}

async function deleteExam(code) {
  if (!confirm(`"${code}" silinsin mi?`)) return;
  await rpc('admin_delete_exam', { p_token: token(), p_code: code });
  loadMyExams();
}

async function showExamQuestions(code) {
  const res = await rpc('admin_get_questions', { p_token: token(), p_code: code });
  if (!res?.ok) return alert(res?.error);
  const qs = res.questions || [];
  let html = `<h3 class="font-bold text-lg mb-2">${escapeHtml(code)} — ${qs.length} soru</h3>
    <div class="max-h-[60vh] overflow-y-auto space-y-2 text-left">`;
  qs.forEach((q, i) => {
    html += `<div class="border-l-4 border-indigo-500 p-2 bg-gray-50 rounded">
      <b>${i + 1}.</b> ${sanitizeInput(q.question)}
      <div class="text-xs text-green-700 mt-1">Cevap: ${escapeHtml(q.answer)}</div>
    </div>`;
  });
  html += '</div><p class="text-xs text-gray-500 mt-2">Düzenleme: JSON yükleme sekmesinden toplu güncelleyin.</p>';
  showCustomAlert('', html);
}

async function showExamStudents(code) {
  const res = await rpc('admin_get_students', { p_token: token(), p_code: code });
  if (!res?.ok) return alert(res?.error);
  const st = res.students || [];
  let html = `<h3 class="font-bold mb-2">${escapeHtml(code)} — ${st.length} öğrenci</h3>
    <div class="max-h-[50vh] overflow-auto"><table class="w-full text-sm"><thead class="bg-gray-100 sticky top-0">
    <tr><th class="p-2 text-left">No</th><th class="p-2 text-left">Sınıf</th><th class="p-2 text-left">Ad</th></tr></thead><tbody>`;
  st.forEach((s) => {
    html += `<tr class="border-b"><td class="p-2 font-mono">${escapeHtml(s.number)}</td>
      <td class="p-2">${escapeHtml(s.className)}</td><td class="p-2">${escapeHtml(s.name)}</td></tr>`;
  });
  html += '</tbody></table></div>';
  showCustomAlert('', html);
}

async function showExamStatistics(code) {
  showCustomAlert('Veriler Analiz Ediliyor...', '<div class="loader"></div>');
  try {
    const res = await rpc('admin_exam_stats', { p_token: token(), p_code: code });
    if (!res?.ok) throw new Error(res?.error);
    const subs = res.submissions || [];
    const missing = res.missing || [];

    const classStats = {};
    const dist = { '0-49': 0, '50-69': 0, '70-84': 0, '85-100': 0 };
    subs.forEach((s) => {
      const score = parseFloat(s.score);
      if (!classStats[s.className]) classStats[s.className] = { t: 0, n: 0 };
      classStats[s.className].t += score;
      classStats[s.className].n += 1;
      if (score < 50) dist['0-49']++;
      else if (score < 70) dist['50-69']++;
      else if (score < 85) dist['70-84']++;
      else dist['85-100']++;
    });
    const labels = Object.keys(classStats).sort();
    const avgs = labels.map((c) => (classStats[c].t / classStats[c].n).toFixed(2));
    const sorted = [...subs].sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
    const top5 = sorted.slice(0, 5);
    const bot5 = [...sorted].reverse().slice(0, 5);

    const missingBy = {};
    missing.forEach((m) => {
      if (!missingBy[m.className]) missingBy[m.className] = [];
      missingBy[m.className].push(m);
    });

    const content = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div class="bg-blue-50 p-3 rounded text-center"><div class="text-2xl font-bold">${res.count}</div><div class="text-xs">Katılım</div></div>
        <div class="bg-indigo-50 p-3 rounded text-center"><div class="text-2xl font-bold">${res.average}</div><div class="text-xs">Ortalama</div></div>
        <div class="bg-red-50 p-3 rounded text-center"><div class="text-2xl font-bold">${missing.length}</div><div class="text-xs">Girmeyen</div></div>
        <div class="bg-purple-50 p-3 rounded text-center"><div class="text-2xl font-bold">${labels.length}</div><div class="text-xs">Sınıf</div></div>
      </div>
      <div class="grid md:grid-cols-2 gap-4 mb-4">
        <div class="border p-2 rounded"><canvas id="classChart"></canvas></div>
        <div class="border p-2 rounded"><canvas id="distChart"></canvas></div>
      </div>
      <div class="grid md:grid-cols-2 gap-4 text-xs mb-4">
        <div class="bg-green-50 p-2 rounded"><b>En iyi 5</b><ul>${top5
          .map((s) => `<li class="flex justify-between"><span>${escapeHtml(s.name)}</span><b>${s.score}</b></li>`)
          .join('')}</ul></div>
        <div class="bg-red-50 p-2 rounded"><b>En düşük 5</b><ul>${bot5
          .map((s) => `<li class="flex justify-between"><span>${escapeHtml(s.name)}</span><b>${s.score}</b></li>`)
          .join('')}</ul></div>
      </div>
      <div class="max-h-40 overflow-auto text-xs">
        <b>Girmeyenler</b>
        ${
          missing.length
            ? Object.keys(missingBy)
                .sort()
                .map(
                  (c) =>
                    `<div class="mt-2"><b>${escapeHtml(c)}</b>: ${missingBy[c]
                      .map((m) => escapeHtml(m.name))
                      .join(', ')}</div>`
                )
                .join('')
            : '<p class="text-green-600">Herkes girmiş</p>'
        }
      </div>`;

    const modal = document.getElementById('modalContent');
    modal.innerHTML = `<div class="flex justify-between mb-2"><h3 class="font-bold text-xl">${escapeHtml(
      code
    )} Analiz</h3>
      <button id="closeStat" class="text-2xl">&times;</button></div>${content}
      <button id="modalCloseBtn" class="mt-4 bg-indigo-600 text-white px-6 py-2 rounded font-bold">Tamam</button>`;
    document.getElementById('customModal').classList.remove('hidden');
    document.getElementById('customModal').classList.add('flex');
    document.getElementById('closeStat').onclick = hideModal;
    document.getElementById('modalCloseBtn').onclick = hideModal;

    setTimeout(() => {
      const cc = document.getElementById('classChart');
      const dc = document.getElementById('distChart');
      if (cc)
        new Chart(cc, {
          type: 'bar',
          data: { labels, datasets: [{ label: 'Ort', data: avgs, backgroundColor: '#4f46e5' }] },
          options: { scales: { y: { max: 100, beginAtZero: true } }, plugins: { legend: { display: false } } },
        });
      if (dc)
        new Chart(dc, {
          type: 'doughnut',
          data: {
            labels: Object.keys(dist),
            datasets: [{ data: Object.values(dist), backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#10b981'] }],
          },
        });
    }, 100);
  } catch (e) {
    showCustomAlert('Hata', e.message);
  }
}

async function previewExam(code) {
  const qres = await rpc('admin_get_questions', { p_token: token(), p_code: code });
  const eres = await rpc('admin_list_exams', { p_token: token() });
  const exam = (eres.exams || []).find((e) => e.code === code);
  if (!qres?.ok || !exam) return alert('Yüklenemedi');
  state.quizQuestions = (qres.questions || []).map((q) => ({
    question: q.question,
    options: q.options || [],
    image: q.image || '',
  }));
  state.currentExamConfig = {
    exam_code: code,
    teacher_name: exam.teacher_name,
    time_limit: exam.time_limit,
    exam_description: exam.description,
    is_active: exam.is_active,
  };
  previewExamAsAdmin(code, async () => {});
}

async function askExportFormat(code) {
  const res = await rpc('admin_get_questions', { p_token: token(), p_code: code });
  if (!res?.ok) return alert(res?.error);
  const questions = (res.questions || []).map((q) => ({
    question: q.question,
    options: q.options,
    answer: q.answer,
    image: q.image,
  }));
  const blob = new Blob([JSON.stringify(questions, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = code + '_sorular.json';
  a.click();
}

function importExamQuestions(code) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const questions = JSON.parse(text);
      if (!Array.isArray(questions)) throw new Error('Dizi olmalı');
      if (!confirm(questions.length + ' soru yüklensin mi?')) return;
      const res = await rpc('admin_set_questions', {
        p_token: token(),
        p_code: code,
        p_questions: questions,
      });
      if (!res?.ok) throw new Error(res?.error);
      alert('Yüklendi');
      loadMyExams();
    } catch (err) {
      alert(err.message);
    }
  };
  input.click();
}
