// @ts-check

import { getKeypairFromEnvironment } from '@solana-developers/helpers'
import { createAccount, createInitializeMintInstruction, getMint, mintTo, transferCheckedWithFee } from '@solana/spl-token';
import { getMetadataPointerState } from '@solana/spl-token';
import { ExtensionType, TOKEN_2022_PROGRAM_ID, createInitializeMint2Instruction, createInitializeTransferFeeConfigInstruction, getMintLen } from '@solana/spl-token';
import { Connection, Keypair, SystemProgram, Transaction, clusterApiUrl, sendAndConfirmTransaction } from '@solana/web3.js'
import { TokenMetadata } from '@solana/spl-token-metadata'
import * as dotenv from 'dotenv'
dotenv.config()

const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

const wallet = getKeypairFromEnvironment("SOLANA_WALLET_SECRET_KEY");

const user = Keypair.generate();
// console.log(payer.publicKey.toBase58())
// console.log(payer.secretKey)
// airdropIfRequired(connection, payer.publicKey, LAMPORTS_PER_SOL, 0.5 * LAMPORTS_PER_SOL);

(async () => {
  const mintAuthority = wallet.publicKey;
  const mint = Keypair.generate();
  const transferFeeConfigAuthority = wallet.publicKey;
  const withdrawWithheldAuthority = wallet.publicKey;
  const feeBasisPoints = 50; // 5 for 1000
  const maxFee = BigInt(5000);

  const metaData = {
    updateAuthority: wallet.publicKey,
    mint: mint,
    name: "Leo Token 2022",
    symbol: "LT22",
    uri: "https://raw.githubusercontent.com/solana-developers/opos-asset/main/assets/DeveloperPortal/metadata.json",
    additionalMetadata: [["description", "Only Possible On Solana"]],
  };

  const mintLen = getMintLen([
    ExtensionType.TransferFeeConfig
  ]);
  const lamport = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createAccountInstruction = SystemProgram.createAccount({
    fromPubkey: wallet.publicKey,
    newAccountPubkey: mint.publicKey,
    lamports: lamport,
    space: mintLen,
    programId: TOKEN_2022_PROGRAM_ID
  });

  const initializeTransferFeeConfigInstruction = createInitializeTransferFeeConfigInstruction(
    mint.publicKey,
    transferFeeConfigAuthority,
    withdrawWithheldAuthority,
    feeBasisPoints,
    maxFee,
    TOKEN_2022_PROGRAM_ID
  );

  const initializeMintInstruction = createInitializeMintInstruction(
    mint.publicKey,
    6, mintAuthority, null,
    TOKEN_2022_PROGRAM_ID
  )

  const transactions = new Transaction().add(createAccountInstruction, initializeTransferFeeConfigInstruction, initializeMintInstruction);

  const createTx = await sendAndConfirmTransaction(connection, transactions, [wallet, mint]);

  console.log(`Mint: ${mint.publicKey.toBase58()} created with tx: ${createTx}`)

  const sourceTokenAccount = await createAccount(connection, wallet, mint.publicKey, user.publicKey, undefined, {
    commitment: 'confirmed'
  }, TOKEN_2022_PROGRAM_ID);
  const mintSupply = BigInt(1000000000);



  const mintTx = await mintTo(
    connection,
    wallet,
    mint.publicKey,
    sourceTokenAccount,
    wallet.publicKey,
    mintSupply, [], undefined, TOKEN_2022_PROGRAM_ID
  )

  console.log(`Minted: ${mintSupply} to ${sourceTokenAccount.toBase58()} with tx: ${mintTx}`)

  const destinationTokenAccount = await createAccount(connection, wallet, mint.publicKey, user.publicKey, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);
  const transferAmount = BigInt(1000)
  const expect_fee = (transferAmount * BigInt(feeBasisPoints)) / BigInt(10000);


  const mint_info = await getMint(connection, mint.publicKey, undefined, TOKEN_2022_PROGRAM_ID);
  console.log(mint_info)

  const metadataPointer = getMetadataPointerState(mint_info);
  console.log("\nMetadata Pointer:", JSON.stringify(metadataPointer, null, 2));
  // const transferSig = await transferCheckedWithFee(connection, wallet, sourceTokenAccount, mint.publicKey, destinationTokenAccount, wallet, transferAmount, expect_fee, TOKEN_2022_PROGRAM_ID);

})()
