import { parseTeamName, plainTeamName } from '@vote/contract'
import { describe, expect, it } from 'vitest'

/**
 * 팀명의 `**...**` 는 그 구간을 굵게 렌더링하라는 표시다.
 * 별표가 프로젝터에 노출되면 안 되므로 짝이 안 맞는 경우까지 정의해둔다.
 */
describe('parseTeamName', () => {
  it('강조 구간만 잘라낸다', () => {
    expect(parseTeamName('너 정말 **핵심**을 찔렀어')).toEqual([
      { text: '너 정말 ', emphasis: false },
      { text: '핵심', emphasis: true },
      { text: '을 찔렀어', emphasis: false },
    ])
  })

  it('별표가 없으면 한 조각이다', () => {
    expect(parseTeamName('프로미스나인 (Promise.9)')).toEqual([
      { text: '프로미스나인 (Promise.9)', emphasis: false },
    ])
  })

  it('이모지·특수문자를 건드리지 않는다', () => {
    expect(parseTeamName('우두머리❤️')).toEqual([{ text: '우두머리❤️', emphasis: false }])
  })

  it('강조가 이름 맨 앞이나 맨 뒤여도 빈 조각을 만들지 않는다', () => {
    expect(parseTeamName('**앞**만 강조')).toEqual([
      { text: '앞', emphasis: true },
      { text: '만 강조', emphasis: false },
    ])
    expect(parseTeamName('뒤만 **강조**')).toEqual([
      { text: '뒤만 ', emphasis: false },
      { text: '강조', emphasis: true },
    ])
  })

  it('강조 구간이 여러 개여도 된다', () => {
    expect(parseTeamName('**가**와 **나**')).toEqual([
      { text: '가', emphasis: true },
      { text: '와 ', emphasis: false },
      { text: '나', emphasis: true },
    ])
  })

  it('별표 짝이 안 맞으면 강조하지 않는다 (화면이 깨지는 것이 최악)', () => {
    expect(parseTeamName('짝이 **안 맞음')).toEqual([
      { text: '짝이 ', emphasis: false },
      { text: '안 맞음', emphasis: false },
    ])
  })

  it('별표뿐이면 원문을 그대로 준다', () => {
    expect(parseTeamName('****')).toEqual([{ text: '****', emphasis: false }])
  })
})

describe('plainTeamName', () => {
  it('별표를 떼어낸다', () => {
    expect(plainTeamName('너 정말 **핵심**을 찔렀어')).toBe('너 정말 핵심을 찔렀어')
  })

  it('별표가 없으면 그대로다', () => {
    expect(plainTeamName('상정')).toBe('상정')
  })
})
