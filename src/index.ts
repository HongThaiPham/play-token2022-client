import {
  getKeypairFromEnvironment,
  getKeypairFromFile,
} from "@solana-developers/helpers";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  LENGTH_SIZE,
  TYPE_SIZE,
  createAccount,
  createInitializeMintInstruction,
  createInitializeTransferHookInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  getTokenMetadata,
  getTransferFeeAmount,
  getTransferFeeConfig,
  getTransferHook,
  getTransferHookAccount,
  mintTo,
  transferCheckedWithFee,
  transferCheckedWithFeeAndTransferHook,
  unpackAccount,
  withdrawWithheldTokensFromAccounts,
} from "@solana/spl-token";
import { getMetadataPointerState } from "@solana/spl-token";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeTransferFeeConfigInstruction,
  getMintLen,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TokenMetadata,
  createInitializeInstruction,
  createUpdateFieldInstruction,
  pack,
  unpack,
} from "@solana/spl-token-metadata";
import * as dotenv from "dotenv";
import { createInitializeMetadataPointerInstruction } from "@solana/spl-token";
dotenv.config();
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Transferhook, IDL } from "../transferhook/target/types/transferhook";

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// const localWallet = getKeypairFromFile("~/.config/solana/id.json");
const wallet = getKeypairFromEnvironment("SOLANA_WALLET_SECRET_KEY");
const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "FWD3wDGsJc5ACV9fbDuV5VjprcSGfPvxzcb6WmbjjLm7"
);

const user = Keypair.generate();
// console.log(payer.publicKey.toBase58())
// console.log(payer.secretKey)
// airdropIfRequired(connection, payer.publicKey, LAMPORTS_PER_SOL, 0.5 * LAMPORTS_PER_SOL);

(async () => {
  const mintAuthority = wallet.publicKey;
  const mint = Keypair.generate();
  const transferFeeConfigAuthority = wallet.publicKey;
  const updateAuthority = wallet.publicKey;
  const withdrawWithheldAuthority = wallet.publicKey;
  const feeBasisPoints = 50; // 5 for 1000
  const maxFee = BigInt(500000);

  const metaData: TokenMetadata = {
    updateAuthority,
    mint: mint.publicKey,
    name: "Leo Token 2022",
    symbol: "LT22",
    uri: "https://raw.githubusercontent.com/HongThaiPham/play-token2022-client/main/assets/metadata.json",
    additionalMetadata: [["Author", "Leo Pham"]],
  };

  // Size of MetadataExtension 2 bytes for type, 2 bytes for length
  const metadataExtension = TYPE_SIZE + LENGTH_SIZE;
  // Size of metadata

  const metadataLen = pack(metaData).length;
  const mintLen = getMintLen([
    ExtensionType.MetadataPointer,
    ExtensionType.TransferFeeConfig,
    ExtensionType.TransferHook,
  ]);

  const lamport = await connection.getMinimumBalanceForRentExemption(
    mintLen + metadataExtension + metadataLen
  );

  const createAccountInstruction = SystemProgram.createAccount({
    fromPubkey: wallet.publicKey,
    newAccountPubkey: mint.publicKey,
    lamports: lamport,
    space: mintLen,
    programId: TOKEN_2022_PROGRAM_ID,
  });

  const initializeMetadataPointerInstruction =
    createInitializeMetadataPointerInstruction(
      mint.publicKey, // Mint Account address
      updateAuthority, // Authority that can set the metadata address
      mint.publicKey, // Account address that holds the metadata
      TOKEN_2022_PROGRAM_ID
    );

  // Instruction to initialize Metadata Account data
  const initializeMetadataInstruction = createInitializeInstruction({
    programId: TOKEN_2022_PROGRAM_ID, // Token Extension Program as Metadata Program
    metadata: mint.publicKey, // Account address that holds the metadata
    updateAuthority, // Authority that can update the metadata
    mint: mint.publicKey, // Mint Account address
    mintAuthority: mintAuthority, // Designated Mint Authority
    name: metaData.name,
    symbol: metaData.symbol,
    uri: metaData.uri,
  });

  // Instruction to update metadata, adding custom field
  const updateMetadataFieldInstruction = createUpdateFieldInstruction({
    programId: TOKEN_2022_PROGRAM_ID, // Token Extension Program as Metadata Program
    metadata: mint.publicKey, // Account address that holds the metadata
    updateAuthority, // Authority that can update the metadata
    field: metaData.additionalMetadata[0][0], // key
    value: metaData.additionalMetadata[0][1], // value
  });

  const initializeTransferFeeConfigInstruction =
    createInitializeTransferFeeConfigInstruction(
      mint.publicKey,
      transferFeeConfigAuthority,
      withdrawWithheldAuthority,
      feeBasisPoints,
      maxFee,
      TOKEN_2022_PROGRAM_ID
    );

  const initializeMintInstruction = createInitializeMintInstruction(
    mint.publicKey,
    6,
    mintAuthority,
    null,
    TOKEN_2022_PROGRAM_ID
  );

  const initializeTransferHookInstruction =
    createInitializeTransferHookInstruction(
      mint.publicKey,
      wallet.publicKey,
      TRANSFER_HOOK_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID
    );

  const transactions = new Transaction().add(
    createAccountInstruction,
    initializeMetadataPointerInstruction,
    initializeTransferFeeConfigInstruction,
    initializeTransferHookInstruction,
    initializeMintInstruction,
    initializeMetadataInstruction,
    updateMetadataFieldInstruction
  );

  const createTx = await sendAndConfirmTransaction(connection, transactions, [
    wallet,
    mint,
  ]);

  console.log(
    `Mint: ${mint.publicKey.toBase58()} created with tx: ${createTx}`
  );

  await setupTransferHook(mint.publicKey);

  await readTransferFeeConfig(mint.publicKey);
  await readTokenMetadata(mint.publicKey);

  await readTransferHookConfig(mint.publicKey);

  await mintSomeInitialSupply(mint.publicKey);
  await transferSomeToken(mint.publicKey);

  // await withdrawWithheldFunds(mint.publicKey);
})();

