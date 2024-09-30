import { ReactElement } from 'react';
import { useAppState } from './AppWalletProvider';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { getSolscanUrl, shortenAddress } from '@/lib/util';

type SolscanLinkProps = {
  shorten?: boolean;
  address: string;
};

const SolscanAddrLink = ({
  address,
  shorten = true,
}: SolscanLinkProps): ReactElement => {
  const { network } = useAppState();
  const solscanUrl = getSolscanUrl(
    address,
    network || WalletAdapterNetwork.Devnet,
  );
  const content = shorten ? shortenAddress(address) : address;

  return (
    <a href={solscanUrl} target="_blank" rel="noopener noreferrer">
      {content}
    </a>
  );
};

export default SolscanAddrLink;
