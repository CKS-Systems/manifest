import Hero from './component/LandingPage/Hero';
import Onchain from './component/LandingPage/Onchain';
import Features from './component/LandingPage/Features';
import Security from './component/LandingPage/Security';
import Build from './component/LandingPage/Build';
import Partners from './component/LandingPage/Partners';
export default function Home() {
  return (
    <div className='w-full h-full relative bg-gradient-radial from-[#403822] to-[#000000]'>
      <Hero />
      <Onchain />
      <Features />
      <Security />
      <Partners />
      <Build />
    </div>
  );
}
