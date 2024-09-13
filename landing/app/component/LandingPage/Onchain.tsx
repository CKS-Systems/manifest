'use client';

import React from 'react';
import { Fade, Slide } from 'react-awesome-reveal';
import { FiArrowRight } from 'react-icons/fi';

const Onchain = () => {
  return (
    <div className='w-full overflow-x-hidden overflow-y-hidden py-10 sm:mt-0 xsm:-mt-[4rem] sm:py-24 2xl:mt-[8rem] lg:py-36 relative z-50'>
      <div className='w-full max-w-[1280px] 2xl:max-w-[1650px] 3xl:max-w-[2300px] m-auto md:px-8 px-4 relative'>
        <div className='w-full grid lg:gap-4 grid-cols-1 gap-10 lg:grid-cols-2 justify-center items-center'>
          <div className='w-full lg:order-1 order-2 flex justify-center items-center'>
          <div className='w-full justify-center items-center max-w-[550px] 3xl:max-w-[800px] flex flex-col gap-6'>
              <div className='flex sm:gap-0 gap-4  flex-col w-full items-center lg:items-start '>
                <Slide direction='up' triggerOnce duration={800} delay={200}>
                  <p className='text-[14px] sm:text-[18px] 2xl:text-[22px] 3xl:text-[32px] font-normal textColor'>
                  MISSION
                  </p>
                </Slide>
                <Slide direction='up' triggerOnce duration={800} delay={400}>
                  <h2 className='text-[20px] csm:text-[38px] 2xl:text-[55px] 3xl:text-[80px] mt-0 2xl:my-3 3xl:my-5 lg:text-left text-center font-terminaExtraDemi text-[#bca378] font-semibold leading-[30px] csm:leading-[58px] 2xl:leading-[70px] 3xl:leading-[105px]'>
                  Break Free from the Crypto Cartel
                  </h2>
                </Slide>
                <Fade triggerOnce duration={2000} delay={2000}>
                  <h2 className='text-[20px] csm:text-[38px] 2xl:text-[32px] 3xl:text-[50px] lg:text-left text-center font-terminaExtraDemi text-[#95C9BD] font-semibold leading-[30px] csm:leading-[58px]'>
                    ... the Way Out is On-Chain
                  </h2>
                </Fade>
              </div>
              <Slide direction='up' triggerOnce duration={800} delay={800}>
              <p className='text-[#bca378]/70 lg:text-left text-center text-[16px] sm:text-[18px] 2xl:text-[22px] 3xl:text-[26px] font-normal leading-[28px] 3xl:leading-[44px]'>
                  The forever free orderbook exchange that supercharges everyone&apos;s trading. A climactic liquidity primitive to push all risk-exchange on-chain.
                </p>
              </Slide>

              <Fade
                direction='up'
                triggerOnce
                duration={800}
                delay={1000}
                className='w-full'
              >
                <div className='w-full flex md:justify-start justify-center items-center gap-4 sm:gap-4 mt-0 2xl:mt-4'>
                  <div className='gradient-wrapper rounded-lg !p-[1px] 2xl:!p-[2px] 3xl:!p-[4px]'>
                    <a
                      href='https://x.com/ManifestTrade'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-block px-[20px] borderGradient cursor-pointer 2xl:px-[25px] 3xl:px-[38px] sm:px-[24px] hover:opacity-80 rounded-lg 2xl:py-[16px] 3xl:py-[24px] py-[10px] sm:py-[12px] bg-transparent text-[16px] 3xl:text-[40px] 2xl:text-[24px] sm:text-[18px] text-[#bca378]'
                    >
                      Manifest Together
                    </a>
                  </div>
                </div>
                <div className='flex items-center gap-2 group mt-4'>
                  <a
                    href='/whitepaper.pdf'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex items-center gap-2'
                  >
                    <p className='textColor 3xl:text-[32px] 2xl:text-[22px] text-[16px] font-normal'>
                      Read the Manifesto
                    </p>
                    <FiArrowRight className='text-[20px] 3xl:text-[36px] 2xl:text-[26px] text-[#bca378] group-hover:text-[#00ffe5]' />
                  </a>
                </div>
              </Fade>
            </div>
          </div>
          <Slide
            className='sm:w-auto w-full flex order-2 justify-center items-center xl:absolute mt-[6rem] xl:mt-0 xl:-top-[5rem] -right-20'
            direction='right'
            duration={1000}
            triggerOnce
            delay={400}
          >
            <div className='w-full max-w-[550px] 2xl:max-w-[700px] 3xl:max-w-[1000px] h-[320px] sm:h-[450px] xl:h-[600px] 2xl:h-[800px] 3xl:h-[1100px] relative'>
            <div className='w-full flex flex-col gap-2'>
                  <h2 className='text-[26px] sm:text-[32px] sm:mt-2 md:mt-14 text-center lg:text-left xl:text-[48px] 2xl:text-[58px] 3xl:text-[75px] mt-12 lg:mt-[4rem] xl:mt-[8rem] tracking-[3px] text-[#bca378] font-terminaExtraDemi'>
                    Orderbook <br />
                    <span className='textColor'> Domination</span>
                  </h2>
                  <p className='text-[#bca378]/70 lg:text-left text-center text-[16px] 2xl:text-[22px] 3xl:text-[32px] font-normal'>
                    Scrap the AMM and CEX-mess, unleash hyper-efficient on-chain orderbook trading. Manifest is the 3rd generation 
                    of Solana CLOB DEXs allowing users to trade the price they want for free. Using limit orders increases liquidity and allows more exact risk expression than an AMM.
                    Being fully on-chain allows funds to remain in users possession. Never trust another CEX again.
                  </p>
                  <a
                    href='https://github.com/CKS-Systems/manifest'
                    className='flex hover:opacity-80 hrGr group z-50 justify-center items-center gap-2 mt-8 lg:mt-14 xl:mt-8 pb-4'
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    <p className='textColor 3xl:text-[32px] 2xl:text-[22px] text-[16px] font-normal'>
                      View Open Source Code
                    </p>
                    <FiArrowRight className='text-[20px] 3xl:text-[36px] 2xl:text-[26px] text-[#bca378] group-hover:text-[#00ffe5]' />
                  </a>
                </div>
            </div>
          </Slide>
        </div>
      </div>
    </div>
  );
};

export default Onchain;
