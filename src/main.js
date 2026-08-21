import { rpc, isConfigured } from './lib/supabase.js';
import { state } from './state.js';
import { showLoginForm, tryAutoLoginFromUrl } from './student/login.js';
import { tryTeacherAutoLoginFromUrl } from './admin/login.js';


async function boot() {
  const statusDiv = document.getElementById('connectionStatus');
  const loading = document.getElementById('loadingIndicator');

  if (!isConfigured) {
    loading?.classList.add('hidden');
    statusDiv.classList.remove('hidden');
    statusDiv.innerHTML = `
      <div class="text-left space-y-2">
        <p class="font-bold text-amber-800">⚙️ Supabase henüz bağlanmadı</p>
        <p class="font-normal text-[11px] leading-relaxed text-amber-900">
          1. supabase.com → ücretsiz proje oluşturun (Frankfurt önerilir)<br/>
          2. SQL Editor'da <code class="bg-white px-1">supabase/migrations/001_init.sql</code> çalıştırın<br/>
          3. <code class="bg-white px-1">.env.example</code> → <code class="bg-white px-1">.env</code> kopyalayıp URL + anon key yazın<br/>
          4. <code class="bg-white px-1">npm run dev</code> yeniden başlatın<br/>
          İlk admin şifresi: <b>admin123</b> (hemen değiştirin)
        </p>
      </div>`;
    statusDiv.className =
      'mb-4 text-xs font-bold text-center p-3 rounded border bg-amber-50 text-amber-900 border-amber-300';
    state.isDbConnected = false;
    showLoginForm();
    // Demo UI yine açılsın
    return;
  }

  try {
    const ping = await rpc('public_ping');
    if (ping?.ok) {
      state.isDbConnected = true;
      state.systemPreparerName = ping.preparer_name || state.systemPreparerName;
      statusDiv.innerHTML = '🟢 Sistem Çevrimiçi (Supabase)';
      statusDiv.className =
        'mb-4 text-xs font-bold text-center p-2 rounded border bg-green-100 text-green-800 border-green-300';
    } else {
      throw new Error('Ping başarısız');
    }
  } catch (e) {
    state.isDbConnected = false;
    statusDiv.innerHTML = `🔴 BAĞLANTI HATASI<br/><span class="text-[10px] font-normal">${e.message}<br/>SQL migration çalıştırıldı mı?</span>`;
    statusDiv.className =
      'mb-4 text-xs font-bold text-center p-2 rounded border bg-red-100 text-red-800 border-red-300';
  }

  statusDiv.classList.remove('hidden');
  loading?.classList.add('hidden');

  // okuyOS'tan otomatik giriş denemesi (öğretmen ya da öğrenci parametreleriyle
  // gelinmiş olabilir). Hiçbiri yoksa (site kendi adresinden normal açılmışsa)
  // ikisi de sessizce false döner ve normal öğrenci giriş formu gösterilir —
  // MEVCUT DAVRANIŞ HİÇ DEĞİŞMEZ.
  const teacherHandled = await tryTeacherAutoLoginFromUrl();
  if (teacherHandled) return;
  const studentHandled = await tryAutoLoginFromUrl();
  if (studentHandled) return;

  showLoginForm();
}

boot();
