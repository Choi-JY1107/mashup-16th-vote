import { createHmac, timingSafeEqual } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { BallotTokenIssuer, Clock, CodeHasher } from '../domain/ports.js'

/**
 * 통행코드 해시.
 *
 * Argon2/bcrypt 는 매번 다른 salt 를 쓰므로 해시로 행을 찾을 수 없다.
 * 코드는 "조회 가능해야 하는 비밀"이라 결정적 해시가 필요하다.
 * 그래서 서버만 아는 pepper 로 HMAC-SHA256 을 쓴다.
 * DB 가 유출돼도 pepper 없이는 6자 코드를 역산할 수 없다.
 */
@Injectable()
export class HmacCodeHasher implements CodeHasher {
  private readonly pepper: string

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.pepper = config.getOrThrow<string>('ACCESS_CODE_PEPPER')
  }

  async hash(plainCode: string): Promise<string> {
    return createHmac('sha256', this.pepper)
      .update(plainCode.trim().toUpperCase())
      .digest('hex')
  }
}

interface BallotClaims {
  pollId: string
  accessCodeId: string
}

/**
 * 투표 화면 진입 후 제출까지만 유효한 단기 토큰.
 * 코드를 매 요청마다 다시 보내지 않게 하려는 목적이므로 수명이 짧다.
 */
@Injectable()
export class JwtBallotTokenIssuer implements BallotTokenIssuer {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  async issue(payload: BallotClaims): Promise<string> {
    return this.jwt.signAsync(
      { pid: payload.pollId, acid: payload.accessCodeId },
      { expiresIn: '30m' },
    )
  }

  async verify(token: string): Promise<BallotClaims | null> {
    try {
      const claims = await this.jwt.verifyAsync<{ pid: string; acid: string }>(token)
      if (typeof claims.pid !== 'string' || typeof claims.acid !== 'string') return null
      return { pollId: claims.pid, accessCodeId: claims.acid }
    } catch {
      return null
    }
  }
}

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}

/** 길이 차이로 정답을 유추하지 못하게 상수 시간 비교를 쓴다. */
export const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
