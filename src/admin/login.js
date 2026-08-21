import { rpc } from '../lib/supabase.js';
import { showCustomAlert, setAdminToken } from '../lib/utils.js';
import { state } from '../state.js';
import { showLoginForm } from '../student/login.js';
import { showDashboard } from './dashboard.js';

// ══════════════════════════════════════════════════════════════════
// okuyOS OTOMATİK ÖĞRETMEN GİRİŞİ (YENİ)
// ------------------------------------------------------------------
// okuyOS'taki "🧪 Online Quiz" sayfasından öğretmen "Yönetici Girişi" butonuna
// basınca, bu siteye ?autoAdmin=1&expiry=...&sig=... parametreleriyle
// yönlendirilir. Parametreler yoksa (site kendi adresinden açılmışsa) bu
// fonksiyon sessizce false döner, main.js normal öğrenci giriş formunu
// gösterir — MEVCUT DAVRANIŞ DEĞİŞMEZ.
// ══════════════════════════════════════════════════════════════════
export async function tryTeacherAutoLoginFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('autoAdmin') !== '1') return false;

  const expiry = parseInt(params.get('expiry') || '0', 10);
  const sig = (params.get('sig') || '').trim();
  if (!expiry || !sig) return false;

  window.history.replaceState({}, document.title, window.location.pathname);

  document.getElementById('loginHeader').innerHTML =
    '<h1 class="text-2xl font-extrabold">okuyOS ile Yönetici Girişi</h1>';
  document.getElementById('mainContentArea').innerHTML = `
    <div class="text-center py-10">
      <div class="loader mb-4"></div>
      <p class="font-bold text-gray-600">okuyOS'tan otomatik giriş yapılıyor...</p>
    </div>`;

  try {
    const res = await rpc('admin_auto_login', { p_expiry: expiry, p_signature: sig });
    if (!res?.ok) {
      document.getElementById('mainContentArea').innerHTML = `
        <div class="text-center text-red-500 py-10">
          <p class="font-bold">Otomatik giriş başarısız</p>
          <p class="text-sm">${res?.error || 'Bilinmeyen hata'}</p>
          <button id="teacherAutoLoginFallbackBtn" class="mt-4 bg-indigo-600 text-white px-4 py-2 rounded font-bold">Manuel Girişe Dön</button>
        </div>`;
      document.getElementById('teacherAutoLoginFallbackBtn').onclick = showTeacherLogin;
      return true;
    }
    setAdminToken(res.token);
    state.isTeacherMode = true;
    if (res.preparer_name) state.systemPreparerName = res.preparer_name;
    showDashboard();
    return true;
  } catch (e) {
    document.getElementById('mainContentArea').innerHTML = `
      <div class="text-center text-red-500 py-10">
        <p class="font-bold">Bağlantı hatası</p>
        <p class="text-sm">${e.message}</p>
        <button id="teacherAutoLoginFallbackBtn2" class="mt-4 bg-indigo-600 text-white px-4 py-2 rounded font-bold">Manuel Girişe Dön</button>
      </div>`;
    document.getElementById('teacherAutoLoginFallbackBtn2').onclick = showTeacherLogin;
    return true;
  }
}

export function showTeacherLogin() {
  document.getElementById('mainContentArea').innerHTML = `
    <div class="space-y-4">
      <h3 class="text-center font-bold text-gray-800 text-lg">Yönetici Girişi</h3>
      <div class="text-center text-xs p-2 rounded ${
        state.isDbConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
      }">${state.isDbConnected ? 'Veritabanı Bağlantısı Aktif' : 'Veritabanı Bağlantısı YOK'}</div>
      <input id="pass" type="password" placeholder="Yönetici Şifresi" class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
      <button id="loginBtn" class="button bg-indigo-600 text-white w-full py-3 rounded-lg font-bold hover:bg-indigo-700">Giriş Yap</button>
      <button id="backBtn" class="button bg-gray-200 text-gray-700 w-full py-3 rounded-lg font-semibold hover:bg-gray-300">Geri Dön</button>
      <p class="text-[10px] text-gray-400 text-center">İlk kurulum şifresi genelde admin123 — hemen değiştirin.</p>
    </div>
  `;
  document.getElementById('backBtn').onclick = showLoginForm;
  document.getElementById('loginBtn').onclick = async () => {
    if (!state.isDbConnected) return showCustomAlert('Hata', 'Veritabanına bağlanılamadı.');
    const inputPass = document.getElementById('pass').value;
    try {
      const res = await rpc('admin_login', { p_password: inputPass });
      if (!res?.ok) return showCustomAlert('Hatalı Şifre', res?.error || 'Yanlış şifre');
      setAdminToken(res.token);
      state.isTeacherMode = true;
      if (res.preparer_name) state.systemPreparerName = res.preparer_name;
      showDashboard();
    } catch (e) {
      showCustomAlert('Hata', e.message);
    }
  };
}
