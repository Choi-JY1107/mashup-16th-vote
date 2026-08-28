import type { Platform } from '@vote/contract'

export class Candidate {
  private constructor(
    readonly id: string,
    readonly slug: string,
    /** **...** 로 감싼 구간은 화면에서 굵게 렌더링한다. 도메인은 문자열을 그대로 보관한다. */
    readonly name: string,
    readonly description: string,
    readonly thumbnailUrl: string | null,
    /** 앱 / 웹. 시상식 표에서 색으로만 구분한다. */
    readonly platform: Platform | null,
    readonly displayOrder: number,
  ) {}

  static rehydrate(props: {
    id: string
    slug: string
    name: string
    description: string
    thumbnailUrl: string | null
    platform?: Platform | null
    displayOrder: number
  }): Candidate {
    return new Candidate(
      props.id,
      props.slug,
      props.name,
      props.description,
      props.thumbnailUrl,
      props.platform ?? null,
      props.displayOrder,
    )
  }
}
