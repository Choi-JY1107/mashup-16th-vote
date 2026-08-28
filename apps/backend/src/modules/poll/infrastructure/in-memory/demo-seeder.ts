import { readFileSync } from 'node:fs'
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Platform } from '@vote/contract'
import { AccessCode } from '../../domain/access-code.js'
import { Ballot } from '../../domain/ballot.js'
import { Candidate } from '../../domain/candidate.js'
import { Criterion } from '../../domain/criterion.js'
import { Poll } from '../../domain/poll.js'
import { CODE_HASHER, type CodeHasher } from '../../domain/ports.js'
import { InMemoryStore } from './store.js'

/** 로컬 데모용 고정 uuid. 프론트 PUBLIC_POLL_ID 와 같아야 한다. */
export const DEMO_POLL_ID = 'mu16'

interface SeedFile {
  poll: { title: string; pointsPerCriterion: number; excludeOwnTeam: boolean }
  criteria: {
    key: string
    name: string
    description: string
    weight: number
    displayOrder: number
  }[]
  candidates: {
    slug: string
    name: string
    description: string
    platform?: Platform | null
    displayOrder: number
  }[]
}

/**
 * contract 스키마가 criterionId / candidateId 를 uuid 로 검증한다.
 * 데모라도 형식을 지켜야 프론트가 파싱할 수 있으므로 결정적 uuid 를 만든다.
 */
const demoUuid = (group: number, index: number): string =>
  `${String(group).repeat(8)}-${String(group).repeat(4)}-4${String(group).repeat(3)}-8${String(group).repeat(3)}-${String(index).padStart(12, '0')}`