async function setupTransferHook(mint: PublicKey) {
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: "confirmed",
  });

  const program = new Program<Transferhook>(
    IDL,
    TRANSFER_HOOK_PROGRAM_ID,
    provider
  );

  const [extraAccountMetaListPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), mint.toBuffer()],
    program.programId
  );

  await program.methods
    .initializeExtraAccountMetaList()
    .accounts({
      payer: wallet.publicKey,
      extraAccountMetaList: extraAccountMetaListPDA,
      mint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([wallet])
    .rpc();
}

async function readTransferHookConfig(mint: PublicKey) {
  const mintInfo = await getMint(
    connection,
    mint,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  const transferHook = getTransferHook(mintInfo);

  console.log("Transfer Hook:", JSON.stringify(transferHook, null, 2));
}

async function mintSomeInitialSupply(mint: PublicKey) {
  const sourceTokenAccount = await createAccount(
    connection,
    wallet,
    mint,
    wallet.publicKey,
    undefined,
    {
      commitment: "confirmed",
    },
    TOKEN_2022_PROGRAM_ID
  );

  const mintSupply = BigInt(1000000000000);

  const mintTx = await mintTo(
    connection,
    wallet,
    mint,
    sourceTokenAccount,
    wallet.publicKey,
    mintSupply,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  console.log(
    `Minted: ${mintSupply} to ${sourceTokenAccount.toBase58()} with tx: ${mintTx}`
  );
}

async function transferSomeToken(mint: PublicKey) {
  console.log("Transfer some token");
  const mintInfo = await getMint(
    connection,
    mint,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  const sourceTokenAccount = getAssociatedTokenAddressSync(
    mint,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const destinationTokenAccount = await createAccount(
    connection,
    wallet,
    mint,
    user.publicKey,
    Keypair.generate(),
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  const transferAmount = BigInt(1000000000);
  const expectedFee = await calculateTransferFee(mint, transferAmount);
  console.log("Expected Fee:", expectedFee);

  const transferTx = await transferCheckedWithFeeAndTransferHook(
    connection,
    wallet,
    sourceTokenAccount,
    mint,
    destinationTokenAccount,
    wallet.publicKey,
    transferAmount,
    mintInfo.decimals,
    expectedFee,
    [],
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  console.log(
    `Transferred: ${transferAmount} from ${sourceTokenAccount.toBase58()} to ${destinationTokenAccount.toBase58()} with tx: ${transferTx}`
  );
}

async function withdrawWithheldFunds(mint: PublicKey) {
  const allAccounts = await connection.getProgramAccounts(
    TOKEN_2022_PROGRAM_ID,
    {
      commitment: "confirmed",
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: mint.toString(), // Mint Account address
          },
        },
      ],
    }
  );

  const accountsToWithdrawFrom = allAccounts.filter((accountInfo) => {
    const account = unpackAccount(
      accountInfo.pubkey, // Token Account address
      accountInfo.account, // Token Account data
      TOKEN_2022_PROGRAM_ID // Token Extension Program ID
    );

    // Extract transfer fee data from each account
    const transferFeeAmount = getTransferFeeAmount(account);

    // Check if fees are available to be withdrawn
    return transferFeeAmount !== null && transferFeeAmount.withheldAmount > 0;
  });

  const vault = Keypair.generate();

  const vaultTokenAccount = await createAccount(
    connection,
    wallet,
    mint,
    vault.publicKey,
    Keypair.generate(),
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  const withdrawWithheldTx = await withdrawWithheldTokensFromAccounts(
    connection,
    wallet,
    mint,
    vaultTokenAccount,
    wallet.publicKey,
    [],
    accountsToWithdrawFrom.map((account) => account.pubkey),
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  console.log(
    `Withdrawn fees from ${accountsToWithdrawFrom.length} accounts with tx: ${withdrawWithheldTx}`
  );
}

async function calculateTransferFee(mint: PublicKey, transferAmount: bigint) {
  const feeConfig = await readTransferFeeConfig(mint);
  if (!feeConfig) {
    throw new Error("Transfer fee config not found");
  }
  const feeBasisPoints = feeConfig.newerTransferFee.transferFeeBasisPoints;
  const maxFee = feeConfig.newerTransferFee.maximumFee;
  const calcFee = (transferAmount * BigInt(feeBasisPoints)) / BigInt(10000);
  const expectedFee = calcFee > maxFee ? maxFee : calcFee;
  return expectedFee;
}

async function readTransferFeeConfig(mint: PublicKey) {
  const mintInfo = await getMint(
    connection,
    mint,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  const transferFeeConfig = await getTransferFeeConfig(mintInfo);
  console.log(
    "\nTransfer Fee Config:",
    JSON.stringify(
      transferFeeConfig,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2
    )
  );
  return transferFeeConfig;
}

async function readTokenMetadata(mint: PublicKey) {
  const metadata = await getTokenMetadata(
    connection,
    mint // Mint Account address
  );
  console.log("\nMetadata:", JSON.stringify(metadata, null, 2));

  const mintInfo = await getMint(
    connection,
    mint,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  const metadataPointer = getMetadataPointerState(mintInfo);

  console.log("\nMetadata Pointer:", JSON.stringify(metadataPointer, null, 2));
  // const validIndex = findValidUnpackIndex(mintInfo.tlvData);
  // console.log("Valid index:", validIndex);

  // Extract and log the metadata
  // const slicedBuffer = mintInfo.tlvData.subarray(72);
  // const metadata = unpack(slicedBuffer);
  // console.log("\nMetadata:", JSON.stringify(metadata, null, 2));
}

// function findValidUnpackIndex(tlvData: Buffer) {
//   for (let i = 0; i < tlvData.length; i++) {
//     try {
//       // Try to unpack starting from index 'i'
//       const metadata = unpack(tlvData.slice(i));

//       // If unpacking is successful, log the metadata and return the index
//       console.log("Successful unpack at index:", i);
//       console.log("Metadata:", JSON.stringify(metadata, null, 2));
//       return i;
//     } catch (error) {
//       // If an error occurs, continue to the next index
//       // console.log("Unpack failed at index:", i, "Error:", error);
//     }
//   }
//   // If no successful unpacking, return an indication
//   return -1;
// }
