import { Controller, Get, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core'
import { PollModule } from './modules/poll/poll.module.js'

@Controller()
class HealthController {
  /** Cloud Run 의 기동 확인용. 콜드스타트 프리워밍에도 이 경로를 쓴다. */
  @Get('health')
  health(): { ok: true; at: string } {
    return { ok: true, at: new Date().toISOString() }
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // 통행코드가 6자라 무차별 대입이 실제 위협이다. 전역 기본값을 깔고
    // 코드 검증 엔드포인트에서 더 좁게 조인다.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    PollModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
