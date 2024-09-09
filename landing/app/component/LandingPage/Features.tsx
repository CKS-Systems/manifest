'use client';

import React from 'react';
import Wrapper from '../shared/ComponentWrapper/Wrapper';
import Image from 'next/image';
import { Fade, Slide } from 'react-awesome-reveal';
import { FiArrowRight } from 'react-icons/fi';

const Features = () => {
  return (
    <div className='w-full overflow-x-hidden pt-10 pb-24 2xl:mt-[4rem] 2xl:mb-[4rem] mt-8 sm:mt-0 mb-0 relative'>
      <Wrapper>
        <div className='w-full flex flex-col gap-4 z-50'>
          <Fade duration={800} className='w-full' triggerOnce>
            <p className='text-[18px] 2xl:text-[22px] 3xl:text-[32px] block lg:text-left text-center font-normal textColor'>
              FEATURES
            </p>
          </Fade>
          <div className='w-full grid 2xl:mt-[3rem] grid-cols-1 lg:grid-cols-[1.3fr,2fr] min-h-[670px] gap-6 2xl:gap-8 3xl:gap-12 lg:mt-0 mt-16'>
            <Slide
              direction='left'
              duration={1000}
              className='w-full justify-center flex items-center overflow-hidden'
              triggerOnce
            >
              <div className='w-full max-w-[550px] 2xl:w-[680px] 3xl:w-[850px] lg:max-w-full h-full relative wrapper1'>
                <div className='px-0 w-full sm:px-6 py-0 sm:py-6 flex flex-col borderGradientC1 justify-between lg:items-start items-center h-full'>
                  <div className='w-full flex flex-col gap-2'>
                    <h2 className='text-[26px] sm:text-[32px] sm:mt-2 md:mt-14 text-center lg:text-left xl:text-[48px] 2xl:text-[58px] 3xl:text-[75px] mt-12 lg:mt-[4rem] xl:mt-[8rem] tracking-[3px] textColor2 font-terminaExtraDemi'>
                      Zero
                      <span className='textColor'> Fees</span>
                    </h2>
                    <p className='text-[#bca378]/70 lg:text-left text-center text-[16px] 2xl:text-[22px] 3xl:text-[32px] font-normal'>
                    No trading fees, forever. No gimmicks. Zero maker & taker fees marks the beginning of the end for value 
                    extracting crypto exchanges. Take a seat and manifest your free future.
                  </p>
                </div>
                <div className='w-full flex justify-center lg:justify-end lg:absolute lg:right-0 lg:bottom-0 lg:ml-0 md:ml-0 sm:ml-0 -ml-[4rem] xsm:-ml-[2rem] sm:-ml-[3rem] md:-ml-[4rem] mt-[1rem]'>
                  <div className='w-full max-w-[120%] max-h-[120%] 2xl:max-w-[256px] 3xl:max-w-[307px] xsm:max-w-[128px] sm:max-w-[179px] csm:max-w-[194px] md:max-w-[230px] lg:max-w-[210px] 2xl:h-[205px] 3xl:h-[256px] h-[128px] xsm:h-[102px] sm:h-[143px] csm:h-[179px] relative'>
                    <Image
                      src='/assets/dawn.svg'
                      className='object-contain'
                      fill
                      alt=''
                    />
                  </div>
                </div>
              </div>
            </div>
            </Slide>
            <Slide
              direction='right'
              duration={1000}
              className='w-full flex justify-center items-center'
              triggerOnce
            >
              <div className='wrapper1 w-full !rounded-tl-[80px] max-w-[550px] lg:max-w-full h-full'>
                <div className='w-full max-w-[550px] !rounded-tl-[80px] lg:max-w-full borderGradientC1 h-full px-0 sm:px-6 py-6 relative justify-between flex flex-col items-center lg:items-start'>
                <div className='w-full flex justify-center lg:justify-end lg:absolute right-5 lg:right-10 bottom-20 lg:ml-0 -ml-[5rem] sm:-ml-[7rem] md:-ml-[5rem] mt-[1rem]'>
                  <div className='w-full flex max-w-[180px] 2xl:max-w-[300px] 3xl:max-w-[360px] xsm:max-w-[150px] sm:max-w-[210px] csm:max-w-[228px] md:max-w-[270px] lg:max-w-[252px] 2xl:h-[240px] 3xl:h-[300px] h-[150px] xsm:h-[120px] sm:h-[168px] csm:h-[210px] relative'>
                    <Image
                      src='/assets/market.svg'
                      className='object-cover'
                      fill
                      alt=''
                    />
                  </div>
                </div>
                  <div className='flex flex-col items-center lg:items-start w-full gap-2'>
                    <h2 className='text-[26px] sm:text-[32px] 3xl:text-[75px] xl:text-[48px] 2xl:text-[58px] mt-[5rem] sm:mt-[4rem] lg:text-left text-center lg:mt-[6rem] xl:mt-[8rem] tracking-[3px] textColor2 sm:text-[#bca378] font-terminaExtraDemi'>
                      Permissionless <br />
                      <span className='textColor'>
                        Markets
                      </span>
                    </h2>
                    <p className='text-[#bca378]/70 w-full lg:text-left 2xl:text-[22px] 3xl:text-[32px] text-center max-w-[400px] 3xl:max-w-[600px] text-[16px] font-normal'>
                    The cheapest place to create new token markets. Anyone can create a market with negligible gas costs, 
                    enabling infinite trading pairs. Simple setup requires just the token mint. Absolute trading granularity - 
                    ticks are gone, no minimum trade sizes.  Zero reason not to have a Manifest market for every token.
                    </p>
                  </div>
                </div>
              </div>
            </Slide>
          </div>
          <div className='w-full grid grid-cols-1 lg:grid-cols-[1.3fr,2fr] xl:grid-cols-[0.8fr,1fr,1fr] gap-6 2xl:gap-8 3xl:gap-12 z-50 mt-4 lg:mt-3 2xl:mt-[2rem] 3xl:mt-[48px]'>
            <Fade
              duration={800}
              delay={200}
              className='w-full justify-center items-center flex'
              triggerOnce
            >
              <div className='w-full max-w-[550px] min-h-[550px] !rounded-bl-[80px] h-full wrapper1'>
                <div className='w-full max-w-[550px] !rounded-bl-[80px] borderGradientC1 h-full flex items-center lg:items-start justify-between flex-col px-0 sm:px-6 py-6 lg:pb-6 pb-10 sm:pb-20'>
                  <div className='w-full max-w-[550px] flex flex-col gap-4'>
                    <h2 className='text-[40px] lg:block hidden 2xl:text-[58px] 3xl:text-[75px] tracking-[3px] mt-20 leading-[50px] 2xl:leading-[70px] 3xl:leading-[90px] text-[#bca378] font-terminaExtraDemi'>
                      <span className='textColor'> Showcasing</span> Solana
                    </h2>
                    <h2 className='text-[26px] sm:text-[40px] lg:hidden block tracking-[3px] text-center mt-10 leading-[40px] sm:leading-[50px] textColor font-terminaExtraDemi'>
                      <span className='textColor sm:textColor'>
                        {' '}
                        Showcasing <br />{' '}
                      </span>{' '}
                        Solana
                    </h2>
                    <p className='text-[#bca378]/70 lg:text-left 2xl:text-[22px] 3xl:text-[32px] text-center text-[16px] font-normal'>
                    Supporting the Token 2022 standard allows for better control and customization for token 
                    issuers choosing to list on Manifest. Reallocated accounts 
                    minimizes rent and maximizes on-chain throughput. 
                    Bringing the NASDAQ at the speed of light vision back to reality.
                    </p>
                  </div>
                  <div className='w-full flex justify-center lg:justify-end lg:absolute lg:right-0 bottom-5 lg:ml-0 -ml-[4rem] sm:-ml-[6rem] md:-ml-[4rem] mt-[1rem]'>
                <div className='w-full max-w-[120%] max-h-[120%] 2xl:max-w-[256px] 3xl:max-w-[307px] xsm:max-w-[128px] sm:max-w-[179px] csm:max-w-[194px] md:max-w-[230px] lg:max-w-[210px] 2xl:h-[205px] 3xl:h-[256px] h-[128px] xsm:h-[102px] sm:h-[143px] csm:h-[179px] relative'>
                  <Image
                    src='/assets/solana.svg'
                    className='object-contain'
                    fill
                    alt=''
                  />
                </div>
              </div>
                </div>
              </div>
            </Fade>
            <Fade
              duration={800}
              delay={400}
              className='w-full flex justify-center items-center'
              triggerOnce
            >
              <div className='w-full max-w-[550px] lg:max-w-[700px] xl:max-w-[650px] 3xl:max-w-[800px] h-full wrapper1'>
                <div className='w-full max-w-[550px] lg:max-w-[700px] 3xl:max-w-[800px] xl:max-w-[650px] borderGradientC1 h-full flex justify-between items-center lg:items-start flex-col px-0 sm:px-6 py-6'>
                <div className='w-full flex justify-center lg:justify-end lg:absolute right-0 lg:right-4 top-5 lg:ml-0 -ml-[5rem] sm:-ml-[7rem] md:-ml-[5rem] mt-[1rem]'>
                  <div className='w-full max-h-[240px] 2xl:max-w-[400px] 3xl:max-w-[480px] xsm:max-w-[200px] sm:max-w-[280px] csm:max-w-[304px] md:max-w-[360px] lg:max-w-[336px] 2xl:h-[320px] 3xl:h-[400px] h-[200px] xsm:h-[160px] sm:h-[224px] csm:h-[280px] relative'>
                    <Image
                      src='/assets/custom.svg'
                      className='object-cover'
                      fill
                      alt=''
                    />
                  </div>
                </div>
                <div className='w-full flex gap-4 flex-col'>
                  <h2 className='text-[26px] sm:text-[40px] 2xl:text-[58px] 3xl:text-[75px] z-40 text-center lg:text-left whitespace-nowrap -mt-10 sm:-mt-[4rem] md:-mt-[4rem] lg:mt-[12rem] 2xl:mt-[14rem] 3xl:mt-[22rem] tracking-[3px] leading-[40px] 2xl:leading-[80px] sm:leading-[55px] textColor2 font-terminaExtraDemi'>
                    Endless <br />{' '}
                    <span className='textColor'>
                      Customization
                    </span>
                  </h2>
                  <p className='text-[#bca378]/70 lg:text-left 3xl:text-[32px] 2xl:text-[22px] text-center text-[16px] font-normal overflow-wrap break-word'>
                    Breakthrough Solana program architecture including a core & 
                    wrapper enables greater composability for 
                    traders and exchange interfaces. Customize feature 
                    sets and unleash distribution for a variety of market requirements. 
                  </p>
                </div>
                  <div className='w-full flex justify-center lg:justify-end lg:mt-6 mt-8 2xl:mt-12'>
                  </div>
                </div>
              </div>
            </Fade>
            <Fade
              duration={800}
              delay={600}
              className='w-full z-40 flex justify-center items-center'
              triggerOnce
            >
              <div className='w-full h-full max-w-[550px] 2xl:max-w-[600px] 3xl:max-w-[800px] !rounded-tr-[80px] wrapper1'>
                <div className='w-full max-w-[550px] h-full 2xl:max-w-[600px] 3xl:max-w-[800px] !rounded-tr-[80px] borderGradientC1 flex justify-between items-start flex-col px-0 sm:px-6 py-6'>
                
                <div className='w-full flex justify-center lg:justify-end lg:absolute right-0 lg:right-4 top-5 lg:ml-0 -ml-[5rem] sm:-ml-[7rem] md:-ml-[5rem] mt-[1rem]'>
                  <div className='w-full max-h-[200px] 2xl:max-w-[200px] 3xl:max-w-[240px] xsm:max-w-[100px] sm:max-w-[140px] csm:max-w-[157px] md:max-w-[180px] lg:max-w-[168px] 2xl:h-[160px] 3xl:h-[200px] h-[100px] xsm:h-[80px] sm:h-[112px] csm:h-[140px] relative'>
                    <Image
                      src='/assets/lock.svg'
                      className='object-cover'
                      fill
                      alt=''
                    />
                  </div>
                </div><div className='w-full flex flex-col gap-4'>
                  <h2 className='text-[40px] whitespace-nowrap 2xl:text-[58px] 3xl:text-[75px] lg:block hidden mt-[9rem] tracking-[3px] leading-[40px] sm:leading-[55px] 2xl:leading-[70px] 3xl:leading-[90px] textColor font-terminaExtraDemi'>
                    Formally <br /> Verified{' '}
                    <span className='textColor2'>
                      {' '}
                      <br /> Immutable
                    </span>
                  </h2>
                  <h2 className='text-[26px] sm:text-[40px] lg:hidden block break-all text-center mt-[5rem] lg:mt-[9rem] tracking-[3px] leading-[40px] sm:leading-[55px] text-[#bca378] font-terminaExtraDemi'>
                    Formally <br /> Verified <br />
                    <span className='textColor2'> Immutable</span>
                  </h2>
                  <p className='text-[#bca378]/70 lg:text-left 3xl:text-[32px] 2xl:text-[22px] text-center text-[16px] font-normal overflow-wrap break-word'>
                    The only immutable formally verified on-chain orderbook. Automatically secured via rigorous 
                    fuzzing & extensive test coverage. Targeting formal verification from a Certora audit to permit the program to become confidently immutable.
                  </p>
                </div>
                  <div className='w-full flex justify-center lg:justify-end mt-8 lg:mt-28'>
                  </div>
                </div>
              </div>
            </Fade>
          </div>
          <div className='w-full grid grid-cols-1 lg:grid-cols-[1.3fr,2fr] gap-6 2xl:gap-8 3xl:gap-12 z-50 mt-4 lg:mt-0 2xl:mt-[3rem]'>
            <Slide
              direction='left'
              duration={1000}
              className='w-full justify-center flex items-center overflow-hidden'
              triggerOnce
            >
              <div className='w-full max-w-[550px] 2xl:w-[680px] 3xl:w-[850px] lg:max-w-full h-full relative wrapper1'>
                <div className='px-0 w-full sm:px-6 py-0 sm:py-6 flex flex-col borderGradientC1 justify-between lg:items-start items-center h-full'>
                <div className='w-full max-w-[120%] max-h-[120%] 2xl:max-w-[256px] 3xl:max-w-[307px] xsm:max-w-[128px] sm:max-w-[179px] csm:max-w-[194px] md:max-w-[230px] lg:max-w-[210px] 2xl:h-[205px] 3xl:h-[256px] h-[128px] xsm:h-[102px] sm:h-[143px] csm:h-[179px] relative'>
                  <Image
                    src='/assets/benchmark.svg'
                    className='object-contain'
                    fill
                    alt=''
                  />
                </div>
                  <div className='w-full flex flex-col gap-2'>
                  <div className='block lg:absolute -right-0 -top-[0px]'>
                    </div>
                    <h2 className='text-[26px] sm:text-[32px] sm:mt-2 md:mt-14 text-center lg:text-left xl:text-[48px] 2xl:text-[58px] 3xl:text-[75px] mt-12 lg:mt-[4rem] xl:mt-[8rem] tracking-[3px] textColor2 font-terminaExtraDemi'>
                      Compute <br />
                      <span className='textColor'> Optimized</span>
                    </h2>
                    <p className='text-[#bca378]/70 lg:text-left text-center text-[16px] 2xl:text-[22px] 3xl:text-[32px] font-normal'>
                    Innovative design that utilizes expandable accounts to save on rent. The stripped down, 
                    pay as you go program benchmarks as the top orderbook protocol in existence.
                    </p>
                    <a
                    href='https://cks-systems.github.io/manifest/dev/bench/'
                    className='flex hover:opacity-80 hrGr group z-50 justify-center items-center gap-2 mt-8 lg:mt-14 xl:mt-8'
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    <p className='text-[#bca378] 3xl:text-[32px] 2xl:text-[22px] text-[16px] font-normal'>
                    Check Benchmarking
                    </p>
                    <FiArrowRight className='text-[20px] 3xl:text-[36px] 2xl:text-[26px] text-[#bca378] group-hover:text-[#00ffe5]' />
                  </a>
                  </div>
                </div>
              </div>
            </Slide>
            <Slide
              direction='right'
              duration={1000}
              className='w-full flex justify-center items-center'
              triggerOnce
            >
              <div className='wrapper1 w-full !rounded-tl-[80px] max-w-[550px] lg:max-w-full h-full'>
                <div className='w-full max-w-[550px] !rounded-tl-[80px] lg:max-w-full borderGradientC1 h-full px-0 sm:px-6 py-6 relative justify-between flex flex-col items-center lg:items-start'>
                  <div className='flex flex-col items-center lg:items-start w-full gap-2'>
                    <h2 className='text-[26px] sm:text-[32px] 3xl:text-[75px] xl:text-[48px] 2xl:text-[58px] mt-[5rem] sm:mt-[4rem] lg:text-left text-center lg:mt-[6rem] xl:mt-[8rem] tracking-[3px] textColor2 sm:text-[#bca378] font-terminaExtraDemi'>
                      Capitally <br />
                      <span className='textColor sm:textColor2'>
                        Efficient
                      </span>
                    </h2>
                    <p className='text-[#bca378]/70 w-full lg:text-left 2xl:text-[22px] 3xl:text-[32px] text-center max-w-[400px] 3xl:max-w-[600px] text-[16px] font-normal'>
                      A novel global order type unlocks unparalleled capital efficiency for a spot exchange.
                      Provide multiple bids or offers simultaneously utilizing the same funds.
                      Don&apos;t lock up tokens unnecessarily in open order accounts.
                    </p>
                  </div>
                  <div className='w-full flex justify-center lg:justify-end lg:absolute lg:right-0 lg:bottom-0 lg:ml-0 md:ml-0 sm:ml-0 -ml-[4rem] xsm:-ml-[2rem] sm:-ml-[3rem] md:-ml-[4rem] mt-[1rem]'>
                  <div className='w-full max-w-[350px] lg:max-w-[262px] lg:h-[235px] xl:max-w-[294px] xl:h-[263px] 2xl:max-w-[413px] 2xl:h-[367px] 3xl:max-w-[525px] 3xl:h-[472px] relative'>
                    <div className='hidden lg:block'>
                      <Image
                        src='/assets/exchange.svg'
                        fill
                        alt=''
                        className='object-cover'
                      />
                    </div>
                    <div className='lg:hidden'>
                      <div className='w-full max-w-[262px] lg:max-w-[168px] xl:max-w-[220px] 2xl:max-w-[309px] 3xl:max-w-[393px] h-[235px] lg:h-[136px] xl:h-[183px] 2xl:h-[263px] 3xl:h-[340px] relative'>
                        <Image
                          src='/assets/exchange.svg'
                          fill
                          alt=''
                          className='object-cover'
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className='h-[4rem] lg:hidden'></div>
                </div>
              </div>
            </Slide>
          </div>
        </div>
      </Wrapper>
    </div>
  );
};

export default Features;
