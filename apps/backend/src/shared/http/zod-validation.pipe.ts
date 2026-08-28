import { BadRequestException, type PipeTransform } from '@nestjs/common'
import type { ZodType } from 'zod'

/**
 * contract 패키지의 zod 스키마를 그대로 검증에 쓴다.
 * FE/BE 가 같은 스키마를 보므로 DTO 클래스를 따로 두지 않는다.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value)
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_POINTS',
        message: '요청 형식이 올바르지 않습니다.',
        details: parsed.error.flatten(),
      })
    }
    return parsed.data
  }
}
