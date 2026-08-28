export class Criterion {
  private constructor(
    readonly id: string,
    readonly key: string,
    readonly name: string,
    readonly description: string,
    readonly weight: number,
    readonly displayOrder: number,
  ) {}

  static rehydrate(props: {
    id: string
    key: string
    name: string
    description: string
    weight: number
    displayOrder: number
  }): Criterion {
    return new Criterion(
      props.id,
      props.key,
      props.name,
      props.description,
      props.weight,
      props.displayOrder,
    )
  }
}
