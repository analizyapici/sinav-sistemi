export function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#x27;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>')
    .substring(0, 2000);
}

export function sanitizeExamCode(code) {
  if (typeof code !== 'string') return '';
  return code.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase().substring(0, 20);
}

export function validateStudentData(student) {
  if (!student || typeof student !== 'object') return false;
  return Boolean(student.name && student.number && student.className);
}

/** Deterministik karıştırma (öğrenci numarasına göre) */
export function seededShuffle(array, seed) {
  let hash = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) hash = (((hash << 5) - hash) + s.charCodeAt(i)) | 0;
  const shuffled = [...array];
  let n = shuffled.length;
  while (n > 1) {
    hash = (hash * 9301 + 49297) % 233280;
    const random = (hash < 0 ? hash + 233280 : hash) / 233280.0;
    const k = Math.floor(random * n--);
    [shuffled[n], shuffled[k]] = [shuffled[k], shuffled[n]];
  }
  return shuffled;
}

export function showCustomAlert(title, msg) {
  return new Promise((resolve) => {
    const modal = document.getElementById('customModal');
    const content = document.getElementById('modalContent');
    content.innerHTML =
      (title ? `<h3 class="text-xl font-bold text-gray-800 mb-2">${title}</h3>` : '') +
      `<div class="text-left w-full">${msg}</div>` +
      (title !== 'Veriler Analiz Ediliyor...'
        ? '<button id="modalCloseBtn" class="mt-4 bg-indigo-600 text-white px-6 py-2 rounded font-bold hover:bg-indigo-700">Tamam</button>'
        : '');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    const btn = document.getElementById('modalCloseBtn');
    if (btn) {
      btn.onclick = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        resolve();
      };
    }
  });
}

export function hideModal() {
  const modal = document.getElementById('customModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatTime(totalSec) {
  const m = Math.floor(Math.max(0, totalSec) / 60);
  const s = Math.max(0, totalSec) % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const ADMIN_TOKEN_KEY = 'sinav_admin_token';

export function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token) {
  if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

export function backupKey(examCode, number) {
  return `exam_backup_${examCode}_${number}`;
}
