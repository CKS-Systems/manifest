import { usePathname } from 'next/navigation';
import { ComponentType, ReactElement } from 'react';

export const withAccessControl = <P extends NonNullable<unknown>>(
  Component: ComponentType<P>,
): any => {
  const WrappedComponent = (props: P): ReactElement => {
    const pathname = usePathname();

    const readOnly = process.env.NEXT_PUBLIC_READ_ONLY === 'true';
    const writeRoutes = ['/interact', '/create-market'];

    const isWriteRoute = writeRoutes.some((r) => pathname.startsWith(r));

    if (readOnly && isWriteRoute) {
      return (
        <div className="flex justify-center items-center h-screen">
          <h1 className="text-4xl font-bold text-red-500">Access Denied</h1>
          <p className="text-xl">
            You do not have permission to access this page.
          </p>
        </div>
      );
    }

    return <Component {...props} />;
  };

  return WrappedComponent;
};
