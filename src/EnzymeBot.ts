import {
  callOnIntegrationArgs,
  ComptrollerLib,
  IntegrationManagerActionId,
  takeOrderSelector,
  uniswapV3TakeOrderArgs,
} from '@enzymefinance/protocol';
import {
  Network,
  getDeployment,
  SuluContracts,
  Environment,
  AssetType,
  PrimitiveAsset,
} from '@enzymefinance/environment';
import { getEnvironment } from '@enzymefinance/environment/all';
import { BigNumber, providers, utils, Wallet } from 'ethers';
import { getProvider } from './utils/getProvider';
import { getTokenBalance } from './utils/getTokenBalance';
import { getVaultInfo } from './utils/getVault';
import { getWallet } from './utils/getWallet';
import { loadEnv } from './utils/loadEnv';
import { VaultDetailsQuery } from './utils/subgraph/subgraph';
import { uniswapV3Price, UniswapPrice } from './utils/uniswap/price';
import { Moon } from "lunarphase-js";

export class EnzymeBot {
  public static async create(network: 'POLYGON' | 'ETHEREUM') {
    const subgraphEndpoint =
      network === 'ETHEREUM' ? loadEnv('ETHEREUM_SUBGRAPH_ENDPOINT') : loadEnv('POLYGON_SUBGRAPH_ENDPOINT');
    const key = network === 'ETHEREUM' ? loadEnv('ETHEREUM_PRIVATE_KEY') : loadEnv('POLYGON_PRIVATE_KEY');
    const provider = getProvider(network);
    const wallet = getWallet(key, provider);
    const vaultAddress = loadEnv('ENZYME_VAULT_ADDRESS');
    const vaultDetails = await getVaultInfo(subgraphEndpoint, vaultAddress);
    const deployment = getDeployment(network === 'ETHEREUM' ? Network.ETHEREUM : Network.POLYGON).slug;
    const environment = getEnvironment(deployment);
    const contracts = environment.contracts;
    const assets = environment.getAssets({ registered: true, types: [AssetType.PRIMITIVE] });

    return new this(
      network,
      environment,
      contracts,
      assets,
      wallet,
      vaultAddress,
      vaultDetails,
      provider,
      subgraphEndpoint
    );
  }

  private constructor(
    public readonly network: 'POLYGON' | 'ETHEREUM',
    public readonly environment: Environment,
    public readonly contracts: SuluContracts,
    public readonly assets: PrimitiveAsset[],
    public readonly wallet: Wallet,
    public readonly vaultAddress: string,
    public readonly vaultDetails: VaultDetailsQuery,
    public readonly provider: providers.JsonRpcProvider,
    public readonly subgraphEndpoint: string
  ) {}

  public async getAssetFromID(ID: string) {
    const holdings = this.vaultDetails.vault?.trackedAssets;
    const asset = holdings.reduce((carry, current) => {
      if (current.id == ID) {
        return current;
      }
      return carry;
    }, holdings[0]);
    return asset;
  }

  public async swapTokens(uniswapPrice: UniswapPrice, outgoingAssetAmount: BigNumber) {
    const adapter = this.contracts.UniswapV3Adapter;
    const integrationManager = this.contracts.IntegrationManager;
    const comptroller = this.vaultDetails.vault?.comptroller.id;

    if (!adapter || !integrationManager || !comptroller) {
      console.log(
        'Missing a contract address. Uniswap Adapter: ',
        adapter,
        ' Integration Manager: ',
        integrationManager
      );
      return;
    }

    if (!uniswapPrice.path || !uniswapPrice.pools) {
      console.log('uniswap price is missing path or pools');
      return;
    }

    const priceWithSlippage = uniswapPrice.amount?.mul(Math.floor((1 - 0.05) * 10000)).div(10000) ?? 0;

    const takeOrderArgs = uniswapV3TakeOrderArgs({
      minIncomingAssetAmount: priceWithSlippage.toString(),
      outgoingAssetAmount: outgoingAssetAmount.toString(),
      pathAddresses: uniswapPrice.path.map((item) => item.address),
      pathFees: uniswapPrice.pools.map((pool) => BigNumber.from(pool.fee)),
    });

    const callArgs = callOnIntegrationArgs({
      adapter,
      selector: takeOrderSelector,
      encodedCallArgs: takeOrderArgs,
    });

    const contract = new ComptrollerLib(comptroller, this.wallet);
    return contract.callOnExtension.args(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs);
  }

  public async tradeAlgorithmically(frequency: Number) {

    const wethID = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const usdcID = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const tradeSizePercent = 0.5;

    // Check the moon phase
    const age = Moon.lunarAge();
    console.log(`The current lunar age is ${age}`);

    const newMoon = age < 1 || age > 28;
    const fullMoon = 13 < age && age < 15;

    if (!newMoon || !fullMoon) {return;}

    let incomingTokenID;
    let outgoingVaultAsset;
    let amount; 

    if (newMoon) {
      // sell `tradeSizePercent` WETH for USDC
      incomingTokenID = await this.getAssetFromID(usdcID);
      outgoingVaultAsset = await this.getAssetFromID(wethID);
      const wethAmount = await getTokenBalance(this.vaultAddress, wethID, this.network);
      amount = wethAmount * tradeSizePercent; 
    } else if (fullMoon) {
      // buy WETH with `tradeSizePercent` USDC
      incomingTokenID = await this.getAssetFromID(wethID);
      outgoingVaultAsset = this.getAssetFromID(usdcID);
      const usdcAmount = await getTokenBalance(this.vaultAddress, usdcID, this.network);
      amount = usdcAmount * tradeSizePercent; 
    } 

    const uniswapPrice = await uniswapV3Price({
      environment: this.environment,
      incoming: incomingTokenID,
      outgoing: outgoingVaultAsset,
      quantity: amount.toString(),
      provider: this.provider,
    });
    
    if (uniswapPrice.status === 'ERROR' || !uniswapPrice.amount || !uniswapPrice.path || !uniswapPrice.pools) {
      console.log('No route for uniswap price found');
      throw new Error('No route for uniswap price found');
    }

    // call the transaction
    return this.swapTokens(uniswapPrice, amount);
  }
}
