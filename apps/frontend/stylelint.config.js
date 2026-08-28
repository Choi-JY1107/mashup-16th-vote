/**
 * CSS 만 검사한다. SCSS 도, .svelte 안의 <style> 블록도 없다 —
 * 스타일은 전부 src/styles/*.css 에 있다.
 *
 * @type {import('stylelint').Config}
 */
export default {
  extends: 'stylelint-config-standard',
  rules: {
    // BEM 강제: block, block__element, block--modifier, block__element--modifier
    'selector-class-pattern': [
      '^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z][a-z0-9]*(-[a-z0-9]+)*)?(--[a-z][a-z0-9]*(-[a-z0-9]+)*)?$',
      { message: 'BEM 규약을 따르세요: block__element--modifier' },
    ],

    // --mu-blue-rgb 처럼 접미사를 붙여 쓰므로 기본 패턴을 쓰지 않는다
    'custom-property-pattern': null,

    // tokens.css 는 빈 줄로 색 / 반경 / 간격을 묶어 읽는다
    'custom-property-empty-line-before': null,

    // BEM 이라 선택자가 평평하다. 상태 modifier 가 뒤에 오는 것이 정상이다.
    'no-descending-specificity': null,

    // (width <= 640px) 범위 문법은 구형 iOS Safari 에서 무시된다.
    // 투표는 각자 휴대폰으로 하므로 max-width 를 유지한다.
    'media-feature-range-notation': null,
  },
}
