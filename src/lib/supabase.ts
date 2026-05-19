import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

// WARNING: supabaseAdmin bypasses Row Level Security. Never import this in
// client-side code or any file prefixed with NEXT_PUBLIC. Server-side only.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
