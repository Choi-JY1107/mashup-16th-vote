import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })

  app.setGlobalPrefix('api')
  // 전역 ValidationPipe 는 쓰지 않는다. 검증은 contract 의 zod 스키마를
  // ZodValidationPipe 로 라우트별로 적용한다 (class-validator 의존 없음).

  const origins = (process.env['CORS_ORIGIN'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')

  app.enableCors({
    origin: origins.length > 0 ? origins : true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['content-type', 'authorization', 'x-admin-key'],
  })

  // Cloud Run 은 PORT 를 주입한다.
  const port = Number(process.env['PORT'] ?? 8080)
  await app.listen(port, '0.0.0.0')
  new Logger('bootstrap').log(`listening on :${port}`)
}

void bootstrap()
