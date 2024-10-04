import { PROGRAM_ID } from '../manifest';
import bs58 from 'bs58';
import keccak256 from 'keccak256';

export function genAccDiscriminator(accName: string) {
  return keccak256(
    Buffer.concat([
      Buffer.from(bs58.decode(PROGRAM_ID.toBase58())),
      Buffer.from(accName),
    ]),
  ).subarray(0, 8);
}
