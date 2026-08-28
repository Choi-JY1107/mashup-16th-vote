import {
  CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'
import { safeEqual } from '../infrastructure/code.adapters.js'

/**
 * 관리자 엔드포인트 보호. 사회자가 쓰는 "다음 순위 공개"가 여기에 걸린다.
 * 시상식 도중 아무나 순위를 넘겨버리면 되돌릴 방법이 없다.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly apiKey: string

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('ADMIN_API_KEY')
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    const provided = req.header('x-admin-key')
    if (typeof provided !== 'string' || !safeEqual(provided, this.apiKey)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: '권한이 없습니다.' })
    }
    return true
  }
}
