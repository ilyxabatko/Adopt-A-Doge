"use client"

import { DigitalAsset } from "@metaplex-foundation/mpl-token-metadata";
import idl from "../../adoptcontract/target/idl/adoptcontract.json";
import { Adoptcontract } from "../../adoptcontract/target/types/adoptcontract"
import * as anchor from "@project-serum/anchor";
import { AnchorWallet, useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { AccountMeta } from "@solana/web3.js";
import { FC, createContext, useContext, useEffect, useState } from "react";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { toast } from "react-hot-toast";
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { Umi } from "@metaplex-foundation/umi";
import { toWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";

export const useProgram = (): ProgramContextType => {
    const context = useContext(ProgramContext);
    if (!context) {
        throw new Error('useProgram must be used within the BurnNftsProvider');
    }
    return context;
}

type Props = {
    children?: React.ReactNode
}

interface ProgramContextType {
    burnNfts: (nfts: Array<DigitalAsset>) => Promise<string>;
    connection: anchor.web3.Connection;
    wallet: AnchorWallet | undefined;
    umi: Umi;
}

const ProgramContext = createContext<ProgramContextType | undefined>(undefined);

export const ProgramProvider: FC<Props> = ({ children }) => {
    const [program, setProgram] = useState<anchor.Program<Adoptcontract>>(null!);
    const { connection } = useConnection();
    const wallet = useAnchorWallet();
    const umi = createUmi('https://rpc.helius.xyz/?api-key=3c60b359-8acb-4d2f-8f64-b2f748436d45');

    const programId = new anchor.web3.PublicKey("AADPftBL56zsjQZcCU6XhCKGpq3C2eSLeWcW26rjmjnG");
    const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
    );
    
    const TICKETS_MINT_ADDRESS = new anchor.web3.PublicKey("Ha8S2T77GegYpcWh3L9REjx4pPYpy6hdu3zW4ERgdsmP");
    // for devnet testing 
    // const TICKETS_MINT_ADDRESS = new anchor.web3.PublicKey("4niSCMSdCw3Rh6dqjjEUeUUL4jhEyLAsKdFewZoZ4Z3Z");
    const FEES_RECEIVER = new anchor.web3.PublicKey("C326k1ZK43BPfLGVzSBc8991L94a3X7XUvX9BSmJZLbb");

    const vaultPDA = anchor.web3.PublicKey.findProgramAddressSync(
        [
            anchor.utils.bytes.utf8.encode("authority"),
        ],
        programId
    )[0];

    useEffect(() => {
        const getProgram = async () => {
            if (!wallet) {
                return;
            };

            const provider = new anchor.AnchorProvider(
                connection,
                wallet,
                {}
            );

            anchor.setProvider(provider);

            const program = new anchor.Program<Adoptcontract>(JSON.parse(JSON.stringify(idl)), programId, provider);
            setProgram(program);
            toast.success("The program has been successfully setup");
        }
        console.log("Vault's address: " + vaultPDA.toBase58());
        getProgram();
    }, [wallet]);

    const createBurnNftAccountMeta = (mint: anchor.web3.PublicKey, metadata: anchor.web3.PublicKey, edition: anchor.web3.PublicKey, ata: anchor.web3.PublicKey): Array<AccountMeta> => {
        return [
            { pubkey: mint, isWritable: true, isSigner: false },
            { pubkey: metadata, isWritable: true, isSigner: false },
            { pubkey: edition, isWritable: true, isSigner: false },
            { pubkey: ata, isWritable: true, isSigner: false },
        ];
    };

    const createBurnTokenAccountMeta = (mintAddress: anchor.web3.PublicKey, nftAta: anchor.web3.PublicKey): Array<AccountMeta> => {
        return [
            { pubkey: mintAddress, isWritable: true, isSigner: false },
            { pubkey: nftAta, isWritable: true, isSigner: false },
        ];
    };

    const getNftsAccountMetaArray = async (nfts: DigitalAsset[]): Promise<{nftsAccountMeta: Array<AccountMeta>, tokensAccountMeta: Array<AccountMeta>}> => {
        let nftsAccountMetaArray: Array<AccountMeta> = [];
        let tokensAccountMetaArray: Array<AccountMeta> = [];

        for (const nft of nfts) {
            console.log("Loaded NFT metadata: " + nft.mint.publicKey);

            if (nft) {
                const nftAta = wallet && await getAssociatedTokenAddress(toWeb3JsPublicKey(nft.mint.publicKey), wallet?.publicKey);
                if (nft.edition) {
                    const nftAccountMeta = nftAta && createBurnNftAccountMeta(toWeb3JsPublicKey(nft.mint.publicKey), toWeb3JsPublicKey(nft.metadata.publicKey), toWeb3JsPublicKey(nft.edition.publicKey), nftAta);

                    if (nftAccountMeta) {
                        nftsAccountMetaArray = nftsAccountMetaArray.concat(nftAccountMeta);
                    }
                } else {
                    const tokenAccountMeta = nftAta && createBurnTokenAccountMeta(toWeb3JsPublicKey(nft.mint.publicKey), nftAta);

                    if (tokenAccountMeta) {
                        tokensAccountMetaArray = tokensAccountMetaArray.concat(tokenAccountMeta);
                    }
                }
            }
        };

        return { nftsAccountMeta: nftsAccountMetaArray, tokensAccountMeta: tokensAccountMetaArray };
    }

    const burnNfts = async (nfts: DigitalAsset[]): Promise<string> => {
        if (!wallet) { throw new Error("No wallet connected!") }

        const accountsMetas = await getNftsAccountMetaArray(nfts);
        const ticketsAta = await getAssociatedTokenAddress(TICKETS_MINT_ADDRESS, vaultPDA, true);
        const walletAta = await getAssociatedTokenAddress(TICKETS_MINT_ADDRESS, wallet.publicKey);

        const ticketsAtaBalance = await connection.getTokenAccountBalance(ticketsAta);
        if (Number(ticketsAtaBalance.value.amount) <= 0) {
            throw new Error("Insufficient tickets in the vault, contact the Adopt A Doge team to top it up");
        }

        if (accountsMetas.nftsAccountMeta.length === 0 && accountsMetas.tokensAccountMeta.length === 0) {
            throw new Error("Zero NFTs to be burnt, try one more time or contact the Adopt A Doge team");
        }

        const userBurnInfo = anchor.web3.PublicKey.findProgramAddressSync(
            [
                anchor.utils.bytes.utf8.encode("burnstate"),
                wallet.publicKey.toBuffer()
            ],
            programId
        )[0];

        let burnIxsArray: anchor.web3.TransactionInstruction[] = [];

        if (accountsMetas.nftsAccountMeta.length > 0) {
            const burnNftsIx = await program.methods.burnNfts()
            .accounts({
                authority: wallet.publicKey,
                feesReceiver: FEES_RECEIVER,
                userBurnInfo: userBurnInfo,
                tokenProgram: TOKEN_PROGRAM_ID,
                tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId
            })
            .remainingAccounts(accountsMetas.nftsAccountMeta)
            .instruction();

            burnIxsArray.push(burnNftsIx);
        }

        if (accountsMetas.tokensAccountMeta.length > 0) {
            const burnTokensIx = await program.methods.burnTokens()
            .accounts({
                authority: wallet.publicKey,
                feesReceiver: FEES_RECEIVER,
                userBurnInfo: userBurnInfo,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId  
            })
            .remainingAccounts(accountsMetas.tokensAccountMeta)
            .instruction();

            burnIxsArray.push(burnTokensIx);
        }

        const transferTicketsIx = await program.methods.transferNftFromPda()
            .accounts({
                payer: wallet.publicKey,
                authority: vaultPDA,
                ticketsMint: TICKETS_MINT_ADDRESS,
                from: ticketsAta,
                to: walletAta,
                tokenProgram: TOKEN_PROGRAM_ID,
                userBurnInfo: userBurnInfo,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY
            })
            .preInstructions(burnIxsArray)
            .rpc();

        await connection.confirmTransaction(transferTicketsIx, "confirmed");
        return transferTicketsIx as string;
    }

    return (
        <ProgramContext.Provider value={{ burnNfts, connection, wallet, umi }}>
            {children}
        </ProgramContext.Provider>
    );
}