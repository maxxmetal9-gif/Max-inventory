import { createClient } from '@supabase/supabase-js'

const supabaseUrl = "https://tybioqoldfdabbprtcze.supabase.co"
const supabaseAnonKey = "sb_publishable_R2Ropi_sQMSb8IQ490dIBA_XvLi4qsH"

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
