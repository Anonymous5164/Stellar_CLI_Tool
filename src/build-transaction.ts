import {Horizon, Keypair, TransactionBuilder, Networks, Operation, Asset, Memo} from 'stellar-sdk';
import * as readline from 'readline';
import * as crypto from 'crypto';

const TESTNET_CONFIG = {
  horizon: 'https://horizon-testnet.stellar.org',
  passphrase: 'Test SDF Network ; September 2015',
  friendbot: 'https://friendbot.stellar.org'
};

const MAINNET_CONFIG = {
  horizon: 'https://horizon.stellar.org',
  passphrase: 'Public Global Stellar Network ; September 2015'
};

const SOURCE_PUBLIC_KEY = 'GDBKSMQZAJ3DBIM55BAWY7I4QSRUHZ3IOJV2YJAVQHWUXMGIDVS5MGNM';

const MIN_ACCOUNT_BALANCE = '1.0000000';

const TESTNET_NETWORK_HASH = Buffer.from([
  0xce, 0xe0, 0x30, 0x2d, 0x7f, 0xc5, 0x27, 0x3c,
  0x88, 0x6d, 0xb1, 0x49, 0xa5, 0x3b, 0x0f, 0x44,
  0x02, 0xec, 0x4c, 0x25, 0xb6, 0x1a, 0x0c, 0x8b,
  0x24, 0x8e, 0x63, 0x72, 0x4f, 0x2f, 0x66, 0xfb
]);

const MAINNET_NETWORK_HASH = Buffer.from([
  0x7a, 0xc3, 0x39, 0x97, 0x54, 0x4e, 0x31, 0x75,
  0xd2, 0x66, 0xbd, 0x02, 0x24, 0x39, 0xb2, 0x2c,
  0xdb, 0x16, 0x50, 0x8c, 0x01, 0x16, 0x3f, 0x26,
  0xe5, 0xcb, 0x2a, 0x3e, 0x10, 0x45, 0xa9, 0x79
]);

interface TransactionData {
  xdr: string;
  networkHash: Buffer;
  transaction: any;
  details: {
    source: string;
    destination: string;
    amount: string;
    memo: string | null;
    fee: string;
    sequence: string;
  };
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function isValidStellarAddress(address: string): boolean {
  try {
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  return num.toFixed(7);
}

function isValidHex(str: string, expectedLength: number): boolean {
  return /^[0-9a-fA-F]+$/.test(str) && str.length === expectedLength;
}

function getByteLength(str: string): number {
  return Buffer.byteLength(str, 'utf8');
}

async function checkAccountActivation(server: Horizon.Server): Promise<void> {
  try {
    await server.loadAccount(SOURCE_PUBLIC_KEY);
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(`Source account ${SOURCE_PUBLIC_KEY} not found on network. Fund it first!`);
    }
    throw new Error(`Failed to check account: ${error.message}`);
  }
}

async function checkDestinationAccountExists(server: Horizon.Server, destination: string): Promise<boolean> {
  try {
    await server.loadAccount(destination);
    return true;
  } catch (error: any) {
    if (error.response?.status === 404) {
      return false;
    }
    return true;
  }
}

async function getMemoInput(): Promise<any> {
  console.log('\nMemo types:');
  console.log('1. TEXT (max 28 bytes)');
  console.log('2. ID (0 to 18446744073709551615)');
  console.log('3. HASH (32 byte hex)');
  console.log('4. RETURN (32 byte hex)');
  console.log('5. None');
  
  let memoType: string;
  do {
    memoType = await askQuestion('Select memo type (1-5): ');
  } while (!['1', '2', '3', '4', '5'].includes(memoType));
  
  if (memoType === '5') return null;
  
  let memoValue = await askQuestion('Enter memo value: ');
  
  switch (memoType) {
    case '1':
      if (getByteLength(memoValue) > 28) {
        throw new Error('TEXT memo exceeds 28 bytes');
      }
      return Memo.text(memoValue);
    
    case '2':
      const idValue = BigInt(memoValue);
      if (idValue < 0n || idValue > 18446744073709551615n) {
        throw new Error('ID memo must be between 0 and 18446744073709551615');
      }
      return Memo.id(memoValue);
    
    case '3':
      if (!isValidHex(memoValue, 64)) {
        throw new Error('HASH memo must be 64 hex characters (32 bytes)');
      }
      return Memo.hash(memoValue);
    
    case '4':
      if (!isValidHex(memoValue, 64)) {
        throw new Error('RETURN memo must be 64 hex characters (32 bytes)');
      }
      return Memo.return(memoValue);
    
    default:
      return null;
  }
}

async function buildStellarTransaction(config: any, networkHash: Buffer): Promise<TransactionData> {
  const server = new Horizon.Server(config.horizon);
  
  try {
    await checkAccountActivation(server);
    const sourceAccount = await server.loadAccount(SOURCE_PUBLIC_KEY);
    
    let destination: string;
    do {
      destination = await askQuestion('Destination address: ');
      if (!isValidStellarAddress(destination)) {
        console.log('Invalid address');
      }
    } while (!isValidStellarAddress(destination));
    
    const destinationExists = await checkDestinationAccountExists(server, destination);
    let operationType: 'payment' | 'createAccount' = 'payment';

    if (!destinationExists) {
      console.log('Destination address not activated switching operation to Create Account');
      operationType = 'createAccount';
    }
    
    let amount: string;
    do {
      amount = await askQuestion('Amount (XLM): ');
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        console.log('Invalid amount');
      } else if (operationType === 'createAccount' && amountNum < parseFloat(MIN_ACCOUNT_BALANCE)) {
        console.log(`Create Account requires minimum ${MIN_ACCOUNT_BALANCE} XLM`);
      } else {
        break;
      }
    } while (true);
    
    const memo = await getMemoInput();
    
    let txBuilder = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: config.passphrase
    });
    
    if (operationType === 'createAccount') {
      txBuilder = txBuilder.addOperation(Operation.createAccount({
        destination: destination,
        startingBalance: formatAmount(amount)
      }));
    } else {
      txBuilder = txBuilder.addOperation(Operation.payment({
        destination: destination,
        asset: Asset.native(),
        amount: formatAmount(amount)
      }));
    }
    
    txBuilder = txBuilder.setTimeout(0);
    
    if (memo) {
      txBuilder = txBuilder.addMemo(memo);
    }
    
    const transaction = txBuilder.build();
    const xdr = transaction.toEnvelope().toXDR('base64');
    
    const transactionData: TransactionData = {
      xdr: xdr,
      networkHash: networkHash,
      transaction: transaction,
      details: {
        source: SOURCE_PUBLIC_KEY,
        destination: destination,
        amount: formatAmount(amount),
        memo: memo ? memo.value || memo._value : null,
        fee: "0.00001",
        sequence: (parseInt(sourceAccount.sequence) + 1).toString()
      }
    };
    
    return transactionData;
    
  } catch (error: any) {
    throw new Error(`Failed to build transaction: ${error.message}`);
  }
}

