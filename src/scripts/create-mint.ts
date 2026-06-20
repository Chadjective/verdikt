import { generateKeyPairSigner, lamports } from "@solana/kit";
import { getCreateAccountInstruction, getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstructionAsync,
  getInitializeMintInstruction,
  getMintSize,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { config, TOKEN_DECIMALS } from "../config";
import { buildClient, loadWallet, toAddress } from "../solana/client";

/**
 * Chain-mode setup, no Solana CLI required: create a plain-SPL test token,
 * fund the agent + merchant with a little SOL so they can sign their pulls,
 * create ATAs, and mint a balance to the user. Prints TOKEN_MINT for .env.
 *
 * Prereq: the user/payer wallet must already hold devnet SOL — RPC airdrop is
 * disabled on public devnet, so fund it once at https://faucet.solana.com.
 * Run after `npm run setup`, then put the printed TOKEN_MINT in .env.
 */
async function main(): Promise<void> {
  if (config.payments !== "chain") {
    console.error("Set PAYMENTS=chain (and RPC_URL) in .env first.");
    process.exit(1);
  }

  const user = await loadWallet(config.keypairs.user);
  const agent = await loadWallet(config.keypairs.agent);
  const merchant = await loadWallet(config.keypairs.merchant);
  const client = buildClient(user); // user = fee payer + mint authority

  const bal = await client.rpc.getBalance(toAddress(user.address)).send();
  if (bal.value < 100_000_000n) {
    console.error(
      `Payer ${user.address} has ${bal.value} lamports.\n` +
        "Fund ~2 devnet SOL at https://faucet.solana.com (select devnet), then re-run.",
    );
    process.exit(1);
  }

  console.log("Distributing SOL to agent + merchant (so they can sign)...");
  for (const w of [agent, merchant]) {
    await client.sendTransaction(
      getTransferSolInstruction({
        source: user.signer,
        destination: toAddress(w.address),
        amount: lamports(40_000_000n),
      }),
    );
  }

  console.log("Creating mint...");
  const mint = await generateKeyPairSigner();
  const space = BigInt(getMintSize());
  const rent = await client.rpc.getMinimumBalanceForRentExemption(space).send();
  await client.sendTransaction([
    getCreateAccountInstruction({
      payer: user.signer,
      newAccount: mint,
      lamports: rent,
      space,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMintInstruction({
      mint: mint.address,
      decimals: TOKEN_DECIMALS,
      mintAuthority: toAddress(user.address),
    }),
  ]);

  console.log("Creating ATAs + minting to user...");
  for (const w of [user, agent, merchant]) {
    const ix = await getCreateAssociatedTokenInstructionAsync({
      payer: user.signer,
      owner: toAddress(w.address),
      mint: mint.address,
    });
    await client.sendTransaction(ix);
  }
  const [userAta] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: toAddress(user.address),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  await client.sendTransaction(
    getMintToInstruction({
      mint: mint.address,
      token: userAta,
      mintAuthority: user.signer,
      amount: 100_000_000n, // 100 tokens at 6 decimals
    }),
  );

  console.log(`\nMint created: ${mint.address}`);
  console.log(`Add to .env:  TOKEN_MINT=${mint.address}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
