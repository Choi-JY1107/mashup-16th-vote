/**
 * 팀명 표시 규칙.
 *
 * 16기 팀명 중 하나가 `너 정말 **핵심**을 찔렀어` 처럼 강조 구간을 담고 있다.
 * 별표는 화면에 나오면 안 되고, 감싼 구간만 굵게 나와야 한다.
 *
 * 서버는 별표가 붙은 원문을 그대로 보관한다. `**` 규약이 candidateSchema.name 의 계약이므로
 * 파서도 계약 패키지에 둔다 — 규약과 해석이 갈라지면 별표가 프로젝터에 노출된다.
 */

export interface NameSegment {
  readonly text: string
  readonly emphasis: boolean
}

/**
 * `**...**` 를 기준으로 잘라서 강조 여부를 붙인다.
 *
 * 별표 짝이 안 맞으면 강조하지 않고 글자 그대로 둔다.
 * 시상식 화면에서 팀명이 깨지는 것이 최악이므로 관대하게 처리한다.
 */
export function parseTeamName(name: string): NameSegment[] {
  const parts = name.split('**')
  const segments: NameSegment[] = []

  // 조각 개수가 홀수일 때만 별표 짝이 맞는다. 그때 홀수 인덱스가 강조 구간이다.
  const balanced = parts.length % 2 === 1

  parts.forEach((text, i) => {
    if (text === '') return
    segments.push({ text, emphasis: balanced && i % 2 === 1 })
  })

  // 이름이 별표뿐이었다면 원문을 그대로 보여준다.
  return segments.length === 0 ? [{ text: name, emphasis: false }] : segments
}

/** 별표를 떼어낸 순수 텍스트. 서식을 쓸 수 없는 안내 문구·로그에서 쓴다. */
export const plainTeamName = (name: string): string =>
  parseTeamName(name)
    .map((s) => s.text)
    .join('')
