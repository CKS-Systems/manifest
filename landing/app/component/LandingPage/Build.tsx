'use client';

import React from 'react';
import Image from 'next/image';
import { Fade, Slide } from 'react-awesome-reveal';

const Build = () => {
  return (
    <a 
      href="https://docs.google.com/forms/d/e/1FAIpQLSf9HhyExwnqnFuWN3FI5YZJ_cjmS-yGUBsmweVs-BVACVw2Zw/viewform" 
      className="block w-full h-[100px] sm:h-[200px] md:h-[256px] 2xl:h-[350px] 3xl:h-[500px] bg-[url('/assets/desert.png')] bg-no-repeat bg-cover relative"
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className='w-full overflow-x-hidden bg-[#121616] md:gap-0 gap-10 sm:gap-8 absolute left-[50%] -translate-x-[50%] -bottom-[330%] sm:-bottom-[140%] md:-bottom-[45%] max-w-[320px] sm:max-w-[450px] md:max-w-[700px] lg:max-w-[900px] 2xl:max-w-[1250px] 3xl:max-w-[1800px] flex md:flex-row flex-col justify-between items-center px-6 sm:px-4 md:px-7 2xl:px-16 py-8 sm:py-5 2xl:py-10 rounded-lg 3xl:rounded-2xl'>
        <div className='flex flex-col gap-2'>
          <Fade duration={500} delay={100} triggerOnce>
            <p className='text-[12px] sm:text-[16px] lg:text-[18px] 2xl:text-[22px] 3xl:text-[32px] font-normal textColor'>
              GET IN TOUCH
            </p>
          </Fade>
          <Slide direction='up' duration={500} delay={200} triggerOnce>
            <h2 className='text-[24px] sm:text-[30px] lg:text-[38px] 2xl:text-[50px] 3xl:text-[80px] textColor2 font-semibold'>
              All tokens, all traders welcome.
            </h2>
          </Slide>
          <div className='flex justify-center items-center gap-4 sm:gap-10 lg:gap-24'>
            <Fade duration={500} delay={300} triggerOnce>
              <p className='text-[#bca378] font-medium text-[16px] sm:text-[18px] 2xl:text-[30px] 3xl:text-[40px] lg:text-[20px]'>
                <a className='text-[#bca378]/70 font-medium text-[16px] sm:text-[18px] lg:text-[20px]'>
                  Manifest the on-chain world with us! 
                </a>
              </p>
            </Fade>
            <Slide direction='right' duration={500} delay={400} triggerOnce>
              <div className='w-[90px] sm:w-[200px] 2xl:w-[350px] lg:w-[250px] 3xl:w-[450px] 3xl:h-[179px] h-[40px] sm:h-[60px] lg:h-[86px] 2xl:h-[130px] relative'>
                <Image
                  src='/assets/sendArrow.png'
                  fill
                  alt=''
                  className='object-cover'
                />
              </div>
            </Slide>
          </div>
        </div>
        <Slide direction='left' duration={500} delay={500} triggerOnce>
          <div className='w-[170px] lg:w-[190px] 2xl:w-[300px] 3xl:w-[450px] h-[170px] lg:h-[190px] 2xl:h-[300px] 3xl:h-[450px] relative'>
            <Image
              src='/assets/logo.png'
              fill
              alt=''
              className='object-cover'
            />
          </div>
        </Slide>
      </div>
    </a>
  );
};



export default Build;
