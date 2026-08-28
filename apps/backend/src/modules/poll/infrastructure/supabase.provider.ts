import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ConfigService } from '@nestjs/config'

/**
 * service_role 키를 쓴다. RLS 를 우회하므로 이 클라이언트는 절대 프론트에 나가지 않는다.
 *
 * DATA_SOURCE=memory 일 때는 아예 호출되지 않으므로,
 * Supabase 환경변수 없이도 서버가 뜬다.
 */
export const createSupabaseClient = (config: ConfigService): SupabaseClient =>
  createClient(
    config.getOrThrow<string>('SUPABASE_URL'),
    config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
