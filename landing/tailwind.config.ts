import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      fontFamily: {
        terminaThin: ['TerminaTest-Thin', 'sans-serif'],
        terminaRegular: ['TerminaTest-Regular', 'sans-serif'],
        terminaMedium: ['TerminaTest-Medium', 'sans-serif'],
        terminaLight: ['TerminaTest-Light', 'sans-serif'],
        terminaheavy: ['TerminaTest-heavy', 'sans-serif'],
        terminaExtraLight: ['TerminaTest-ExtraLight', 'sans-serif'],
        terminaExtraDemi: ['TerminaTest-Demi', 'sans-serif'],
        terminaExtraBold: ['TerminaTest-Bold', 'sans-serif'],
        terminaExtraBlack: ['TerminaTest-Black', 'sans-serif'],
      },
      screens: {
        xs: '325px',
        xsm: '390px',
        sm: '480px',
        csm: '599px',
        md: '768px',
        cmd: '914px',
        lg: '976px',
        clg: '1182px',
        xl: '1280px',
        '2xl': '2000px',
        '3xl': '2900px',
      },
      colors: {
        black: {
          1: '#000000',
          2: '##090B0B',
          3: '#121616',
        },
        purple: {
          1: '#6C5DD3',
        },
        white: {
          1: '#FFF',
          2: '#DDD',
          3: '#D9D9D9',
          4: '#848895',
        },
        green: {
          1: '#50C878',
        },
      },
    },
  },
  plugins: [],
};
export default config;
