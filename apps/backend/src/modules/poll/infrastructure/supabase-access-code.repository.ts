import type { SupabaseClient } from '@supabase/supabase-js'
import { AccessCode } from '../domain/access-code.js'
import type { AccessCodeRepository } from '../domain/ports.js'

interface AccessCodeRow {
  id: string
  poll_id: string
  team_id: string | null
  label: string
  used_at: string | null
}

const SELECT = 'id, poll_id, team_id, label, used_at'

const toDomain = (r: AccessCodeRow): AccessCode =>
  AccessCode.rehydrate({
    id: r.id,
    pollId: r.poll_id,
    teamId: r.team_id,
    label: r.label,
    usedAt: r.used_at === null ? null : new Date(r.used_at),
  })

export class SupabaseAccessCodeRepository implements AccessCodeRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findByHash(codeHash: string): Promise<AccessCode | null> {
    const { data, error } = await this.db
      .from('access_codes')
      .select(SELECT)
      .eq('code_hash', codeHash)
      .maybeSingle<AccessCodeRow>()

    if (error) throw error
    return data === null ? null : toDomain(data)
  }

  async findById(accessCodeId: string): Promise<AccessCode | null> {
    const { data, error } = await this.db
      .from('access_codes')
      .select(SELECT)
      .eq('id', accessCodeId)
      .maybeSingle<AccessCodeRow>()

    if (error) throw error
    return data === null ? null : toDomain(data)
  }
}
