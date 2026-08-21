import Chart from 'chart.js/auto';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { rpc } from '../lib/supabase.js';
import { escapeHtml, sanitizeInput, showCustomAlert, getAdminToken } from '../lib/utils.js';
import { state } from '../state.js';
import { showDashboard } from '../admin/dashboard.js';

export async function showStudentDashboard(studentResult, opts = {}) {
  const password = opts.password || state.studentPassword;
  document.getElementById('connectionStatus').classList.add('hidden');
  document.getElementById('app').className = 'app-card max-w-6xl w-full';

  let backAction = 'location.reload()';
  let backText = 'Çıkış';
  let headerClass = 'bg-red-500 hover:bg-red-600';

  if (state.isAdminViewingResult) {
    backAction = 'window.returnToAdminPanel()';
    backText = '🔙 Yönetim Paneline Dön';
    headerClass = 'bg-gray-700 hover:bg-gray-800';
  }

  document.getElementById('loginHeader').innerHTML = `
    <div class="flex justify-between items-center px-4">
      <div>
        <h1 class="text-xl font-bold">${escapeHtml(studentResult.name)}</h1>
        <span class="text-xs opacity-80">${escapeHtml(studentResult.examCode)} Sonuç</span>
      </div>
      <button onclick="${backAction}" class="${headerClass} text-white text-xs px-3 py-2 rounded font-bold shadow">${backText}</button>
    </div>`;

  document.getElementById('mainContentArea').innerHTML = `
    <div class="text-center py-10">
      <div class="loader mb-4"></div>
      <p class="font-bold text-gray-600">Sonuçlar yükleniyor...</p>
    </div>`;

  try {
    let view;
    if (state.isAdminViewingResult && studentResult.id) {
      view = await rpc('admin_get_submission', {
        p_token: getAdminToken(),
        p_id: studentResult.id,
      });
    } else {
      const key = `${studentResult.examCode}_${studentResult.number}`;
      view = await rpc('get_student_result_view', {
        p_student_key: key,
        p_password: password,
      });
    }

    if (!view?.ok) throw new Error(view?.error || 'Sonuç alınamadı');

    const sub = view.submission || studentResult;
    const historyData = (view.history || []).map((h) => ({
      code: h.code,
      score: parseFloat(h.score),
    }));

    let htmlContent = '';

    if (view.restricted && !state.isAdminViewingResult) {
      htmlContent = `
        <div class="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-6 rounded">
          <p class="font-bold text-yellow-800 text-lg">⚠️ Sınav hâlâ açık</p>
          <p class="text-sm text-yellow-700">Sadece puan ve doğru/yanlış görünür. Detay sınav kapanınca açılır.</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div class="bg-indigo-600 text-white p-6 rounded-xl text-center">
            <span class="text-indigo-200 font-bold">PUANINIZ</span>
            <div class="text-6xl font-extrabold">${escapeHtml(sub.score)}</div>
          </div>
          <div class="bg-white p-6 rounded-xl border flex justify-around text-center">
            <div><div class="text-3xl font-bold text-green-600">${sub.correct}</div><div class="text-xs text-gray-400">DOĞRU</div></div>
            <div><div class="text-3xl font-bold text-red-600">${sub.incorrect}</div><div class="text-xs text-gray-400">YANLIŞ</div></div>
            <div><div class="text-3xl font-bold text-gray-600">${sub.empty}</div><div class="text-xs text-gray-400">BOŞ</div></div>
          </div>
        </div>
        <div class="bg-white p-4 rounded-xl border">
          <h3 class="font-bold mb-4">📈 Gelişim</h3>
          <div class="min-h-[250px]"><canvas id="studentProgressChart"></canvas></div>
        </div>
        <div class="flex justify-center mt-6">
          <button id="refreshStudentBtn" class="bg-indigo-600 text-white px-6 py-3 rounded-lg font-bold">🔄 Yenile</button>
        </div>`;
    } else {
      const allData = view.leaderboard || [];
      const questionsList = view.questions || [];
      const sorted = [...allData].sort(
        (a, b) => parseFloat(b.score) - parseFloat(a.score) || (a.timeSpent || 0) - (b.timeSpent || 0)
      );
      const myRank = sorted.findIndex((d) => d.number === sub.number) + 1;
      const totalStudents = sorted.length || 1;
      const avg =
        totalStudents > 0
          ? (sorted.reduce((a, c) => a + parseFloat(c.score), 0) / totalStudents).toFixed(2)
          : '0';

      const classStats = {};
      sorted.forEach((d) => {
        if (!classStats[d.className]) classStats[d.className] = { t: 0, n: 0 };
        classStats[d.className].t += parseFloat(d.score);
        classStats[d.className].n += 1;
      });
      const classAverages = Object.keys(classStats)
        .map((c) => ({
          className: c,
          avg: (classStats[c].t / classStats[c].n).toFixed(2),
          count: classStats[c].n,
        }))
        .sort((a, b) => parseFloat(b.avg) - parseFloat(a.avg));

      const top10 = sorted.slice(0, 10);
      const badges = calculateBadges(sub, myRank, totalStudents, historyData);

      let qHtml = '<p class="text-gray-400 italic">Soru verisi yok</p>';
      if (questionsList.length) {
        const answers = sub.allAnswers || [];
        qHtml = `<div class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="bg-gray-800 text-white">
            <th class="p-2">No</th><th class="p-2 text-left">Soru</th><th class="p-2">Cevabın</th><th class="p-2">Doğru</th><th class="p-2">Durum</th>
          </tr></thead><tbody>`;
        questionsList.forEach((q, idx) => {
          const studentAns = answers[idx] != null && answers[idx] !== '' ? answers[idx] : '-';
          const correctAns = q.answer;
          let row = 'bg-gray-50';
          let st = '⚪ BOŞ';
          if (studentAns !== '-') {
            if (String(studentAns).toLowerCase() === String(correctAns).toLowerCase()) {
              row = 'bg-green-50';
              st = '✅ DOĞRU';
            } else {
              row = 'bg-red-50';
              st = '❌ YANLIŞ';
            }
          }
          qHtml += `<tr class="${row}">
            <td class="p-2 font-bold">${idx + 1}</td>
            <td class="p-2 text-left">${sanitizeInput(q.question)}</td>
            <td class="p-2 text-center font-bold">${escapeHtml(studentAns)}</td>
            <td class="p-2 text-center font-bold text-green-700">${escapeHtml(correctAns)}</td>
            <td class="p-2 text-center text-xs">${st}</td>
          </tr>`;
        });
        qHtml += '</tbody></table></div>';
      }

      htmlContent = `
        <div class="bg-green-100 text-green-800 p-3 rounded text-center font-bold text-sm mb-4 border border-green-200">
          🎉 Detaylı sonuçlar
        </div>
        <div class="flex justify-center mb-4">
          <button id="pdfBtn" class="bg-red-500 text-white px-4 py-2 rounded-lg font-bold">📄 PDF</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="bg-indigo-50 p-4 rounded-xl border text-center">
            <div class="text-sm text-indigo-600 font-bold">PUAN</div>
            <div class="text-4xl font-extrabold text-indigo-800">${escapeHtml(sub.score)}</div>
          </div>
          <div class="bg-orange-50 p-4 rounded-xl border text-center">
            <div class="text-sm text-orange-600 font-bold">SIRA</div>
            <div class="text-4xl font-extrabold text-orange-800">${myRank}<span class="text-sm text-gray-500">/${totalStudents}</span></div>
          </div>
          <div class="bg-green-50 p-4 rounded-xl border text-center">
            <div class="text-sm text-green-600 font-bold">D / Y / B</div>
            <div class="font-bold">${sub.correct} / ${sub.incorrect} / ${sub.empty}</div>
          </div>
          <div class="bg-blue-50 p-4 rounded-xl border text-center">
            <div class="text-sm text-blue-600 font-bold">ORTALAMA</div>
            <div class="text-4xl font-extrabold text-blue-800">${avg}</div>
          </div>
        </div>
        <div class="bg-white p-4 rounded-xl border mb-6">
          <h3 class="font-bold mb-3">🏆 Rozetler (${badges.length})</h3>
          <div class="flex flex-wrap gap-2">
            ${
              badges.length
                ? badges
                    .map(
                      (b) =>
                        `<span class="${b.color} px-3 py-2 rounded-full text-sm" title="${escapeHtml(b.desc)}">${b.icon} ${escapeHtml(b.name)}</span>`
                    )
                    .join('')
                : '<span class="text-gray-400">Henüz rozet yok</span>'
            }
          </div>
        </div>
        <div class="bg-white p-5 rounded-xl border mb-6 border-t-4 border-t-purple-500">
          <h3 class="font-bold mb-4">📝 Soru Analizi</h3>
          ${qHtml}
        </div>
        <div class="bg-white p-4 rounded-xl border mb-6">
          <h3 class="font-bold mb-3">🏆 İlk 10</h3>
          <table class="w-full text-sm">
            <thead class="bg-indigo-50"><tr>
              <th class="p-2">#</th><th class="p-2 text-left">Ad</th><th class="p-2">Sınıf</th><th class="p-2">Puan</th>
            </tr></thead>
            <tbody>
              ${top10
                .map((st, i) => {
                  const me = st.number === sub.number;
                  return `<tr class="${me ? 'bg-yellow-50' : ''}">
                    <td class="p-2 text-center">${i + 1}</td>
                    <td class="p-2">${me ? '👉 ' : ''}${escapeHtml(st.name)}</td>
                    <td class="p-2 text-center text-xs">${escapeHtml(st.className)}</td>
                    <td class="p-2 text-right font-bold text-indigo-600">${escapeHtml(st.score)}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="bg-white p-4 rounded-xl border">
            <h3 class="font-bold mb-3">Sınıf Ortalamaları</h3>
            <table class="w-full text-sm">
              <thead class="bg-gray-100"><tr><th class="p-2 text-left">Sınıf</th><th class="p-2">N</th><th class="p-2 text-right">Ort</th></tr></thead>
              <tbody>
                ${classAverages
                  .map(
                    (c) => `<tr class="${c.className === sub.className ? 'bg-indigo-50' : ''}">
                    <td class="p-2 font-bold">${escapeHtml(c.className)}</td>
                    <td class="p-2 text-center">${c.count}</td>
                    <td class="p-2 text-right text-indigo-600 font-bold">${c.avg}</td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
          <div class="bg-white p-4 rounded-xl border">
            <h3 class="font-bold mb-4">📈 Gelişim</h3>
            <div class="min-h-[250px]"><canvas id="studentProgressChart"></canvas></div>
          </div>
        </div>`;
    }

    document.getElementById('mainContentArea').innerHTML = htmlContent;

    document.getElementById('refreshStudentBtn')?.addEventListener('click', async () => {
      await showStudentDashboard(sub, { password });
    });
    document.getElementById('pdfBtn')?.addEventListener('click', () => downloadPDF(sub));

    setTimeout(() => {
      const canvas = document.getElementById('studentProgressChart');
      if (!canvas) return;
      new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: historyData.map((h) => h.code),
          datasets: [
            {
              label: 'Puan',
              data: historyData.map((h) => h.score),
              borderColor: '#4f46e5',
              backgroundColor: 'rgba(79,70,229,0.1)',
              fill: true,
              tension: 0.3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 100 } },
        },
      });
    }, 200);
  } catch (e) {
    document.getElementById('mainContentArea').innerHTML = `
      <div class="text-center text-red-500 py-10">
        <p class="font-bold">Hata</p>
        <p class="text-sm">${escapeHtml(e.message)}</p>
        <button onclick="location.reload()" class="mt-4 bg-gray-200 px-4 py-2 rounded">Yenile</button>
      </div>`;
  }
}

