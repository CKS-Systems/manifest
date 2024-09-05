import React, { ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  style?: string;
}

const Wrapper: React.FC<Props> = ({ children, style }: Props) => {
  return (
    <div className={`w-full h-full ${style}`}>
      <div className='w-full h-full max-w-[1280px] 2xl:max-w-[1850px] 3xl:max-w-[2300px] m-auto md:px-8 px-4 '>
        {children}
      </div>
    </div>
  );
};

export default Wrapper;
