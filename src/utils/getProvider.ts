import { providers } from 'ethers';
import { loadEnv } from './loadEnv';
import { Network } from '@enzymefinance/environment';

export function getProvider(network: 'ETHEREUM' | 'POLYGON') {
  const node = loadEnv(`${network}_NODE_ENDPOINT`);
  const networkId = network === 'ETHEREUM' ? Network.ETHEREUM : Network.POLYGON;
  //return new providers.InfuraProvider('mainnet', 'c52e530865d52a9f190658c6e04bd524');
  return new providers.JsonRpcProvider(node, networkId);
}
