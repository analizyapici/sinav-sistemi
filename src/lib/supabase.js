import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anon && !url.includes('YOUR_PROJECT'));

export const supabase = isConfigured
  ? createClient(url, anon, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;

/** RPC çağrısı — hata mesajını sadeleştirir */
export async function rpc(fn, args = {}) {
  if (!supabase) {
    throw new Error('Supabase yapılandırılmadı. .env dosyasını doldurun.');
  }
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message || 'Sunucu hatası');
  return data;
}
