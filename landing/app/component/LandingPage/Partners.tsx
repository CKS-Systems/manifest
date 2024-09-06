'use client';

import React from 'react';
import Wrapper from '../shared/ComponentWrapper/Wrapper';
import Image from 'next/image';
import { Fade, Slide } from 'react-awesome-reveal';

const page = () => {
  return (
    <div className='w-full min-h-[calc(100vh-60px)] sm:min-h-[calc(100vh-90px)] relative flex justify-center md:justify-center items-center md:items-center py-[5rem] 2xl:py-[9rem] 3xl:py-[15rem]'>
      <Wrapper>
        <div className='relative w-full h-full flex flex-col gap-10 sm:gap-16 2xl:gap-[6rem] 3xl:gap-[11rem] z-10'>
          <Fade triggerOnce duration={800} delay={100}>
            <div className='flex flex-col gap-0 justify-center items-center w-full z-20'>
              <p className='text-[12px] sm:text-[18px] 3xl:text-[48px] 2xl:text-[28px] lg:text-left text-center font-normal textColor'>
                PARTNERS
              </p>
              <h1 className='text-[30px] sm:text-[32px] md:text-[48px] 3xl:text-[120px] 2xl:text-[80px] text-[#bca378] font-terminaheavy'>
                Manifest Together
              </h1>
            </div>
          </Fade>
          <div className='w-full grid grid-cols-1 md:grid-cols-1 gap-x-8 gap-y-[2rem] sm:gap-y-[3rem] 2xl:gap-y-[7rem] 3xl:gap-y-[14rem] z-30'>
            {ecoSystemData.map((item, index) => {
              const slideDirection = index % 2 === 0 ? 'left' : 'right';
              return (
                <Slide
                  key={index}
                  direction={slideDirection}
                  duration={800}
                  triggerOnce
                  delay={200 + index * 100}
                >
                  <div className='w-full cursor-pointer hover:opacity-60 flex flex-col justify-center items-center gap-3'>
                    <p className='text-[12px] uppercase sm:text-[18px] 2xl:text-[28px] 3xl:text-[48px] lg:text-left text-center font-normal textColor'>
                      {item.name}
                    </p>
                    <div className='h-[50px] md:h-[80px] flex justify-center items-center'>
                      {item.img}
                    </div>
                  </div>
                </Slide>
              );
            })}
          </div>
        </div>
      </Wrapper>
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-radial from-[#403822] to-[#000000] z-0"></div>
    </div>
  );
};


const ecoSystemData = [
  {
    path: '#',
    name: '',
    img: (
      <a href='https://cks.systems/' target='_blank' rel='noopener noreferrer'>
      <div className='w-[540px] sm:w-[900px] 2xl:w-[1650px] 3xl:w-[2400px] h-[135px] 2xl:h-[360px] 3xl:h-[900px] sm:h-[240px] relative'>
          <Image src='/assets/Cks-logo.svg' fill alt='' className='object-contain' />
        </div>
      </a>
    ),
  },
  {
    path: '#',
    name: '',
    img: (
      <a href='https://app.dual.finance/loan' target='_blank' rel='noopener noreferrer'>
      <div className='w-[180px] sm:w-[300px] 2xl:w-[550px] 3xl:w-[800px] h-[45px] 2xl:h-[120px] 3xl:h-[300px] sm:h-[80px] relative'>
        <Image src='/assets/dual-finance-logo.svg' fill alt='' className='object-fill' />
      </div>
      </a>
    ),
  },
  {
    path: '#',
    name: '',
    img: (
      <a href='https://app.mango.markets/trade/' target='_blank' rel='noopener noreferrer'>
      <div className='w-[180px] sm:w-[300px] 2xl:w-[550px] 3xl:w-[800px] h-[45px] 2xl:h-[120px] 3xl:h-[300px] sm:h-[80px] relative'>
        <Image src='/assets/mango.svg' fill alt='' className='object-fill' />
      </div>
      </a>
    ),
  }, 
];

export default page;
