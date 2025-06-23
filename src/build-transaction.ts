import {Horizon, Keypair, TransactionBuilder, Networks, Operation, Asset, Memo} from 'stellar-sdk';
import * as readline from 'readline';
import * as crypto from 'crypto';

// Testnet configuration (hardcoded)
const TESTNET_CONFIG = {
  horizon: 'https://horizon-testnet.stellar.org',
  passphrase: 'Test SDF Network ; September 2015',
  friendbot: 'https://friendbot.stellar.org'
};

// Source account (hardcoded for PoC)
const SOURCE_PUBLIC_KEY = 'GDBKSMQZAJ3DBIM55BAWY7I4QSRUHZ3IOJV2YJAVQHWUXMGIDVS5MGNM'; // Replace this!

// Network hash for C-side (pre-computed)
const TESTNET_NETWORK_HASH = Buffer.from([
  0xce, 0xe0, 0x30, 0x2d, 0x7f, 0xc5, 0x27, 0x3c,
  0x88, 0x6d, 0xb1, 0x49, 0xa5, 0x3b, 0x0f, 0x44,
  0x02, 0xec, 0x4c, 0x25, 0xb6, 0x1a, 0x0c, 0x8b,
  0x24, 0x8e, 0x63, 0x72, 0x4f, 0x2f, 0x66, 0xfb
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

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Helper function to ask questions
function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Validate Stellar address
function isValidStellarAddress(address: string): boolean {
  try {
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}

// Format amount display
function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  return num.toFixed(7);
}

// Main transaction builder function
async function buildStellarTransaction(): Promise<TransactionData> {
  // Initialize Stellar server
  const server = new Horizon.Server(TESTNET_CONFIG.horizon);
  
  try {
    console.log('Loading source account...');
    const sourceAccount = await server.loadAccount(SOURCE_PUBLIC_KEY);
    
    // Get user inputs
    let destination: string;
    do {
      destination = await askQuestion('Destination address: ');
      if (!isValidStellarAddress(destination)) {
        console.log('Invalid address');
      }
    } while (!isValidStellarAddress(destination));
    
    let amount: string;
    do {
      amount = await askQuestion('Amount (XLM): ');
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        console.log('Invalid amount');
      }
    } while (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0);
    
    const memoInput = await askQuestion('Memo (optional): ');
    const memo = memoInput || null;
    
    // Build transaction
    let txBuilder = new TransactionBuilder(sourceAccount, {
      fee: "100", // 100 stroops = 0.00001 XLM
      networkPassphrase: TESTNET_CONFIG.passphrase
    })
    .addOperation(Operation.payment({
      destination: destination,
      asset: Asset.native(),
      amount: formatAmount(amount)
    }))
    .setTimeout(30); // 30 second timeout
    
    // Add memo if provided
    if (memo) {
      // Try to parse as number for ID memo, otherwise use text memo
      if (/^\d+$/.test(memo) && memo.length <= 19) {
        txBuilder = txBuilder.addMemo(Memo.id(memo));
      } else {
        txBuilder = txBuilder.addMemo(Memo.text(memo));
      }
    }
    
    // Build the transaction
    const transaction = txBuilder.build();
    
    // Get XDR
    const xdr = transaction.toEnvelope().toXDR('base64');
    
    // Prepare response
    const transactionData: TransactionData = {
      xdr: xdr,
      networkHash: TESTNET_NETWORK_HASH,
      transaction: transaction,
      details: {
        source: SOURCE_PUBLIC_KEY,
        destination: destination,
        amount: formatAmount(amount),
        memo: memo,
        fee: "0.00001",
        sequence: (parseInt(sourceAccount.sequence) + 1).toString()
      }
    };
    
    return transactionData;
    
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(`Source account ${SOURCE_PUBLIC_KEY} not found on testnet. Fund it first!`);
    }
    throw new Error(`Failed to build transaction: ${error.message}`);
  }
}

// Display transaction details
function displayTransaction(txData: TransactionData): void {
  console.log(txData.xdr);
}

// Save transaction to file (optional)
async function saveTransaction(txData: TransactionData): Promise<void> {
  // Removed save functionality for minimal output
}

// Main execution
async function main(): Promise<void> {
  try {
    const txData = await buildStellarTransaction();
    displayTransaction(txData);
    
  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run the script
if (require.main === module) {
  main();
}