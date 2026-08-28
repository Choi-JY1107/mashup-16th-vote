import type { BallotForm } from '@vote/contract'

/**
 * 통행코드 검증 결과를 담는 클라이언트 세션.
 *
 * 일부러 메모리에만 둔다. localStorage 에 두면 남의 기기에 토큰이 남고,
 * 새로고침으로 되살아난 화면이 이미 제출된 표를 다시 보여줄 수 있다.
 * 새로고침하면 코드 입력부터 다시 하는 게 맞다.
 */
class BallotSession {
  form = $state<BallotForm | null>(null)
  submitted = $state(false)

  start(form: BallotForm): void {
    this.form = form
    this.submitted = false
  }

  complete(): void {
    this.submitted = true
    // 제출 직후 토큰을 버린다. 뒤로 가기로 재제출을 시도할 수 없다.
    this.form = null
  }

  clear(): void {
    this.form = null
    this.submitted = false
  }
}

export const ballotSession = new BallotSession()
