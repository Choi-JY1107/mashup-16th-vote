import adapter from '@sveltejs/adapter-vercel'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
export default {
  // <script lang="ts"> 를 처리한다. 스타일은 src/styles/*.css 에 있으므로
  // CSS 전처리기는 필요 없다.
  preprocess: vitePreprocess(),
  kit: {
    // 서울에서 접속하므로 인천 리전에 붙인다.
    adapter: adapter({ runtime: 'nodejs22.x', regions: ['icn1'] }),
  },
}
