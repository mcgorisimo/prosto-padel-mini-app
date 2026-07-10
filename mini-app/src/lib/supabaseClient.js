import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (import.meta.env.DEV && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn(
    'Supabase env is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your local env.'
  );
}

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env configuration.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