/** 데모 결과가 매 실행마다 같아야 하므로 고정 시드 LCG 를 쓴다. */
const makeRandom = (seed: number) => {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

/**
 * 사람이 손으로 입력할 수 있는 데모 코드.
 * 알파벳에서 I, L, O, U 는 제외되어 있으므로 그 글자를 쓰지 않는다.
 */
const DEMO_CODES = [
  { code: 'MU16TEAM01', teamIndex: 0 },
  { code: 'MU16TEAM02', teamIndex: 1 },
  { code: 'MU16TEAM03', teamIndex: 2 },
  { code: 'MU16TEAM04', teamIndex: 3 },
  { code: 'MU16TEAM05', teamIndex: 4 },
  { code: 'MU16TEAM06', teamIndex: 5 },
  { code: 'MU16CHAIR1', teamIndex: null },
] as const

@Injectable()
export class DemoSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger('DemoSeeder')

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(InMemoryStore) private readonly store: InMemoryStore,
    @Inject(CODE_HASHER) private readonly hasher: CodeHasher,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Supabase 모드에서는 아무것도 하지 않는다. 실데이터를 덮어쓰면 안 된다.
    if (this.config.get<string>('DATA_SOURCE') !== 'memory') return

    // 시드 JSON 은 레포에 없다 (명단이 DB 로 옮겨간 뒤 supabase/ 폴더를 지웠다).
    // 데모 모드를 쓰려면 경로를 직접 넘겨야 한다. 그냥 ENOENT 로 죽으면 원인을 찾기 어렵다.
    const seedPath = process.env['DEMO_SEED_PATH']
    if (seedPath === undefined) {
      throw new Error(
        'DATA_SOURCE=memory 인데 DEMO_SEED_PATH 가 없다. ' +
          '시드 JSON(poll/criteria/candidates) 경로를 지정하거나 DATA_SOURCE=supabase 로 돌릴 것.',
      )
    }
    const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile

    const poll = Poll.rehydrate({
      id: DEMO_POLL_ID,
      title: seed.poll.title,
      status: 'OPEN',
      rules: {
        pointsPerCriterion: seed.poll.pointsPerCriterion,
        excludeOwnTeam: seed.poll.excludeOwnTeam,
      },
    })
    this.store.polls.set(poll.id, poll)

    const criteria = seed.criteria.map((c, i) =>
      Criterion.rehydrate({
        id: demoUuid(2, i + 1),
        key: c.key,
        name: c.name,
        description: c.description,
        weight: c.weight,
        displayOrder: c.displayOrder,
      }),
    )
    this.store.criteria.set(poll.id, criteria)

    const candidates = seed.candidates.map((t, i) =>
      Candidate.rehydrate({
        id: demoUuid(3, i + 1),
        slug: t.slug,
        name: t.name,
        description: t.description,
        thumbnailUrl: null,
        platform: t.platform ?? null,
        displayOrder: t.displayOrder,
      }),
    )
    this.store.candidates.set(poll.id, candidates)

    // 손으로 투표해볼 코드
    for (const { code, teamIndex } of DEMO_CODES) {
      await this.addCode(poll.id, code, teamIndex === null ? null : candidates[teamIndex]!.id)
    }

    // 순위가 나오게 미리 넣어두는 표. 도메인을 그대로 통과시켜서 만든다.
    await this.seedBallots(poll, criteria, candidates)

    this.logger.log('─'.repeat(58))
    this.logger.log(`데모 모드 · POLL_ID = ${poll.id}`)
    this.logger.log(`사전 투표 ${this.store.ballots.length}표 주입됨`)
    this.logger.log('사용 가능한 통행코드:')
    for (const { code, teamIndex } of DEMO_CODES) {
      const label = teamIndex === null ? '회장단 (6팀 전부 평가)' : `${candidates[teamIndex]!.name} 소속 (자기 팀 제외 → 5팀)`
      this.logger.log(`  ${code.slice(0, 4)}-${code.slice(4)}   ${label}`)
    }
    this.logger.log('─'.repeat(58))
  }

  private async addCode(
    pollId: string,
    plainCode: string,
    teamId: string | null,
  ): Promise<AccessCode> {
    const id = this.store.newId()
    const accessCode = AccessCode.rehydrate({
      id,
      pollId,
      teamId,
      label: plainCode,
      usedAt: null,
    })
    this.store.accessCodesById.set(id, accessCode)
    this.store.accessCodesByHash.set(await this.hasher.hash(plainCode), accessCode)
    return accessCode
  }

  /**
   * 팀별로 서로 다른 인원수를 준다 (6/5/5/4/4/4).
   * 이래야 MEAN_PER_VOTER 정규화가 실제로 동작하는지 화면에서 확인할 수 있다.
   */
  private async seedBallots(
    poll: Poll,
    criteria: readonly Criterion[],
    candidates: readonly Candidate[],
  ): Promise<void> {
    const memberCounts = [6, 5, 5, 4, 4, 4]
    const random = makeRandom(20260828)

    // 팀별 실력 편차를 고정해서 순위가 뚜렷하게 갈리도록 한다.
    const strength = [0.95, 0.8, 0.72, 0.6, 0.45, 0.3]

    for (const [teamIndex, count] of memberCounts.entries()) {
      for (let member = 0; member < count; member += 1) {
        const voter = await this.addCode(
          poll.id,
          `SEED-${teamIndex}-${member}`,
          candidates[teamIndex]!.id,
        )
        const targets = voter.evaluableCandidates(candidates, poll.rules.excludeOwnTeam)

        const allocations = criteria.map((criterion) => {
          const weights = targets.map(
            (t) =>
              (strength[candidates.findIndex((c) => c.id === t.id)] ?? 0.5) *
              (0.7 + random() * 0.6),
          )
          const sum = weights.reduce((a, b) => a + b, 0)

          // 합계가 상한을 넘지 않게 내림하고 남는 점수는 버린다.
          const scores = targets.map((t, i) => ({
            candidateId: t.id,
            points: Math.floor((weights[i]! / sum) * poll.rules.pointsPerCriterion),
          }))
          return { criterionId: criterion.id, scores }
        })

        const ballot = Ballot.create({
          poll,
          accessCode: voter,
          criteria,
          candidates,
          allocations,
          now: new Date(),
        })

        if (!ballot.ok) {
          this.logger.error(`시드 표 생성 실패: ${ballot.error.code}`)
          continue
        }

        voter.markUsed(ballot.value.submittedAt)
        this.store.ballots.push({
          id: this.store.newId(),
          pollId: poll.id,
          accessCodeId: voter.id,
          scores: ballot.value.scores,
        })
      }
    }
  }
}
