import { redirect } from '@sveltejs/kit'
import type { PageLoad } from './$types'

/**
 * 딥링크 진입점. QR 과 카톡 DM 이 이 경로를 쓴다.
 * 코드를 쿼리로 옮겨서 입력 화면을 그대로 재사용한다.
 */
export const load: PageLoad = ({ params }) => {
  const code = params.code.toUpperCase().replace(/[^0-9A-Z]/g, '')
  redirect(302, `/?c=${code}`)
}
