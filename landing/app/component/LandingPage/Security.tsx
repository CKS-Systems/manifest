'use client';

import React from 'react';
import Wrapper from '../shared/ComponentWrapper/Wrapper';
import * as Icons from '../../svg/Icons';
import { Fade, Slide } from 'react-awesome-reveal';

const Security = () => {
  return (
    <div className='w-full overflow-x-hidden mt-6 py-10 sm:py-16 2xl:py-[5rem] secBg relative overflow-hidden z-50'>
      <Wrapper>
        <div className='w-full flex flex-col gap-2 justify-center items-center'>
          <Fade duration={800} delay={100} triggerOnce>
            <p className='text-[12px] sm:text-[18px] 2xl:text-[22px] 3xl:text-[32px] font-normal textColor'>
              SECURITY
            </p>
          </Fade>
          <Slide direction='up' duration={800} delay={200} triggerOnce>
            <h1 className='text-[20px] sm:text-[28px] 2xl:text-[40px] 3xl:text-[60px] textColor2 font-semibold'>
              Audit & Formal Verification by
            </h1>
          </Slide>
          <Slide direction='up' duration={800} delay={300} triggerOnce>
            <div className='flex justify-center items-center gap-2 mt-4'>
              <Icons.certora className='w-[90px] sm:w-[313px] 2xl:w-[450px] 3xl:w-[620px] h-[17px] sm:h-[57px] 2xl:h-[100px] 3xl:h-[180px]' />
            </div>
          </Slide>

          <Fade
            duration={800}
            delay={400}
            triggerOnce
            className='z-50 mb-0 2xl:mb-[0rem]'
          >
          <a
            href="https://github.com/CKS-Systems/manifest"
            target="_blank"
            rel="noopener noreferrer"
            className='inline-block px-[20px] py-[10px] mt-6 sm:mt-10 active:translate-y-[1px] hover:opacity-80 rounded-lg bg-[#95C9BD] text-black/80 text-[14px] sm:text-[16px] font-medium'
          >
            Report Coming Soon
          </a>
          </Fade>
        </div>
      </Wrapper>
      <Icons.shade2 className=' w-[400px] md:w-[690px] h-[350px] md:h-[600px] hidden sm:absolute -left-[15%] -top-[30%]' />
      <Icons.shade2 className='w-[400px] md:w-[650px] h-[500px] md:h-[600px] hidden sm:absolute -right-[10%] -top-[30%]' />
    </div>
  );
};

export default Security;