function displayTransaction(txData: TransactionData): void {
  console.log(txData.xdr);
}

async function broadcastTransaction(config: any): Promise<void> {
  const server = new Horizon.Server(config.horizon);
  
  const signedXdr = await askQuestion('Enter signed XDR: ');
  
  try {
    const transaction = TransactionBuilder.fromXDR(signedXdr, config.passphrase);
    const result = await server.submitTransaction(transaction);
    console.log('Transaction successful!');
    console.log('Hash:', result.hash);
    console.log('Ledger:', result.ledger);
  } catch (error: any) {
    if (error.response?.data?.extras?.result_codes) {
      const codes = error.response.data.extras.result_codes;
      console.error('Transaction failed:', codes);
    } else {
      console.error('Broadcast error:', error.message);
    }
  }
}

async function main(): Promise<void> {
  try {
    console.log('Select network:');
    console.log('1. Testnet');
    console.log('2. Mainnet');
    
    let networkChoice: string;
    do {
      networkChoice = await askQuestion('Choose network (1-2): ');
    } while (!['1', '2'].includes(networkChoice));
    
    const isMainnet = networkChoice === '2';
    const config = isMainnet ? MAINNET_CONFIG : TESTNET_CONFIG;
    const networkHash = isMainnet ? MAINNET_NETWORK_HASH : TESTNET_NETWORK_HASH;
    
    if (isMainnet) {
      console.log('WARNING: You are using MAINNET - real XLM will be transferred!');
      const confirm = await askQuestion('Continue? (yes/no): ');
      if (confirm.toLowerCase() !== 'yes') {
        console.log('Operation cancelled.');
        return;
      }
    }
    
    console.log('Select operation:');
    console.log('1. Create unsigned transaction');
    console.log('2. Broadcast signed transaction');
    
    let choice: string;
    do {
      choice = await askQuestion('Choose option (1-2): ');
    } while (!['1', '2'].includes(choice));
    
    if (choice === '1') {
      const txData = await buildStellarTransaction(config, networkHash);
      displayTransaction(txData);
    } else {
      await broadcastTransaction(config);
    }
    
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main();
}