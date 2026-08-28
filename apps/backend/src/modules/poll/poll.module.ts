import { Module, type Provider } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CastBallotUseCase } from './application/cast-ballot.usecase.js'
import { ClosePollUseCase } from './application/close-poll.usecase.js'
import { AdvanceRevealUseCase, GetRevealStateUseCase } from './application/reveal.usecase.js'
import { VerifyAccessCodeUseCase } from './application/verify-access-code.usecase.js'
import {
  ACCESS_CODE_REPOSITORY,
  BALLOT_REPOSITORY,
  BALLOT_TOKEN_ISSUER,
  CLOCK,
  CODE_HASHER,
  POLL_REPOSITORY,
  POLL_RESULT_REPOSITORY,
  REVEAL_PORT,
  type AccessCodeRepository,
  type BallotRepository,
  type PollRepository,
  type PollResultRepository,
  type RevealPort,
} from './domain/ports.js'
import {
  HmacCodeHasher,
  JwtBallotTokenIssuer,
  SystemClock,
} from './infrastructure/code.adapters.js'
import { DemoSeeder } from './infrastructure/in-memory/demo-seeder.js'
import {
  InMemoryAccessCodeRepository,
  InMemoryBallotRepository,
  InMemoryPollRepository,
  InMemoryPollResultRepository,
  InMemoryRevealAdapter,
} from './infrastructure/in-memory/in-memory.repositories.js'
import { InMemoryStore } from './infrastructure/in-memory/store.js'
import { SupabaseAccessCodeRepository } from './infrastructure/supabase-access-code.repository.js'
import { SupabaseBallotRepository } from './infrastructure/supabase-ballot.repository.js'
import { SupabasePollRepository } from './infrastructure/supabase-poll.repository.js'
import { SupabasePollResultRepository } from './infrastructure/supabase-poll-result.repository.js'
import { SupabaseRevealAdapter } from './infrastructure/supabase-reveal.adapter.js'
import { createSupabaseClient } from './infrastructure/supabase.provider.js'
import { AdminController } from './presentation/admin.controller.js'
import { AdminGuard } from './presentation/admin.guard.js'
import { BallotController } from './presentation/ballot.controller.js'
import { RevealController } from './presentation/reveal.controller.js'

/**
 * 포트를 구현에 바인딩하는 유일한 지점.
 *
 * DATA_SOURCE=memory 면 Supabase 없이 전체 플로우가 돌아간다.
 * 도메인과 유즈케이스는 한 줄도 바뀌지 않는다 — 여기만 갈아끼운다.
 *
 * 선택은 반드시 런타임(useFactory)에서 한다. 모듈 로드 시점에 process.env 를 읽으면
 * ConfigModule 이 .env 를 읽기 전이라 항상 Supabase 로 떨어진다.
 */
const isMemory = (config: ConfigService): boolean =>
  config.get<string>('DATA_SOURCE') === 'memory'

/** Supabase 클라이언트는 실제로 필요할 때 한 번만 만든다. */
const supabaseOnce = (() => {
  let client: SupabaseClient | null = null
  return (config: ConfigService): SupabaseClient => {
    client ??= createSupabaseClient(config)
    return client
  }
})()

/** 포트 하나를 인메모리 / Supabase 구현 중 하나로 바인딩한다. */
const bindPort = <T>(
  token: symbol,
  memory: (store: InMemoryStore) => T,
  supabase: (client: SupabaseClient) => T,
): Provider => ({
  provide: token,
  inject: [ConfigService, InMemoryStore],
  useFactory: (config: ConfigService, store: InMemoryStore): T =>
    isMemory(config) ? memory(store) : supabase(supabaseOnce(config)),
})

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('BALLOT_JWT_SECRET'),
      }),
    }),
  ],
  controllers: [BallotController, RevealController, AdminController],
  providers: [
    AdminGuard,
    InMemoryStore,
    DemoSeeder,

    VerifyAccessCodeUseCase,
    CastBallotUseCase,
    ClosePollUseCase,
    AdvanceRevealUseCase,
    GetRevealStateUseCase,

    { provide: CODE_HASHER, useClass: HmacCodeHasher },
    { provide: BALLOT_TOKEN_ISSUER, useClass: JwtBallotTokenIssuer },
    { provide: CLOCK, useClass: SystemClock },

    bindPort<PollRepository>(
      POLL_REPOSITORY,
      (store) => new InMemoryPollRepository(store),
      (client) => new SupabasePollRepository(client),
    ),
    bindPort<AccessCodeRepository>(
      ACCESS_CODE_REPOSITORY,
      (store) => new InMemoryAccessCodeRepository(store),
      (client) => new SupabaseAccessCodeRepository(client),
    ),
    bindPort<BallotRepository>(
      BALLOT_REPOSITORY,
      (store) => new InMemoryBallotRepository(store),
      (client) => new SupabaseBallotRepository(client),
    ),
    bindPort<PollResultRepository>(
      POLL_RESULT_REPOSITORY,
      (store) => new InMemoryPollResultRepository(store),
      (client) => new SupabasePollResultRepository(client),
    ),
    bindPort<RevealPort>(
      REVEAL_PORT,
      (store) => new InMemoryRevealAdapter(store),
      (client) => new SupabaseRevealAdapter(client),
    ),
  ],
})
export class PollModule {}
