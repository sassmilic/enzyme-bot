import { EnzymeBot } from './EnzymeBot';
import { getGasPrice, getPolygonGasPrice } from './utils/getGasPrice';
import { getRevertError } from './utils/getRevertError';

async function run(bot: EnzymeBot) {
  try {
    // return the transaction object
    console.log("BEFORE");
    const tx = await bot.tradeAlgorithmically();
    console.log("AFTER");

    // if for some reason the transaction is returned as undefined, return
    if (!tx) {
      console.log('The bot has decided not to trade');
      return;
    }

    // verifies you can send the tx - throws an exception if it doesn't validate
    await tx.call();

    // get gas limit ()
    const gasLimit = (await tx.estimate()).mul(10).div(9);

    // on mainnet, returns a gasPrice in gwei from EthGasStation that's most likely to get your transaction done within N minutes
    const gasPrice = bot.network === 'POLYGON' ? await getPolygonGasPrice() : await getGasPrice(3);

    console.log(`gas limit: ${gasLimit}`);
    console.log(`gas price: ${gasPrice}`);

    // if send is set to false it'll give you the tx object that contains the hash
    const resolved = await tx.gas(gasLimit, Math.ceil(gasPrice) * 1000000000).send();

    console.log(5);
    console.log('This trade has been submitted to the blockchain. TRANSACTION HASH ==>', resolved.transactionHash);

    console.log(6);
    console.log(`Transaction successful. You spent ${resolved.gasUsed.toString()} in gas.`);
    console.log(7);

    return;
  } catch (error: any) {
    console.error('THE BOT FAILED :*(. Error below: ');

    if (error.error?.data) {
      console.log(getRevertError(error.error.data));
      return;
    }

    if (error.error?.message) {
      console.log(error.error.message);
      return;
    }

    console.log(error);
  } finally {
    console.log('Scheduling the next iteration...');

    setTimeout(() => {
      run(bot);
    }, 1000 * 60);
  }
}

(async function main() {
  console.log('STARTING IT UP');
  run(await EnzymeBot.create('ETHEREUM'));
})();
