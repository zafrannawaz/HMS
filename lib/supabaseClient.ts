import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ajpuknzmtuloiyidggge.supabase.co';
const supabaseAnonKey = 'sb_publishable_pDw6Fzv7Ofx5z5G9cLBuwA_9Sig0a40';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);