function downloadPDF(sub) {
  try {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('SINAV SONUC BELGESI', 105, 20, { align: 'center' });
    autoTable(doc, {
      startY: 30,
      head: [['Alan', 'Deger']],
      body: [
        ['Ad Soyad', sub.name || ''],
        ['Sınıf', sub.className || ''],
        ['Numara', String(sub.number || '')],
        ['Sınav', sub.examCode || ''],
        ['Puan', String(sub.score ?? '')],
        ['D/Y/B', `${sub.correct}/${sub.incorrect}/${sub.empty}`],
      ],
      headStyles: { fillColor: [79, 70, 229] },
    });
    doc.save(`${sub.name || 'sonuc'}_Sonuc.pdf`);
  } catch (e) {
    alert('PDF: ' + e.message);
  }
}

function calculateBadges(studentResult, rank, totalStudents, historyData) {
  const badges = [];
  const score = parseFloat(studentResult.score || 0);
  const correct = parseInt(studentResult.correct || 0, 10);
  const incorrect = parseInt(studentResult.incorrect || 0, 10);

  if (score >= 90)
    badges.push({
      name: 'Sınav Şampiyonu',
      icon: '🏆',
      color: 'bg-yellow-100 text-yellow-800 border',
      desc: '90+',
    });
  else if (score >= 80)
    badges.push({
      name: 'Mükemmel',
      icon: '⭐',
      color: 'bg-purple-100 text-purple-800 border',
      desc: '80+',
    });
  else if (score >= 70)
    badges.push({
      name: 'Başarılı',
      icon: '👍',
      color: 'bg-blue-100 text-blue-800 border',
      desc: '70+',
    });

  if (rank > 0 && rank <= 3)
    badges.push({
      name: 'İlk 3',
      icon: '👑',
      color: 'bg-red-100 text-red-800 border',
      desc: 'İlk 3',
    });
  else if (rank > 0 && rank <= 10)
    badges.push({
      name: 'İlk 10',
      icon: '💎',
      color: 'bg-green-100 text-green-800 border',
      desc: 'İlk 10',
    });

  if (correct >= 18)
    badges.push({
      name: 'Doğru Ustası',
      icon: '✅',
      color: 'bg-emerald-100 text-emerald-800 border',
      desc: '18+ doğru',
    });
  if (incorrect <= 2)
    badges.push({
      name: 'İsabet',
      icon: '🎯',
      color: 'bg-indigo-100 text-indigo-800 border',
      desc: '≤2 yanlış',
    });

  if (Array.isArray(historyData) && historyData.length >= 2) {
    const last = parseFloat(historyData[historyData.length - 2].score || 0);
    if (score > last)
      badges.push({
        name: 'Gelişim',
        icon: '📈',
        color: 'bg-cyan-100 text-cyan-800 border',
        desc: 'Önceki sınavdan yüksek',
      });
  }
  if (Array.isArray(historyData) && historyData.length === 1)
    badges.push({
      name: 'İlk Sınav',
      icon: '🎪',
      color: 'bg-pink-100 text-pink-800 border',
      desc: 'İlk katılım',
    });

  return badges;
}

window.returnToAdminPanel = () => {
  state.isAdminViewingResult = false;
  document.getElementById('app').className = 'app-card teacher-mode';
  showDashboard();
  window.changeTab?.('results');
};

// silence unused
void showCustomAlert;
